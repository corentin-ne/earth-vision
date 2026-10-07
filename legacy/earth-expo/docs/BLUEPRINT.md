# Project Foundation Blueprint

## 3D World Map Editor Sandbox — "My World"

---

## 1. Folder Structure

```
earth/
├── app.config.ts                     # Expo SDK 54 configuration (programmatic)
├── package.json                      # Dependencies & scripts
├── tsconfig.json                     # TypeScript strict mode configuration
├── babel.config.js                   # Babel + Reanimated + console stripping
├── metro.config.js                   # Metro bundler (GLSL + JSON extensions)
│
├── scripts/
│   └── analyze-bundle.mjs            # Bundle size analysis & Turf tree-shake check
│
├── assets/
│   ├── textures/                     # Globe textures (earth albedo, bump, specular)
│   ├── fonts/                        # Custom typefaces for HUD / labels
│   └── sounds/                       # Tactile feedback SFX (tap, assign, fuse)
│
├── src/
│   ├── app/                          # Expo Router entry points & layout
│   │   ├── _layout.tsx               # Root layout (providers, fonts, splash)
│   │   └── index.tsx                 # Main screen (Canvas + HUD overlay)
│   │
│   ├── components/
│   │   ├── ErrorBoundary.tsx         # Global error boundary (WebGL/Turf/store)
│   │   │
│   │   ├── globe/                    # Everything rendered inside <Canvas>
│   │   │   ├── Globe.tsx             # Top-level R3F scene component
│   │   │   ├── GlobeMesh.tsx         # The sphere mesh with region geometries
│   │   │   ├── RegionMesh.tsx        # Individual extruded region polygon
│   │   │   ├── Atmosphere.tsx        # Fresnel atmospheric glow shell
│   │   │   ├── CameraController.tsx  # Spring-based OrbitControls wrapper
│   │   │   ├── RegionLabels.tsx      # Floating text labels (drei <Text>)
│   │   │   └── Borders.tsx           # Political border line rendering
│   │   │
│   │   ├── ui/                       # Pure React Native UI (outside Canvas)
│   │   │   ├── BottomSheet.tsx       # Reanimated-driven info/editor panel
│   │   │   ├── ToolBar.tsx           # Editor tool selector (paint/erase/…)
│   │   │   ├── ColorPicker.tsx       # Country color chooser
│   │   │   ├── CountryCard.tsx       # Country info display card
│   │   │   ├── LoadingScreen.tsx     # Suspense fallback (pulsing globe)
│   │   │   └── SettingsModal.tsx     # World settings overlay
│   │   │
│   │   └── hud/                      # Overlay elements on top of the Canvas
│   │       ├── WorldNameBadge.tsx    # Animated world name display
│   │       ├── MiniMap.tsx           # Optional 2D minimap reference
│   │       ├── ToastNotification.tsx # Ephemeral action feedback
│   │       └── DrawingOverlay.tsx    # Split line drawing gesture overlay
│   │
│   ├── store/                        # Zustand store implementation
│   │   ├── useWorldStore.ts          # Main store (create + middleware)
│   │   ├── slices/
│   │   │   ├── regionSlice.ts        # Region mutation actions
│   │   │   ├── countrySlice.ts       # Country CRUD actions
│   │   │   ├── cameraSlice.ts        # Camera state actions
│   │   │   ├── interactionSlice.ts   # Selection & tool state
│   │   │   ├── settingsSlice.ts      # WorldSettings actions
│   │   │   └── geoEditSlice.ts       # Fuse & Split aftermath actions
│   │   └── middleware/
│   │       └── persistMiddleware.ts  # Auto-save to MMKV on mutation
│   │
│   ├── hooks/                        # Shared React hooks
│   │   ├── useRegionTap.ts           # Raycasting → region ID resolution
│   │   ├── useFlyTo.ts              # Imperative fly-to camera API
│   │   ├── usePersistence.ts        # MMKV rehydration on mount
│   │   ├── useSpring.ts             # Reusable spring hook for 3D values
│   │   └── useDrawLine.ts           # Split line drawing gesture capture
│   │
│   ├── shaders/                      # Raw GLSL shader files
│   │   ├── atmosphere.vert           # Vertex shader for Fresnel glow
│   │   ├── atmosphere.frag           # Fragment shader for Fresnel glow
│   │   └── region.frag               # Per-region color + highlight shader
│   │
│   ├── utils/
│   │   ├── geo/                      # Geospatial utilities
│   │   │   ├── topoLoader.ts         # TopoJSON → RegionGeometry[] parser
│   │   │   ├── spatialIndex.ts       # R-tree or grid index for fast picking
│   │   │   ├── projection.ts         # Lat/lon ↔ Cartesian transforms
│   │   │   ├── triangulation.ts      # Polygon → GPU mesh triangulation
│   │   │   └── screenProjection.ts   # 2D screen → 3D sphere projection
│   │   │
│   │   └── math/                     # Pure math utilities
│   │       ├── camera.ts             # Spring physics, spherical math
│   │       └── color.ts              # Hex ↔ RGB/HSL conversions
│   │
│   ├── services/
│   │   ├── persistence/
│   │   │   ├── mmkvStorage.ts        # Encrypted MMKV adapter (keychain-derived key)
│   │   │   └── validation.ts        # Zod schemas + salvage recovery
│   │   └── geospatial/
│   │       ├── turfService.ts        # Turf.js facade for complex geo ops
│   │       ├── regionOps.ts          # Country-level geo aggregation ops
│   │       └── geoManipulation.ts    # Fuse (union) & Split (difference) engine
│   │
│   ├── data/                         # Bundled static data
│   │   └── world.topo.json           # TopoJSON world map (Natural Earth)
│   │
│   ├── constants/
│   │   ├── index.ts                  # App-wide magic numbers & defaults
│   │   └── performanceConfig.ts      # Performance budget constants & checklist
│   │
│   └── types/                        # Shared TypeScript types
│       ├── index.ts                  # Barrel export
│       └── store.ts                  # Zustand store schema interfaces
│
└── __tests__/                        # Test files mirroring src/ structure
    ├── store/
    └── utils/
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| `globe/` vs `ui/` split | Strict separation between R3F (WebGL) components and React Native components. They never import from each other — only from `store/` and `hooks/`. |
| `store/slices/` pattern | Each domain (regions, countries, camera) gets its own slice file. The main `useWorldStore.ts` composes them via Zustand's slice pattern, keeping each file under ~150 lines. |
| `types/store.ts` is the contract | All slices, components, and hooks import types from a single source of truth. No interface is defined inline in a component. |
| `utils/math/camera.ts` is pure | Spring physics and coordinate math are framework-agnostic pure functions. Easy to unit-test, easy to swap. |
| `services/` for side-effects | MMKV I/O and heavy Turf.js operations live in `services/` — they are injected into the store via middleware, not imported directly by components. |

---

## 2. Zustand Store Schema

The complete, production-grade TypeScript interfaces are defined in:

**[`src/types/store.ts`](../src/types/store.ts)**

### Quick Reference

```
WorldStore (Zustand root)
├── regions:      Record<RegionId, RegionMeta>        ← persistable
├── countries:    Record<CountryId, Country>           ← persistable
├── settings:     WorldSettings                        ← persistable
├── geometries:   Record<RegionId, RegionGeometry>     ← immutable cache (NOT persisted)
├── camera:       CameraState                          ← transient
├── interaction:  InteractionState                     ← transient
└── actions:      (see store.ts for full list)
```

### Entity Relationships

```
Country ──1:N──▶ RegionMeta (via Country.regionIds[])
RegionMeta ──1:1──▶ RegionGeometry (via shared RegionId)
```

- A **Region** is the atomic geographic unit (e.g., "US-CA").
- A **Country** is a user-created political overlay that owns 0+ regions.
- **RegionGeometry** is immutable and loaded from TopoJSON at startup.
- **RegionMeta** is the mutable layer the user edits (color, label, elevation).
- Lookups are always **O(1)** via `Record<BrandedId, Entity>` maps.

---

## 3. Camera Zoom Strategy

The complete strategy implementation is in:

**[`src/utils/math/camera.ts`](../src/utils/math/camera.ts)**

### Summary

```
User taps region on globe
        │
        ▼
  Raycast hit → resolve RegionId
        │
        ▼
  Look up owning Country (if any)
        │
        ├─ Has Country → compute combined bbox of all Country regions
        └─ No Country  → use single region's bbox
        │
        ▼
  Compute target:
    • [lon, lat] = entity centroid
    • distance   = f(bbox diagonal) clamped to [MIN_ZOOM, MAX_ZOOM]
        │
        ▼
  Set spring targets (shortest-arc normalization on longitude):
    • azimuthSpring.setTarget(targetAzimuth)
    • polarSpring.setTarget(targetPolar)
    • distanceSpring.setTarget(targetDistance)
        │
        ▼
  camera.isAnimating = true
  controls.enabled = false
        │
        ▼
  useFrame loop (every frame):
    • step all 3 springs by clamped delta
    • convert spherical → cartesian
    • update camera.position + controls.target
    • if all springs settled → isAnimating = false, re-enable controls
