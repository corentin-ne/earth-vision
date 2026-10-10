// Builds the offline vector assets in public/data from the Natural Earth
// sources cached in .cache/ne (see scripts/fetch-assets.sh).
//
//   node scripts/build-assets.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import mapshaper from 'mapshaper';

const ROOT = path.resolve(import.meta.dirname, '..');
const NE = path.join(ROOT, '.cache/ne');
const OUT = path.join(ROOT, 'public/data');
fs.mkdirSync(OUT, { recursive: true });

const read = (name) => fs.readFileSync(path.join(NE, name + '.geojson'), 'utf8');

async function run(cmd, inputs) {
  const out = await mapshaper.applyCommands(cmd, inputs);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === 'string' ? v : Buffer.from(v).toString('utf8')]));
}

function write(name, content) {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log(name.padEnd(22), (Buffer.byteLength(content) / 1024).toFixed(0).padStart(6), 'KB');
}

// The A+ World Map Editor palette, reused as the default country palette.
const THEME = ['#D6C7FF', '#EBCA8A', '#C1E599', '#E7E58F', '#98DDA1', '#83D5F4', '#B1BBF9', '#F4B4C4', '#EAB38F'];

// ── Countries (metadata only: names, ISO codes, population, palette) ─────────
const admin0 = JSON.parse(read('ne_50m_admin_0_countries'));
const iso3to2 = {};
const countries = {};
for (const f of admin0.features) {
  const p = f.properties;
  const a3 = p.ADM0_A3;
  let a2 = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
  if (a2 && a2 !== '-99') iso3to2[a3] = a2.toLowerCase();
  if (p.ISO_A3_EH && p.ISO_A3_EH !== '-99' && a2 && a2 !== '-99') iso3to2[p.ISO_A3_EH] = a2.toLowerCase();
  countries[a3] = {
    cid: a3,
    name: p.NAME_LONG || p.NAME,
    color: THEME[(p.MAPCOLOR9 - 1 + THEME.length) % THEME.length],
    population: p.POP_EST || 0,
    gdp: p.GDP_MD ? p.GDP_MD * 1e6 : 0,
  };
}
write('iso3to2.json', JSON.stringify(iso3to2));

// ── Earth template: admin-1 regions grouped by admin-0 owner ─────────────────
{
  const out = await run(
    '-i admin1.json ' +
      '-filter-fields name,adm0_a3,admin ' +
      '-simplify 12% weighted keep-shapes ' +
      '-clean ' +
      '-o earth.json format=topojson quantization=200000',
    { 'admin1.json': read('ne_10m_admin_1_states_provinces') },
  );
  const topo = JSON.parse(out['earth.json']);
  const obj = Object.values(topo.objects)[0];
  topo.objects = { regions: obj };
  for (const g of obj.geometries) {
    const p = g.properties;
    if (!countries[p.adm0_a3]) {
      countries[p.adm0_a3] = { cid: p.adm0_a3, name: p.admin, color: THEME[0], population: 0, gdp: 0 };
    }
    g.properties = { name: p.name || p.admin, cid: p.adm0_a3 };
  }
  // Only keep countries that own at least one region.
  const used = new Set(obj.geometries.map((g) => g.properties.cid));
  const tmplCountries = Object.values(countries).filter((c) => used.has(c.cid));

  // Cities: national capitals plus the larger populated places.
  const places = JSON.parse(read('ne_10m_populated_places_simple'));
  const cities = places.features
    .filter((f) => f.properties.featurecla?.startsWith('Admin-0 capital') || f.properties.scalerank <= 3)
    .map((f) => ({
      name: f.properties.name,
      lng: +f.geometry.coordinates[0].toFixed(4),
      lat: +f.geometry.coordinates[1].toFixed(4),
      capital: f.properties.featurecla === 'Admin-0 capital',
      cid: f.properties.adm0_a3,
      pop: f.properties.pop_max || 0,
    }));
  write('earth.json', JSON.stringify({ topology: topo, countries: tmplCountries, cities }));
}

// ── Physical layers ──────────────────────────────────────────────────────────
{
  const out = await run('-i lakes.json -filter "scalerank <= 7" -filter-fields name -simplify 35% keep-shapes -o lakes.json precision=0.001', {
    'lakes.json': read('ne_10m_lakes'),
  });
  write('lakes.json', out['lakes.json']);
}
{
  const out = await run('-i rivers.json -filter "scalerank <= 8" -filter-fields name,scalerank -simplify 30% -o rivers.json precision=0.001', {
    'rivers.json': read('ne_10m_rivers_lake_centerlines'),
  });
  write('rivers.json', out['rivers.json']);
}
{
  const out = await run('-i urban.json -filter-fields -simplify 50% -o urban.json precision=0.001', {
    'urban.json': read('ne_50m_urban_areas'),
  });
  write('urban.json', out['urban.json']);
}
{
  // Ocean / sea name points at each polygon's inner label point.
  const out = await run('-i marine.json -filter-fields name,featurecla,scalerank -points inner -o marine.json precision=0.01', {
    'marine.json': read('ne_50m_geography_marine_polys'),
  });
  const fc = JSON.parse(out['marine.json']);
  for (const f of fc.features) {
    const c = f.properties.featurecla;
    f.properties = {
      name: f.properties.name,
      kind: c === 'ocean' ? 'ocean' : 'sea',
      rank: f.properties.scalerank,
    };
  }
  write('marine.json', JSON.stringify(fc));
}

// ── Detailed coastline, for "Snap coasts to the real coastline" ──────────────
// Natural Earth 1:10m land outlines (the regions come from the same data, simplified much
// further), as rings of delta-encoded points in thousandths of a degree.
if (fs.existsSync(path.join(NE, 'ne_10m_land.geojson'))) {
  const out = await run('-i land.json -explode -simplify 55% weighted keep-shapes -o coast.json precision=0.001', { 'land.json': read('ne_10m_land') });
  const fc = JSON.parse(out['coast.json']);
  const rings = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const ring of poly) {
        if (ring.length < 4) continue;
        const flat = [];
        let px = 0;
        let py = 0;
        for (const [x, y] of ring) {
          const ix = Math.round(x * 1000);
          const iy = Math.round(y * 1000);
          flat.push(ix - px, iy - py);
          px = ix;
          py = iy;
        }
        rings.push(flat);
      }
  }
  write('coast.json', JSON.stringify({ scale: 1000, rings }));
}
