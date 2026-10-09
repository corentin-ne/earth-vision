# Earth Vision

Build and reshape your own world on a 3D globe: thousands of regions you can hand from one country
to another, flags, capitals, cities, populations and notes — with a map as pretty as an atlas.
Runs in the browser **and fully offline** as an installable app (desktop or phone).

It fuses the earlier **CMaps** (MapLibre web map) and **earth** (Expo 3D globe editor) projects;
their code is kept under [`legacy/`](legacy/).

## What you can do

- **Open your A+ World Map Editor `.map` files** (drag & drop) — countries, regions, flags, colours,
  population/GDP, leader/language fields, cities & capitals, water labels and alliances are all read.
  **Export back to `.map`** at any time, so both apps stay in sync.
- Start from **Real Earth** (today's ~250 countries over ~4,600 admin-1 regions), a **Fantasy Earth**
  (invented nations with names, flags and capitals grown over real land) or a **Blank Earth** where every
  region is unclaimed.
- A home dashboard with your **main map** on top (picture, stats, largest nations) and your other worlds
  below; pin any world as the main one, rename, duplicate, export or delete it.
- **Paint** regions into a country by dragging (`B`): adjustable brush, `Alt`+click to pick a country,
  `Ctrl`+click to take a whole country, hold `Space` to pan. One stroke = one undo step.
- **Select** (`V`) a country to open its page: rename, recolour, upload a flag, edit stats and text
  fields, notes, capital, annex it into another country or dissolve it. Click a region inside it to
  rename it, move it to another country or make it a new country. `Shift`+click to select several
  regions, then give them away, merge them into one region or found a new country.
- **Split** (`K`) regions along a line you draw; borders stay exact with the neighbours.
- **Cities** (`C`): add, drag, rename, hide, set as capital.
- Populations travel with the land: they are stored per region and summed per country.
- Living water: the sea is coloured by the real sea-floor depth (pale shelves, deep trenches) and its
  surface is a small GPU shader — drifting swell lit by the sun, with glints — that costs next to nothing
  (throttled, paused when idle or hidden; toggle *Animated water*).
- Click a country, region or city: a bubble shows its flag and name and the map glides it into view;
  *Details* docks its full page beside the map (below it on phones) and frames it in what stays visible.
- **Flag maker**: pick a layout, the colours of each part and an emblem (star, stars, sun, crescent),
  with a live preview — or let it surprise you and tweak from there.
- Four map looks — **Political** (colours + hill shading), **Atlas** (MillMint-style physical relief
  with fine borders), **Plain** (A+ style) and **Night** — on a globe or a flat map (`G`), with
  optional 3D mountains, rivers, lakes, urban areas, graticule…
- **Natural borders** (`N`): the brush stops at rivers (big ones or all) and mountain crests. A region a
  river or crest runs through is cut exactly along it and only your side is taken — France can claim
  Germany up to the Rhine, Spain stop at the Pyrenees. With *Whole country* you take a country up to
  them in one click; *Cut at rivers & crests* on a region page cuts it without painting.
- **Alliances**: found one, name and colour it, add or remove members (world panel or a country's
  page); the shield button (`U`) colours the map by alliance, outlines each one and greys out the rest.
- **Regions first**: a click on the map selects the region under it (its page shows the country it
  belongs to); a second click, or *Part of …*, opens the whole country. Clicking a country's name
  selects that country.
- **Lore** on every country, region, city and pin, with `[[links]]`: write `[[France]]` or
  `[[Paris|the capital]]` and it becomes a link to it (suggestions appear as you type); pages list
  where they are *mentioned*.
- **Draw** (`D`): raise **new land** (click around it over the sea: it fits exactly against the coast
  it touches), draw **roads, railways, trade routes, sea lanes, front lines and claimed borders**,
  place **names** (seas, mountain ranges, regions — size, angle, colour) and **pins** (battles,
  treaties, ruins, temples, ports…, each with its story). Drag names and pins to move them. Regions
  can be **sunk** into the sea.
- **Occupation**: a region can be *occupied by* another country while its owner keeps the claim —
  drawn as stripes in the occupier's colours; the country page lists what it holds and has lost.
- **States & provinces** inside a country (dashed borders), and **vassals**: give a country an
  overlord; *Realms* colours vassals in their overlord's colours.
- **Colour the map by** (layers panel): any figure in classes (population, density, GDP per person,
  area…), any text field as categories (language, government…), realms or states — with a legend.
- **Statistics** (`S`): rank every country by any figure, or compare several side by side. The home
  screen sums up the world (land, claimed share, people, cities, alliances…).
- **Poster** (Export menu): the view in 2–4× resolution, framed like an atlas page, with a title
  cartouche, a legend, a compass rose and a scale bar.
- **Drag a country's name** to place it by hand; **curved names** (layers panel) bend the names of
  long countries along their shape, atlas style.
- **Find & replace** (`Ctrl+H`) across country, state, region and city names, details, lore and map
  names, with a preview, as one undo step.
- **Data layers** (`O`) from free, open sources: coral reefs, glaciers, ice shelves, mountain ranges
  and deserts, peaks, tectonic plates, time zones, ports, airports, live earthquakes (USGS) and
  natural events (NASA EONET). Each downloads once, then works offline.
- Sharper relief: zoom 5 tiles from Natural Earth's 1:10m shaded relief.
- **Hide the tools** (`H`): just the map, with a slow spin of the globe if you like. `H` or `Esc` brings
  everything back.
- **Advanced** tools (`A`): recalculate population for the current borders from real-world data (or
  spread each country's total by area), heal map borders (snap borders that almost line up), tidy stray
  pieces and holes, recolour the map so
  neighbours differ, choose capitals, draw flags for every country, re-centre names, remove empty countries.
- **Flags**: a gallery of the world's flags (`F`), a full-size view to browse them, upload or roll a random one.
- Search (`Ctrl+K`), undo/redo (`Ctrl+Z` / `Ctrl+Y`), autosave, a library of worlds, `.map` export
  (`Ctrl+E`), PNG snapshots (`P`) and GeoJSON export. `?` lists every shortcut.
- On a phone / the **Android app**: tap a `.map` in your file manager to open it in Earth Vision; touch
  buttons for pick-a-colour, whole-country fill and multi-select,
  the back button steps out of panels, and exports open the share sheet (save to Files, Drive, send…).

## Use it

```bash
npm install
npm run dev
```

Open the printed URL. To **install it as an offline app**, open the deployed site (or `npm run preview`)
in Chrome/Edge and choose *Install app* (on a phone: *Add to Home screen*). Every map asset — relief
tiles, elevation, fonts, flags, Natural Earth layers — ships with the app, so it never needs the
network after the first load. Worlds are stored in the browser (IndexedDB); export them as `.map`
from the home screen. Every `.map` Earth Vision writes opens in A+ World Map Editor, and also carries an
`earth_vision.json` (ignored by A+) with what A+ cannot store — notes, exact region populations, city
sizes — so nothing is lost on a round trip. Old `.cmaps` backups still open.

### Put it on a website

```bash
npm run build
```

Upload the `dist/` folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, a plain web
server…). All paths are relative, so it also works from a sub-folder.

### Android app

Every push to `main` builds an APK on GitHub Actions and attaches it to the release. It is a release
build signed with a permanent key (repository secrets `ANDROID_KEYSTORE_B64` and
`ANDROID_KEYSTORE_PASSWORD`), so each new APK installs over the previous one. Keep a backup of that key:
an APK signed with another key cannot update the installed app (it has to be uninstalled first). To build one locally
(needs the Android SDK):

```bash
npm run android            # build, sync and set up android/ (icon, version)
cd android && ./gradlew assembleDebug
```

## How it works

| Piece | Where |
|---|---|
| World model, undo/redo, all editing operations | [`src/world/store.ts`](src/world/store.ts) |
| Shared-border topology: borders, country shapes, neighbours | [`src/geo/engine.ts`](src/geo/engine.ts) |
| Region splitting, and cutting along rivers and crests | [`src/geo/split.ts`](src/geo/split.ts), [`src/geo/barriers.ts`](src/geo/barriers.ts), [`src/world/natural.ts`](src/world/natural.ts) |
| A+ `.map` import/export (a zip whose header reads `A+WM`) | [`src/io/amap.ts`](src/io/amap.ts) |
| MapLibre rendering & map tools | [`src/map/`](src/map/) |
| UI | [`src/ui/`](src/ui/) |
| Look: Spark UI kit tokens and components, SchneiderPocket's corners, lit rim and condensed titles | [`src/theme/spark.css`](src/theme/spark.css), [`src/ui/rimlight.ts`](src/ui/rimlight.ts) |

Regions are kept as a TopoJSON topology, so each border is stored once and knows the region on each
side. Moving a region to another country therefore never clips polygons: country borders are just the
arcs whose two sides have different owners, and fills are recoloured through MapLibre feature state.
That is what keeps painting instant even with thousands of regions.

### Rebuilding the bundled map data

The files in `public/data`, `public/tiles` and `public/fonts` are generated; to regenerate them:

```bash
bash scripts/fetch-assets.sh        # downloads sources into .cache/
node scripts/build-assets.mjs       # Earth template, lakes, rivers, urban areas, sea names
python scripts/build-rasters.py     # relief + elevation tiles (needs numpy and Pillow)
python scripts/build-crests.py      # mountain crests: watershed divides over high ground (+ scipy)
```

## Tests

```bash
npm test                                   # geometry, split, undo/redo, editing operations
AMAP_FILE=path/to/world.map npm test       # + a full import/export round trip of a real .map
```

## Credits

Relief, borders, lakes, rivers and places: [Natural Earth](https://www.naturalearthdata.com) (public domain).
Elevation: Mapzen Terrain Tiles via AWS Open Data. Labels: Open Sans (OpenMapTiles font build).
Rendering: [MapLibre GL JS](https://maplibre.org).