```

### Spring Physics

Three independent `SpringValue` instances drive the camera:

| Spring | Animates | Notes |
|---|---|---|
| `azimuthSpring` | Horizontal rotation (θ) | Uses shortest-arc normalization to prevent 340° swings |
| `polarSpring` | Vertical tilt (φ) | Clamped to avoid flipping over poles |
| `distanceSpring` | Zoom level (r) | Clamped to `[MIN_ZOOM, MAX_ZOOM]` |

Each uses **semi-implicit Euler integration** with the damped spring equation:

```
F = -stiffness × (position - target) - damping × velocity
acceleration = F / mass
velocity += acceleration × dt
position += velocity × dt
```

### Spring Presets by Interaction Type

| Interaction | Stiffness | Damping | Mass | Feel |
|---|---|---|---|---|
| Region tap | 120 | 14 | 1.0 | Snappy, precise |
| Country tap | 80 | 12 | 1.0 | Smooth, cinematic |
| Double-tap zoom | 200 | 18 | 0.8 | Instant, punchy |
| Pinch release | 150 | 16 | 1.0 | Elastic settle |
| Home reset | 60 | 10 | 1.2 | Slow, dramatic |

### Key Behaviors

1. **Mid-flight retargeting:** If the user taps a new region while the camera is still animating, the springs simply receive new targets and smoothly redirect — no jarring resets.

2. **Shortest-arc longitude:** A normalization function ensures longitude deltas stay in (-180°, 180°], so the camera always rotates the short way around.

3. **Frame-rate independence:** The spring stepper receives actual frame `delta` (clamped to 32ms max) — animation speed is consistent regardless of device performance.

4. **Input gating:** During animation, `OrbitControls.enabled = false` prevents user gestures from conflicting with the spring-driven motion. Controls re-enable the instant all springs settle.

---

## 4. 3D Engine & Geospatial Rendering

### Rendering Pipeline

```
assets/data/world-110m.json  (TopoJSON)
        │
        ▼
  topoLoader.ts — parseTopoJSON()
  ┌─────────────────────────────────────┐
  │ • topojson-client.feature() → GeoJSON │
  │ • Filter by minAreaDeg2              │
  │ • Extract rings, centroid, bbox      │
  │ • Compute areaKm2                    │
  └───────────────┬─────────────────────┘
                  ▼
  Record<RegionId, RegionGeometry>  → store.geometries
        │
        ├── GlobeMesh.tsx (merged draw)
        │   │
        │   ├── triangulation.ts — triangulateMultiPolygon()
        │   │   • Earcut 2D triangulation in lon/lat space
        │   │   • Project vertices onto sphere via latLonToCartesian()
        │   │   • Output: positions[], normals[], uvs[], indices[]
        │   │
        │   ├── Merge into single BufferGeometry
        │   │   • Per-vertex color attribute (DynamicDrawUsage)
        │   │   • Per-vertex highlight attribute (hover/select)
        │   │   • faceIndex → RegionId lookup table
        │   │
        │   └── meshStandardMaterial (vertexColors: true)
        │
        ├── Borders.tsx
        │   • Great-circle tessellation via slerpOnSphere()
        │   • Merged LineSegments at BORDER_ELEVATION (1.002×R)
        │
        ├── Atmosphere.tsx
        │   • Custom ShaderMaterial (atmosphere.vert + atmosphere.frag)
        │   • Fresnel rim glow: F = (1 - |V·N|)^exp × intensity
        │   • BackSide rendering, additive blending, no depth write
        │
        ├── RegionLabels.tsx
        │   • Centroid → 3D position via latLonToCartesian()
        │   • drei <Text> placeholder
        │
        └── CameraController.tsx
            • 3 SpringValue instances (azimuth, polar, distance)
            • useFrame stepping + sphericalToCartesian conversion
