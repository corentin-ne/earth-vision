# Earth Vision — TODO

## Done (2.0)
- [x] Fuse CMaps (web) and earth (3D globe editor) into one Vite + React + MapLibre app
- [x] Offline-first: installable PWA, all map assets bundled, worlds in IndexedDB, autosave
- [x] A+ World Map Editor `.map` import **and** export (round-trip tested)
- [x] Real Earth / Blank Earth templates from Natural Earth admin-1 regions
- [x] Topology engine: instant region transfers, exact borders, arc-based merges
- [x] Tools: select, paint (brush, eyedropper, whole-country), split, merge, cities
- [x] Country pages: flag upload, colour, stats (population follows regions), fields, notes, capital, annex, dissolve
- [x] Map looks: Political, Atlas (MillMint-style relief), Plain, Night; globe/flat; 3D terrain
- [x] Undo/redo, search, PNG/GeoJSON/.cmaps export, phone layout

## Done (2.1)
- [x] Home dashboard: main map on top with a picture, stats and largest nations; world cards; compact import
- [x] `.map` is the only export (lossless thanks to `earth_vision.json`); `.cmaps` stays readable
- [x] Fantasy Earth generator, random flags & names, flag gallery and full-size flag view
- [x] Advanced tools: population from real-world data, heal borders, recolour, capitals, flags for all…
- [x] Android: share-sheet exports, back button, safe areas, touch modes, app icon & version
- [x] Faster: editor loaded on demand, flags encoded in parallel, thumbnails off the critical path

## Next
- [ ] Android: open `.map` files straight from the file manager ("Open with Earth Vision")
- [ ] Alliances editor (they are imported/exported, but only listed in the UI)
- [ ] Drag country labels to place them by hand
- [ ] Draw brand-new land (islands) and delete regions
- [ ] Timeline: snapshots of a world over the years, with an animated playback / video export
- [ ] Higher-resolution relief tiles (z5–z6) for close-up work
- [ ] Native desktop wrapper (Tauri) once a Rust toolchain is installed — the PWA covers offline use meanwhile
