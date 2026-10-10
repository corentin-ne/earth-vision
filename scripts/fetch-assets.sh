#!/usr/bin/env bash
# Downloads the raw sources that scripts/build-assets.mjs and
# scripts/build-rasters.py turn into the offline files under public/.
# Only needed to regenerate those files; the app itself never downloads anything.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.cache/ne" && cd "$ROOT/.cache"

# Natural Earth vectors: kept in this repo's history (CMaps 1.x shipped them).
for f in ne_10m_admin_1_states_provinces ne_10m_lakes ne_10m_rivers_lake_centerlines ne_50m_admin_0_countries \
         ne_50m_geography_marine_polys ne_50m_urban_areas ne_10m_populated_places_simple; do
  [ -s "ne/$f.geojson" ] || git -C "$ROOT" show "4cea7b2:static/data/$f.geojson" > "ne/$f.geojson"
done

# Label fonts (MapLibre glyph PBFs), Latin/Greek/Cyrillic/punctuation ranges.
for font in "Open Sans Regular" "Open Sans Semibold" "Open Sans Bold" "Open Sans Italic" "Open Sans Semibold Italic" "Open Sans Bold Italic"; do
  mkdir -p "fonts/$font"
  for s in $(seq 0 256 8448); do
    e=$((s+255)); f="fonts/$font/$s-$e.pbf"
    [ -s "$f" ] || curl -sfL "https://fonts.openmaptiles.org/${font// /%20}/$s-$e.pbf" -o "$f" || echo "missing $f"
  done
done

# Elevation (terrarium encoding, AWS Open Data), zoom 0-6 (5,461 tiles).
for z in 0 1 2 3 4 5 6; do n=$((1<<z)); for x in $(seq 0 $((n-1))); do for y in $(seq 0 $((n-1))); do
  mkdir -p "dem/$z/$x"; f="dem/$z/$x/$y.png"
  [ -s "$f" ] || curl -sfL "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/$z/$x/$y.png" -o "$f"
done; done; done

# Natural Earth I shaded relief, 1:50m.
[ -s NE1_50M_SR_W.zip ] || curl -sfL https://naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip -o NE1_50M_SR_W.zip
[ -d relief/NE1_50M_SR_W ] || unzip -q -o NE1_50M_SR_W.zip -d relief
# The same at 1:10m, for the zoom 5 tiles (~320 MB; the CDN wants a browser user agent).
if [ ! -s relief/NE1_HR_LC_SR_W/NE1_HR_LC_SR_W.tif ]; then
  curl -sfL -A "Mozilla/5.0" https://naciscdn.org/naturalearth/10m/raster/NE1_HR_LC_SR_W.zip -o NE1_HR_LC_SR_W.zip
  mkdir -p relief/NE1_HR_LC_SR_W && unzip -q -o NE1_HR_LC_SR_W.zip -d relief/NE1_HR_LC_SR_W && rm NE1_HR_LC_SR_W.zip
fi
echo "done — now run: node scripts/build-assets.mjs && python scripts/build-rasters.py relief relief-hi dem bathy"