```

### Coordinate Convention

Three.js Y-up coordinate system with the mapping:

```
x = -R × cos(φ) × cos(λ)
y =  R × sin(φ)
z =  R × cos(φ) × sin(λ)

where:
  R = GLOBE_RADIUS (1.0)
  φ = latitude in radians
  λ = longitude in radians
```

### Performance Architecture

| Technique | Impact |
|---|---|
| **Merged BufferGeometry** | All ~180 regions in a single draw call. Eliminates per-region overhead. |
| **DynamicDrawUsage colors** | Color attribute updates on paint without rebuilding geometry. |
| **Grid spatial index** | 5° cells for O(1) region hit-testing on tap/hover. |
| **Lazy Turf.js loading** | `@turf/turf` (~300KB) loaded via `import()` only when needed. |
| **Shared materials** | Ocean sphere and merged mesh share material instances. |
| **BackSide atmosphere** | Single-pass Fresnel with no depth writes — zero overdraw. |

### GLSL Shaders

| File | Purpose | Key Uniforms |
|---|---|---|
| `atmosphere.vert` | View-space normal + position for Fresnel | — |
| `atmosphere.frag` | Fresnel glow with configurable exponent | `uAtmosphereColor`, `uFresnelExponent`, `uIntensity`, `uMaxOpacity` |
| `region.vert` | Elevation extrusion along surface normal | `uElevation` |
| `region.frag` | Lambertian + Blinn-Phong with hover/select | `uBaseColor`, `uLightDir`, `uAmbient`, `uHovered`, `uSelected`, `uTime` |

---

## 5. State Management Architecture

### Slice Pattern

```
useWorldStore.ts (Zustand create)
  │
  ├── persistMiddleware.ts
  │   └── Debounced (500ms) auto-save to MMKV
  │
  ├── regionSlice.ts
  │   ├── loadGeometries(geometries)
  │   └── updateRegion(id, patch)
  │
  ├── countrySlice.ts
  │   ├── createCountry(name, color) → CountryId
  │   ├── updateCountry(id, patch)
  │   ├── deleteCountry(id)
  │   ├── assignRegion(regionId, countryId)
  │   ├── unassignRegion(regionId)
  │   └── fuseCountries(sourceId, targetId)
  │
  ├── geoEditSlice.ts                            ← NEW
  │   ├── completeFuse(idA, idB, result) → RegionId
  │   └── completeSplit(originalId, result) → RegionId[]
  │
  ├── cameraSlice.ts
  │   ├── flyTo(target, distance)
  │   └── setCameraImmediate(patch)
  │
  ├── interactionSlice.ts
  │   ├── selectRegion(id)
  │   ├── selectCountry(id)
  │   ├── setHoveredRegion(id)
  │   ├── setActiveTool(tool)
  │   ├── setPaintCountry(id)
  │   └── toggleBottomSheet(open?)
  │
  └── settingsSlice.ts
      └── updateSettings(patch)
```

### Persistence Flow

```
Mutation occurs (e.g. assignRegion)
        │
        ▼
  persistMiddleware intercepts set()
        │
        ▼
  Debounce timer (500ms)
        │
        ▼
  Extract PersistableWorldState:
    { regions, countries, settings }
        │
        ▼
  mmkvStorage.saveState()
    → JSON.stringify → MMKV.set(key, json)
```

```
App launch
        │
        ▼
  _layout.tsx → usePersistence()
        │
        ▼
  mmkvStorage.initStorage()  (MMKV instance or in-memory fallback)
        │
        ▼
  store.rehydrate()
    → MMKV.getString(key) → JSON.parse → set({ regions, countries, settings })
        │
        ▼
  index.tsx → parseTopoJSON → store.loadGeometries()
        │
        ▼
  App rendered ✓
```

### What Is Persisted vs Transient

| Persisted (MMKV) | Transient (reset on launch) |
|---|---|
| `regions` (RegionMeta map) | `geometries` (rebuilt from TopoJSON) |
| `countries` (Country map) | `camera` (reset to default position) |
| `settings` (WorldSettings) | `interaction` (selection, tool, hover) |

---

## 6. UI & HUD Layer

### Component Hierarchy

```
_layout.tsx (RootLayout)
  ├── <ErrorBoundary onReset={resetWorld}>     ← catches WebGL/Turf/store errors
  │   └── <GestureHandlerRootView>
  │       └── <Suspense fallback={<LoadingScreen />}>   ← route-level lazy boundary
  │           └── <Slot />  ← Expo Router
  │
  └── index.tsx (MainScreen)  ← lazy-loaded by router
      │
      ├── <Suspense fallback={<LoadingScreen />}>  ← Canvas-level lazy boundary
      │   └── <LazyCanvas>  ── R3F Context (React.lazy) ──────────────
      │       └── <GlobeConnected />
      │           └── <LazyGlobe>   (React.lazy)
      │               ├── ambientLight + directionalLight
      │               ├── <GlobeMesh />         Ocean + merged regions
      │               ├── <Borders />           Political border lines
      │               ├── <RegionLabels />      Floating text
      │               ├── <Atmosphere />        Fresnel glow
      │               └── <CameraController />  Spring-driven orbiting
      │
      ├── <Suspense fallback={null}>  ← HUD lazy boundary
      │   └── <HUD>  ── React Native Overlay (pointerEvents="box-none") ──
      │       ├── <LazyWorldNameBadge />  Top center
      │       ├── <LazyToolBar />         Bottom center
      │       └── <LazyToastNotification />
      │
      └── <Suspense fallback={null}>
          └── <LazyBottomSheet />   Bottom sheet — region/country info
```

### Editor Tools

| Tool | Icon | Behavior on Tap |
|---|---|---|
| `select` | 👆 | Fly to region, open info sheet |
| `paint` | 🎨 | Assign tapped region to active country |
| `erase` | 🧹 | Remove tapped region from its country |
| `split` | ✂️ | Split country at border (future) |
| `fuse` | 🔗 | Merge two adjacent countries (future) |

### Toast Notification System

Event-bus pattern for decoupled messaging:

```typescript
// From anywhere in the app:
import { showToast } from '../components/hud/ToastNotification';

showToast('Country created!', 'success');
showToast('Region assigned', 'info');
showToast('Failed to save', 'error');
```

---

## 7. Geospatial Services

### Utility Modules

| Module | Purpose | Key Exports |
|---|---|---|
| `projection.ts` | Coordinate transforms | `latLonToCartesian`, `cartesianToLatLon`, `surfaceNormal`, `greatCircleDistance`, `slerpOnSphere` |
| `triangulation.ts` | Polygon → GPU mesh | `triangulatePolygon`, `triangulateMultiPolygon` |
| `topoLoader.ts` | TopoJSON parsing | `parseTopoJSON`, `createDefaultRegionMetas` |
| `spatialIndex.ts` | Hit-testing index | `SpatialIndex.build()`, `SpatialIndex.query()`, `pointInPolygon` |
| `screenProjection.ts` | 2D screen → 3D geo | `screenToGeo`, `screenLineToGeoLine`, `raySphereIntersect`, `screenToRay` |
| `camera.ts` | Spring physics | `SpringValue`, `SPRING_PRESETS`, `sphericalToCartesian`, `computeZoomDistance` |
| `color.ts` | Color manipulation | `hexToRgb`, `lighten`, `darken`, `lerpColor` |
| `turfService.ts` | Turf.js facade | `computeCentroid`, `computeArea`, `computeBbox`, `bufferPolygon`, `simplifyPolygon` |
| `regionOps.ts` | Country-level ops | `getCountryBbox`, `getCountryCentroid`, `getCountryArea`, `areRegionsAdjacent`, `findAdjacentRegions` |
| `geoManipulation.ts` | Fuse & Split engine | `fuseRegions`, `splitRegion`, `areRegionsTouching`, `generateSplitRegionId` |

### SpatialIndex Architecture

```
SpatialIndex.build(geometries)
  │
  ├── For each region:
  │   ├── Compute bbox [west, south, east, north]
  │   └── Insert into all overlapping 5° grid cells
  │
  └── Grid: Record<string, { regionId, bbox }[]>
      Key = "cellLon:cellLat" (e.g. "-10:45")

SpatialIndex.query(lon, lat)
  │
  ├── Compute cell key for (lon, lat)
  ├── Get candidates from grid cell
  ├── Phase 1: Reject by bbox
  └── Phase 2: Exact point-in-polygon test
      └── Returns RegionId | null
```

---

## 8. Hooks API

| Hook | Input | Output | Used By |
|---|---|---|---|
| `useRegionTap(geometries, onTap)` | Geometry map, callback | R3F `onPointerDown` handler | Globe.tsx |
| `useFlyTo()` | — | `(lon, lat, bbox?) => void` | Any component |
| `usePersistence()` | — | `{ isReady: boolean }` | _layout.tsx |
| `useSpring({ from, config, onChange, onSettled })` | Spring config | `{ value, setTarget, snap, isSettled }` | CameraController, any R3F component |
| `useDrawLine(cameraRef, options)` | Camera ref, callbacks | `{ phase, screenPoints, onTouch* }` | DrawingOverlay.tsx |

---

## 9. Geospatial Manipulation Engine (Fuse & Split)

The geographic editing system allows users to **fuse** two regions into one or **split** a region by drawing a cutting line. All heavy polygon math is performed via Turf.js, structured for non-blocking execution.

### 9.1 Non-Blocking Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Main Thread (React Native UI)                                          │
│                                                                         │
│  User taps "Fuse" or draws a split line                                 │
│       │                                                                 │
│       ▼                                                                 │
│  Call async fuseRegions() or splitRegion()                               │
│  ┌──────────────────────────────────────────────┐                       │
│  │  geoManipulation.ts (async, lazy-loaded)     │                       │
│  │                                              │                       │
│  │  • Each function is async                    │                       │
│  │  • Turf modules lazy-loaded via import()     │                       │
│  │  • Returns discriminated union result type   │                       │
│  │  • Zero React/R3F dependencies               │                       │
│  │                                              │                       │
│  │  ┌────────────────────────────────────────┐  │                       │
│  │  │  Future: Move to Web Worker via        │  │                       │
│  │  │  Comlink/expo-worker. Call sites stay   │  │                       │
│  │  │  identical because they already await   │  │                       │
│  │  │  Promises.                             │  │                       │
│  │  └────────────────────────────────────────┘  │                       │
│  └──────────────────────────────────────────────┘                       │
│       │                                                                 │
│       ▼                                                                 │
│  On success → store.completeFuse() / store.completeSplit()              │
│  (Atomic Zustand state update)                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Fuse (Union) Algorithm

```
User selects regionA and regionB
        │
        ▼
  Validate: both have geometry, both are adjacent (areRegionsTouching)
        │
        ▼
  await fuseRegions(geometryA, geometryB)
  ┌─────────────────────────────────────────────────────┐
  │ 1. Lazy-load: @turf/union, @turf/centroid,          │
  │    @turf/bbox, @turf/area (cached after first call)  │
  │                                                     │
  │ 2. Build Turf Polygon features from Ring[] arrays   │
  │                                                     │
  │ 3. Execute turf.union(polyA, polyB)                 │
  │    • Adjacent → result is Polygon                   │
  │    • Disjoint → result is MultiPolygon              │
  │                                                     │
  │ 4. Extract coordinates → Ring[] format              │
  │                                                     │
  │ 5. Compute centroid, bbox, areaKm²                  │
  │                                                     │
  │ 6. Return FuseSuccess { rings, centroid, bbox, ... } │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  store.completeFuse(idA, idB, result)
  ┌─────────────────────────────────────────────────────┐
  │ 1. Create new RegionGeometry with merged polygon    │
  │ 2. Create new RegionMeta (inherit from region A)    │
  │ 3. Delete both original regions from all maps       │
  │ 4. Update Country ownership:                        │
  │    • Remove old IDs from regionIds[]                │
  │    • Add merged ID to first owner                   │
  │    • Fix capitalRegionId if affected                │
  │ 5. Update interaction state (selection/hover)       │
  │ 6. Single atomic set() call                         │
  └─────────────────────────────────────────────────────┘
```

### 9.3 Split (Difference) Algorithm — 2D Screen → 3D Geospatial Cut

The split operation requires a multi-stage projection pipeline to translate a user's finger swipe into a geographic cutting line.

#### Stage A: Screen → Globe Projection Pipeline

```
  Finger position (px)
        │
        ▼
  Step 1: SCREEN → NDC
    ndcX = (px.x / viewport.width)  × 2 − 1
    ndcY = (px.y / viewport.height) × −2 + 1    ← Y flipped
        │
        ▼
  Step 2: NDC → 3D RAY
    nearPoint = invViewProjection × [ndcX, ndcY, -1, 1]   (perspective divide)
    farPoint  = invViewProjection × [ndcX, ndcY,  1, 1]   (perspective divide)
    rayDir    = normalize(farPoint − nearPoint)
    rayOrigin = camera.position
        │
        ▼
  Step 3: RAY-SPHERE INTERSECTION
    Solve: |rayOrigin + t × rayDir|² = R²
    
    a = dot(d, d) = 1
    b = 2 × dot(O, d)
    c = dot(O, O) − R²
    discriminant = b² − 4ac
    
    disc < 0  → miss (finger off globe)
    disc ≥ 0  → t = (−b − √disc) / 2a
    hitPoint  = O + t × d
        │
        ▼
  Step 4: CARTESIAN → GEOGRAPHIC
    lat = arcsin(y / R) × (180/π)
    lon = atan2(z, −x)  × (180/π)
        │
        ▼
  [longitude, latitude] ✓
```

#### Stage B: Cutting Line Processing

```
  Array of [lon, lat] points from Stage A
        │
        ▼
  Extend line 5° beyond endpoints (ensures clean bisection)
        │
        ▼
  await splitRegion(geometry, cuttingLine)
  ┌─────────────────────────────────────────────────────┐
  │ 1. Build Turf LineString from cutting line           │
  │                                                     │
  │ 2. Verify line intersects the region polygon         │
  │    (turfBooleanIntersects — early exit if no)        │
  │                                                     │
  │ 3. Buffer line into thin "blade" polygon (~1km)      │
  │    Why? turf.difference requires Polygon vs Polygon  │
  │    A LineString has zero area → cannot subtract      │
  │                                                     │
  │ 4. turf.difference(regionPoly, bladePoly)            │
  │    • Full bisection → MultiPolygon (2+ parts)       │
  │    • Partial clip → single Polygon (no split)       │
  │                                                     │
  │ 5. Extract each part → compute centroid, bbox, area  │
  │    Filter out slivers below minAreaKm² threshold     │
  │                                                     │
  │ 6. Return SplitSuccess { parts[] }                   │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  store.completeSplit(originalId, result)
  ┌─────────────────────────────────────────────────────┐
  │ 1. Generate new RegionIds: "US-CA-a", "US-CA-b"     │
  │ 2. Create RegionGeometry for each part               │
  │ 3. Create RegionMeta (inherit parent, label + suffix)│
  │ 4. Delete original region from all maps              │
  │ 5. Update Country ownership:                         │
  │    • Remove original ID                              │
  │    • Insert all new part IDs at same position         │
  │    • Capital → largest part by area                   │
  │ 6. Single atomic set() call                           │
  └─────────────────────────────────────────────────────┘
```

### 9.4 Drawing Overlay Architecture

```
index.tsx (MainScreen)
  │
  ├── <Canvas>
  │     └── <Globe />
  │           └── <CameraController />
  │                 └── Updates cameraRef every frame:
  │                       { position, invViewProjection, viewport }
  │
  ├── <DrawingOverlay />  ← React Native layer (NOT inside Canvas)
  │     ├── GestureDetector (react-native-gesture-handler Pan)
  │     ├── useDrawLine(cameraRef, { onLineComplete, onLineFailed })
  │     └── <Svg> preview line (react-native-svg)
  │           ├── Dashed Polyline (red, 3px)
  │           └── Circle endpoints (start/end markers)
  │
  └── <HUD />
        └── <ToolBar /> ← activeTool === 'split' enables overlay
```

### 9.5 Result Types (Discriminated Unions)

All geo-manipulation functions return discriminated union types for safe error handling:

```typescript
// Success path
{ ok: true, rings: Ring[], centroid: [lon, lat], bbox: [...], areaKm2: number }

// Error path (displayed as toast notification)
{ ok: false, reason: "Human-readable error message" }
```

This pattern eliminates try/catch in components — callers just check `result.ok`.

### 9.6 Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| Fuse disjoint regions | Valid MultiPolygon returned (both shapes kept) |
| Fuse identical regions | Degenerate but safe (result = input) |
| Split line doesn't cross region | Error: "does not intersect" |
| Split produces tiny slivers | Filtered by minAreaKm² threshold (default 100) |
| Split line crosses 3+ times | May produce 3+ valid parts (all returned) |
| Self-intersecting polygon | Turf.js error caught, user-friendly message |
| Degenerate/NaN coordinates | Caught by try/catch, returns `{ ok: false }` |
| Finger drawn off-globe | Points silently dropped (raySphereIntersect returns null) |

### 9.7 ID Conventions

| Operation | New ID Format | Example |
|---|---|---|
| Fuse | `{idA}+{idB}` | `US-CA+US-NV` |
| Split | `{parentId}-{a\|b\|c\|...}` | `US-CA-a`, `US-CA-b` |

IDs are traceable — you can always determine lineage from the naming.

---

## 10. Interactivity & Tool System

### Tool Behavior Matrix

| Tool | Tap on Region | Tap on Empty | Draw Gesture | Second Tap |
|---|---|---|---|---|
| `select` | Fly to region, open info sheet | Deselect | — | — |
| `paint` | Assign region to active country | — | — | — |
| `erase` | Remove region from its country | — | — | — |
| `split` | — | — | Draw cutting line across region | — |
| `fuse` | Select first region (highlight) | Cancel | — | If adjacent → fuse; if not → error toast |

### Fuse Tool UX Flow

```
1. User activates "Fuse" tool in ToolBar
2. User taps Region A → highlighted (selectedRegionId = A)
3. User taps Region B
   ├── If adjacent:
   │   ├── Show "Fusing..." toast
   │   ├── await fuseRegions(geomA, geomB)
   │   ├── store.completeFuse(A, B, result)
   │   ├── Rebuild spatial index
   │   ├── Show "Regions fused!" toast
   │   └── Select the merged region
   └── If NOT adjacent:
       └── Show "Regions must share a border" error toast
```

### Split Tool UX Flow

```
1. User activates "Split" tool in ToolBar
2. DrawingOverlay becomes active (captures touches)
3. User draws a line across a region
4. On finger lift:
   ├── screenLineToGeoLine() → [lon, lat][]
   ├── Determine which region the line crosses (spatial index)
   ├── Show "Splitting..." toast
   ├── await splitRegion(geometry, geoLine)
   ├── store.completeSplit(originalId, result)
   ├── Rebuild spatial index
   └── Show "Region split into N parts!" toast
```

### Spatial Index Rebuild

After any fuse or split, the `SpatialIndex` must be rebuilt because the geometry map has changed. This is handled by the component layer:

```typescript
// In Globe.tsx or a useEffect in the main screen:
useEffect(() => {
  spatialIndexRef.current = null; // Invalidate → lazy rebuild on next query
}, [geometries]); // Triggers on any geometry map change
```

---

## 11. Getting Started

### Prerequisites

- Node.js ≥ 18
- Expo CLI (installed via `npx expo`)
- iOS Simulator (macOS) or Android Emulator
- Expo SDK 54 | React 19.1 | React Native 0.81 | R3F 9 | drei 10

### Setup

```bash
# Clone and enter directory
cd earth

# Install dependencies
npm install

# Download real world TopoJSON (replace placeholder)
# From https://github.com/topojson/world-atlas
# Place as: assets/data/world-110m.json

# Start Expo development server
npx expo start
```

### Scripts

| Command | Description |
|---|---|
| `npm start` | Start Expo dev server |
| `npm run android` | Start on Android emulator |
| `npm run ios` | Start on iOS simulator |
| `npm run web` | Start web version |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Jest tests |
| `npm run bundle:ios` | Export iOS production bundle |
| `npm run bundle:android` | Export Android production bundle |
| `npm run bundle:analyze` | Source-map-explorer interactive HTML report |
| `npm run bundle:stats` | Custom bundle analysis (budget + Turf tree-shake check) |

### Project Configuration

| File | Purpose |
|---|---|
| `app.config.ts` | Expo SDK 54 config — `newArchEnabled: true`, typed routes, encryption key ID |
| `tsconfig.json` | TypeScript strict mode + `noUncheckedIndexedAccess`, `noUnusedLocals/Params` |
| `babel.config.js` | Babel preset + Reanimated plugin + `transform-remove-console` (production) |
| `metro.config.js` | Registers `.vert`/`.frag`/`.glsl` as source extensions |

---

## 12. Architecture Principles

1. **Offline-First** — All user data persisted to MMKV. No network dependency.
2. **Separation of Concerns** — R3F components never import React Native components. Both consume the store.
3. **Type Safety** — Branded `RegionId`/`CountryId` types prevent accidental cross-lookups. Strict `noUncheckedIndexedAccess` enforced.
4. **Performance Budget** — Single draw call for all regions. 60fps target on mid-range mobile.
5. **Testability** — Pure utility functions. Components accept props for test injection.
6. **Framework Agnostic Core** — Spring physics, coordinate math, and spatial indexing have zero React dependencies.
7. **Non-Blocking Geo Ops** — All Turf.js operations are async with lazy imports. Ready for Web Worker migration without changing call sites.
8. **Discriminated Union Results** — Geo-manipulation functions return `{ ok: true, ... } | { ok: false, reason }` instead of throwing, enabling safe UI error handling.
9. **Defense-in-Depth Persistence** — Zod validation on hydration, backup saves, salvage recovery, and MMKV encryption via platform keychain.
10. **Zero-Leak GPU Resources** — All Three.js geometries, materials, and textures explicitly disposed on unmount via centralized disposal utilities.
11. **Resilient Error Recovery** — Global `<ErrorBoundary>` catches WebGL context loss, Turf math failures, and store corruption with retry/reset UI. No unhandled crash reaches the user.
12. **Code-Split & Lazy-Loaded** — Globe, Canvas, and HUD components are `React.lazy()` loaded. TopoJSON parsing is deferred via `InteractionManager`. TTI target: <1.5s.
13. **Tree-Shaken Dependencies** — `@turf/turf` monolith replaced with individual `@turf/*` packages. Console logs stripped at compile time via Babel plugin.
14. **New Architecture (Fabric + TurboModules)** — Expo SDK 54 with `newArchEnabled: true`. Bridgeless mode eliminates legacy bridge overhead.

---

## 13. Security, Persistence & Performance

### 13.1 Persistence Architecture (MMKV + Zustand + Zod)

The persistence pipeline has three hardened layers: a Zustand middleware for automatic saves, MMKV for fast native storage, and Zod for schema validation on hydration.

#### Data Flow: Save Path

```
Mutation occurs (e.g. assignRegion, paintRegion)
        │
        ▼
  persistMiddleware intercepts set()
        │
        ▼
  Debounce timer (500ms) — prevents thrashing during rapid painting
        │
        ▼
  Extract PersistableWorldState:
    { regions, countries, settings }
        │
        ▼
  Promote current save → backup key (rollback safety net)
        │
        ▼
  mmkvStorage.saveState()
    → JSON.stringify → MMKV.set(key, json)
    → MMKV.set(versionKey, STORAGE_VERSION)
```

#### Data Flow: Load Path (with Zod Validation)

```
App launch
        │
        ▼
  _layout.tsx → usePersistence()
        │
        ▼
  mmkvStorage.initStorage()
    → MMKV instance with encryptionKey
    → Falls back to in-memory adapter on web
        │
        ▼
  mmkvStorage.loadState()
    │
    ├─ Step 1: Parse primary save (JSON.parse)
    │   ├─ Success → Zod validatePersistedState()
    │   │   ├─ Valid → return cleaned data ✓
    │   │   └─ Invalid → salvagePersistedState() (best-effort recovery)
    │   └─ Failure (corrupt JSON) → try backup
    │
    ├─ Step 2: Parse backup save
    │   └─ Same validation pipeline as Step 1
    │
    └─ Step 3: All failed → return null (use defaults)
        │
        ▼
  store.rehydrate()
    → Merge validated data into Zustand store
        │
        ▼
  index.tsx → parseTopoJSON → store.loadGeometries()
        │
        ▼
  App rendered ✓
```

#### Zod Validation Schemas

```
PersistableWorldStateSchema
  ├── regions:   Record<RegionId, RegionMetaSchema>
  │     ├── id:            string (non-empty)
  │     ├── label:         string | null
  │     ├── colorOverride: hex color | null
  │     ├── elevation:     number [0.5, 2.0]
  │     └── customData:    Record<string, string>
  │
  ├── countries: Record<CountryId, CountrySchema>
  │     ├── id:              string (non-empty)
  │     ├── name:            string [1, 200]
  │     ├── color:           hex color
  │     ├── flag:            string | null
  │     ├── regionIds:       string[]
  │     ├── capitalRegionId: string | null
  │     ├── customData:      Record<string, string>
  │     ├── createdAt:       ISO-8601 date
  │     └── updatedAt:       ISO-8601 date
  │
  └── settings:  WorldSettingsSchema
        ├── worldName:             string [1, 100]
        ├── unownedRegionColor:    hex color
        ├── oceanColor:            hex color
        ├── showBorders:           boolean
        ├── borderWidth:           number [0, 0.1]
        ├── borderColor:           hex color
        ├── showAtmosphere:        boolean
        ├── ambientLightIntensity: number [0, 1]
        ├── showLabels:            boolean
        └── autoRotateSpeed:       number [0, 1]
```

#### Salvage Recovery

When full validation fails, `salvagePersistedState()` validates each entity individually:

```
Raw JSON (partially corrupt)
        │
        ▼
  For each region in raw.regions:
    ├─ Zod parse → valid → keep
    └─ Zod parse → invalid → discard
        │
        ▼
  For each country in raw.countries:
    ├─ Zod parse → valid → keep
    │   └─ Filter regionIds to only reference valid regions
    └─ Zod parse → invalid → discard
        │
        ▼
  Settings:
    ├─ Zod parse → valid → keep
    └─ Zod parse → invalid → use defaults
        │
        ▼
  Return cleaned PersistableWorldState (best-effort)
```

#### Key Files

| File | Purpose |
|---|---|
| `services/persistence/mmkvStorage.ts` | MMKV adapter with backup saves, encryption, Zod validation |
| `services/persistence/validation.ts` | Zod schemas, `validatePersistedState()`, `salvagePersistedState()` |
| `store/middleware/persistMiddleware.ts` | Zustand middleware with debounced save, `rehydrate()`, `resetWorld()` |
| `hooks/usePersistence.ts` | One-shot initialization + rehydration hook for `_layout.tsx` |

### 13.2 MMKV Security Configuration

| Feature | Implementation |
|---|---|
| **Encryption at rest** | MMKV initialized with `encryptionKey: 'my-world-v1'` |
| **Backup saves** | Previous save promoted to `{key}:backup` before each write |
| **Schema versioning** | `STORAGE_VERSION` stamp enables future data migrations |
| **No-crash guarantee** | All load paths wrapped in try/catch with fallback to defaults |
| **Type-safe hydration** | Zod schemas enforce every field has correct type and range |
| **Referential integrity** | Salvage recovery filters orphaned `regionIds` from countries |

### 13.3 Three.js Memory Management

GPU resources allocated by Three.js are **not** garbage collected by JavaScript. Every geometry, material, and texture must be explicitly disposed when no longer needed.

#### Disposal Utility API

```
src/utils/disposal.ts
  │
  ├── disposeGeometry(geometry)        — Free vertex/index GPU buffers
  ├── disposeMaterial(material)        — Free shader program + textures
  ├── disposeTexture(texture)          — Free GPU texture memory
  ├── disposeMesh(mesh)                — Geometry + material combo
  ├── disposeLine(line)                — LineSegments geometry + material
  ├── disposeSceneGraph(root)          — Recursive traversal of Object3D tree
  └── createCleanup({ geometries, materials, textures, meshes, lines, scenes })
      └── Returns a () => void suitable for useEffect return
```

#### Component Disposal Pattern

Every R3F component that creates GPU resources follows this pattern:

```typescript
// In GlobeMesh.tsx:
const { mergedGeometry } = useMemo(() => {
  // ... build geometry
  return { mergedGeometry: geometry };
}, [geometries]);

// Dispose when geometry changes or component unmounts
useEffect(() => {
  return () => {
    disposeGeometry(mergedGeometry);
  };
}, [mergedGeometry]);
```

#### Components with Disposal

| Component | Disposed Resources | Trigger |
|---|---|---|
| `GlobeMesh` | Merged BufferGeometry (positions, normals, colors, indices) | Geometry cache change or unmount |
| `Atmosphere` | Sphere geometry + ShaderMaterial (Fresnel shader) | Component unmount |
| `Borders` | LineSegments BufferGeometry | Geometry cache change or unmount |

### 13.4 Production Performance Checklist

#### ✅ Implemented

| # | Optimization | Impact |
|---|---|---|
| 1 | **Hermes engine** (Expo SDK 54 default) | AOT compilation, 50% less memory, faster startup |
| 2 | **Console log stripping** (babel-plugin-transform-remove-console) | Zero runtime string formatting in production |
| 3 | **Three.js disposal** | Prevents WebGL context loss from GPU leaks |
| 4 | **Merged BufferGeometry** | ~180 regions in 1 draw call |
| 5 | **DynamicDrawUsage colors** | Color updates without geometry rebuild |
| 6 | **Grid spatial index** (5° cells) | O(1) region hit-testing |
| 7 | **Tree-shaken Turf.js** (individual `@turf/*` packages) | ~60KB vs ~300KB monolith, lazy-loaded |
| 8 | **MMKV persistence** (not AsyncStorage) | ~30x faster read/write |
| 9 | **Debounced saves** (500ms) | No disk thrashing during rapid paint |
| 10 | **React.memo** on all globe components | Prevents R3F re-reconciliation |
| 11 | **useCallback** with explicit deps | Stable callback references |
| 12 | **BackSide atmosphere** | Zero-overdraw Fresnel glow |
| 13 | **Zod validation on hydration** | Corrupt state → graceful recovery |
| 14 | **Backup save state** | Automatic rollback safety net |
| 15 | **MMKV encryption** (keychain-derived key via expo-secure-store) | Platform-grade at-rest protection |
| 16 | **React.lazy + Suspense** (Globe, Canvas, HUD) | Code-split initial bundle, <1.5s TTI |
| 17 | **Deferred TopoJSON parsing** (InteractionManager) | Main thread unblocked during startup |
| 18 | **Global ErrorBoundary** (classified: WebGL/Turf/Storage) | Crash recovery with retry + reset UI |
| 19 | **New Architecture** (Fabric + TurboModules + Bridgeless) | Eliminates legacy bridge serialization overhead |
| 20 | **Strict TypeScript** (`noUncheckedIndexedAccess`, `noUnusedLocals`) | Catches dead code and unsafe index access at compile time |

#### 🔲 Pre-Release Verification

| # | Check | How to Verify |
|---|---|---|
| 21 | Hermes bytecode output | `npx react-native info` → Hermes listed |
| 22 | ProGuard enabled (Android) | `minifyEnabled true` in build.gradle |
| 23 | Asset optimization | TopoJSON <200KB, no unused textures |
| 24 | Bundle size analysis | `npm run bundle:stats` → <5MB JS bundle |
| 25 | Memory profiling | Chrome DevTools / Flipper on 2GB device |
| 26 | Frame rate monitoring | Sustained 60fps, 45fps floor on low-end |
| 27 | Cold start time | <1.5s to interactive, MMKV rehydration <50ms |
| 28 | Dev features stripped | No DevTools, no debug HUD in production |
| 29 | Turf tree-shake verified | `npm run bundle:stats` → no `@turf/turf` monolith |
| 30 | New Architecture confirmed | `npx expo config` → `newArchEnabled: true` |
