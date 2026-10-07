/**
 * ============================================================================
 * store.ts — Zustand Store Schema & Domain Types
 * ============================================================================
 *
 * This file defines the **normalized, immutable-first** data model for the
 * "My World" 3D World Map Editor Sandbox.
 *
 * Design Principles
 * -----------------
 * 1. **Separation of Concerns** — Base geography (Region) is strictly
 *    decoupled from political overlays (Country). A Region knows nothing
 *    about who "owns" it; a Country holds an *array of Region IDs*.
 *
 * 2. **Normalized Lookups** — All entities live in `Record<string, T>` maps
 *    so every access is O(1). No nested arrays-of-objects to search.
 *
 * 3. **Offline-first Persistence** — The `PersistableWorldState` subset is
 *    what gets serialized to MMKV on every meaningful mutation. Transient 3D
 *    state (camera, hover highlights, selection) is *never* persisted.
 *
 * 4. **Immutable Geography** — `RegionGeometry` polygons come from a
 *    TopoJSON source and are treated as read-only at runtime. Only the
 *    `RegionMeta` layer (color overrides, labels) is mutable.
 *
 * 5. **Type Safety** — Branded ID types (`RegionId`, `CountryId`) prevent
 *    accidentally passing the wrong kind of string to a lookup function.
 */

// ─── Branded ID Types ──────────────────────────────────────────────────────
// Branded types give us compile-time guarantees that a RegionId can never be
// used where a CountryId is expected, even though both are strings at runtime.

/** Unique, immutable identifier for a geographic region (e.g. "US-CA"). */
export type RegionId = string & { readonly __brand: 'RegionId' };

/** Unique identifier for a user-defined country / political entity. */
export type CountryId = string & { readonly __brand: 'CountryId' };

// Helper factories — use these instead of raw casts.
export const regionId = (raw: string): RegionId => raw as RegionId;
export const countryId = (raw: string): CountryId => raw as CountryId;

// ─── Geometry (Immutable Base Layer) ────────────────────────────────────────

/**
 * A single closed polygon ring expressed as [longitude, latitude][] pairs.
 * Exterior rings are counter-clockwise; holes are clockwise (GeoJSON spec).
 */
export type Ring = [lon: number, lat: number][];

/**
 * Immutable geometry for one region, extracted from TopoJSON at load time.
 *
 * Why separate from `RegionMeta`?
 * — Geometry is *large* and *never changes*. Keeping it in its own map means
 *   we never accidentally serialize megabytes of coordinates to MMKV.
 */
export interface RegionGeometry {
  /** Identifier matching the corresponding RegionMeta entry. */
  readonly id: RegionId;

  /**
   * One or more polygon rings.
   * Multi-polygons (e.g., archipelagos) are stored as separate rings here;
   * the renderer decides how to triangulate them.
   */
  readonly rings: ReadonlyArray<Ring>;

  /**
   * Pre-computed centroid [lon, lat] used for label placement and
   * camera "fly-to" targeting. Calculated once via Turf.js.
   */
  readonly centroid: Readonly<[lon: number, lat: number]>;

  /**
   * Bounding box [west, south, east, north] for fast frustum culling
   * and spatial indexing. Calculated once via Turf.js.
   */
  readonly bbox: Readonly<[west: number, south: number, east: number, north: number]>;

  /**
   * Approximate area in km² — useful for sorting, UI display, and
   * weighting the camera zoom distance when framing a region.
   */
  readonly areaKm2: number;
}

// ─── Region Metadata (Mutable User Layer) ──────────────────────────────────

/**
 * Mutable metadata overlay for a region. This is the layer the user edits.
 *
 * Critically, `RegionMeta` does NOT embed geometry — it references it via
 * the shared `id`. This keeps the persisted state lightweight.
 */
export interface RegionMeta {
  /** Must match a key in the geometry map. */
  readonly id: RegionId;

  /**
   * Optional user-facing label override.
   * Falls back to the original geographic name if `null`.
   */
  label: string | null;

  /**
   * Hex color string (e.g. "#4A90D9") controlling the region's fill on the
   * globe mesh. `null` means "use the owning country's color" or the
   * default unowned color from WorldSettings.
   */
  colorOverride: string | null;

  /**
   * Elevation multiplier relative to the base globe radius.
   * 1.0 = flush with surface. >1.0 = extruded upward (e.g. for population
   * or GDP visualizations). Clamped to [0.98, 1.5] by the reducer.
   */
  elevation: number;

  /**
   * Arbitrary key-value pairs the user can attach (population, notes, etc.).
   * Kept as `Record<string, string>` for serialization simplicity.
   */
  customData: Record<string, string>;
}

// ─── Country (Political Entity) ────────────────────────────────────────────

/**
 * A Country is a *user-created* political entity that "owns" one or more
 * regions. It is entirely decoupled from the base geography.
 *
 * Use-cases:
 * • Painting regions → assigns the region's ID to `regionIds`.
 * • Fusing two countries → merge their `regionIds` arrays.
 * • Splitting a country → create a new Country & move IDs over.
 */
export interface Country {
  /** Unique country identifier (UUID v4). */
  readonly id: CountryId;

  /** User-chosen display name (e.g. "Atlantis"). */
  name: string;

  /**
   * Primary hex color applied to all owned regions that don't have a
   * per-region `colorOverride`.
   */
  color: string;

  /**
   * Flag emoji or a URI to a custom flag asset.
   * `null` means no flag has been assigned yet.
   */
  flag: string | null;

  /**
   * Ordered list of region IDs owned by this country.
   * Ordering determines draw priority for overlapping labels.
   */
  regionIds: RegionId[];

  /**
   * Capital region ID — used for camera targeting and label emphasis.
   * Must be a member of `regionIds` (enforced by action validators).
   */
  capitalRegionId: RegionId | null;

  /**
   * User-editable metadata fields for this country.
   * Same free-form approach as RegionMeta.customData.
   */
  customData: Record<string, string>;

  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;

  /** ISO-8601 timestamp of the last mutation. */
  updatedAt: string;
}

// ─── World Settings ────────────────────────────────────────────────────────

/**
 * Global settings governing the look & feel of the sandbox world.
 * Persisted to MMKV alongside the entity maps.
 */
export interface WorldSettings {
  /** User-chosen world name displayed in the HUD. */
  worldName: string;

  /**
   * Hex color for regions that belong to no country.
   * Good default: a muted gray like "#B0BEC5".
   */
  unownedRegionColor: string;

  /**
   * Hex color for the ocean / globe base material.
   */
  oceanColor: string;

  /**
   * Whether political borders between countries are rendered
   * as raised/outlined edges on the globe mesh.
   */
  showBorders: boolean;

  /**
   * Border line width in world units. Only meaningful when
   * `showBorders` is true.
   */
  borderWidth: number;

  /**
   * Hex color for political border lines.
   */
  borderColor: string;

  /**
   * Whether to render the atmospheric glow (Fresnel rim shader).
   * Can be toggled off for performance on low-end devices.
   */
  showAtmosphere: boolean;

  /**
   * Overall ambient light intensity [0, 1].
   * Controls how "dramatic" shadows look on the globe.
   */
  ambientLightIntensity: number;

  /**
   * Whether region name labels float above the globe surface.
   */
  showLabels: boolean;

  /**
   * Globe rotation speed when idle (auto-spin), in radians/sec.
   * 0 = no auto-spin.
   */
  autoRotateSpeed: number;
}

// ─── Camera / 3D Transient State ────────────────────────────────────────────

/**
 * Transient state that drives the 3D viewport.
 * This is NEVER persisted — it resets to defaults on app launch.
 */
export interface CameraState {
  /**
   * Spherical target the camera orbits around, in [lon, lat] degrees.
   * Animated via spring physics on country/region tap.
   */
  target: [lon: number, lat: number];

  /**
   * Distance from the globe center in world units.
   * Clamped to [MIN_ZOOM, MAX_ZOOM] defined in constants.
   */
  distance: number;

  /**
   * Whether the camera is currently animating (prevents user input
   * from interrupting a fly-to transition).
   */
  isAnimating: boolean;
}

// ─── Selection / Interaction State ──────────────────────────────────────────

/** Which editing tool the user has active. */
export type EditorTool =
  | 'select'   // Tap to inspect / view info panel
  | 'paint'    // Tap to assign region to active country
  | 'erase'    // Tap to remove region from its country
  | 'split'    // Tap border to split a country
  | 'fuse';    // Tap two adjacent countries to merge

/**
 * Transient interaction / selection state.
 * Not persisted — resets on app launch.
 */
export interface InteractionState {
  /** Currently selected region (highlighted on globe). `null` = nothing. */
  selectedRegionId: RegionId | null;

  /** Currently selected country (info panel target). `null` = nothing. */
  selectedCountryId: CountryId | null;

  /** Region the pointer/finger is currently hovering over. */
  hoveredRegionId: RegionId | null;

  /** Active editor tool. */
  activeTool: EditorTool;

  /**
   * The country whose color is applied when painting regions.
   * Only meaningful when `activeTool === 'paint'`.
   */
  paintCountryId: CountryId | null;

  /** Whether the bottom info/editor sheet is expanded. */
  isBottomSheetOpen: boolean;
}

// ─── Composite Store Slices ─────────────────────────────────────────────────

/**
 * The subset of state that gets serialized to MMKV for persistence.
 * Geometry is excluded — it's re-hydrated from the bundled TopoJSON asset.
 */
export interface PersistableWorldState {
  /** Normalized map of mutable region metadata. */
  regions: Record<RegionId, RegionMeta>;

  /** Normalized map of user-created countries. */
  countries: Record<CountryId, Country>;

  /** Global world settings. */
  settings: WorldSettings;
}

/**
 * Full Zustand store shape — the single source of truth for the entire app.
 *
 * Composed of:
 * 1. Persistable world data (regions, countries, settings)
 * 2. Immutable geometry cache (loaded from TopoJSON, never persisted)
 * 3. Transient 3D / interaction state
 * 4. Action methods (defined in the store implementation)
 */
export interface WorldStore extends PersistableWorldState {
  // ── Immutable Geometry Cache ────────────────────────────────────────────
  /** Loaded once from TopoJSON. Keyed by RegionId for O(1) lookup. */
  geometries: Record<RegionId, RegionGeometry>;

  // ── Transient State ─────────────────────────────────────────────────────
  camera: CameraState;
  interaction: InteractionState;

  // ── Derived Lookups (cached in selectors, not stored) ───────────────────
  // These are intentionally NOT in the store. Use Zustand selectors:
  //   useWorldStore(s => s.getCountryForRegion(regionId))
  //
  // • getCountryForRegion(regionId: RegionId): Country | null
  // • getRegionsForCountry(countryId: CountryId): RegionMeta[]
  // • getUnownedRegions(): RegionMeta[]

  // ── Actions — Geography Bootstrap ──────────────────────────────────────
  /**
   * Hydrate the geometry cache from parsed TopoJSON data.
   * Called once at app startup. Geometry is immutable after this.
   */
  loadGeometries: (geometries: Record<RegionId, RegionGeometry>) => void;

  // ── Actions — Region Mutations ─────────────────────────────────────────
  /** Update mutable fields on a region. Partial updates merged shallowly. */
  updateRegion: (id: RegionId, patch: Partial<Omit<RegionMeta, 'id'>>) => void;

  // ── Actions — Country CRUD ─────────────────────────────────────────────
  /** Create a new country with a generated UUID. Returns the new ID. */
  createCountry: (name: string, color: string) => CountryId;

  /** Update mutable fields on a country. */
  updateCountry: (id: CountryId, patch: Partial<Omit<Country, 'id' | 'createdAt'>>) => void;

  /** Delete a country. All its regions become unowned. */
  deleteCountry: (id: CountryId) => void;

  // ── Actions — Region ↔ Country Assignment ──────────────────────────────
  /**
   * Assign a region to a country (painting).
   * Automatically removes the region from any previous owner.
   */
  assignRegion: (regionId: RegionId, countryId: CountryId) => void;

  /**
   * Remove a region from its owning country (erasing).
   * The region becomes unowned.
   */
  unassignRegion: (regionId: RegionId) => void;

  /**
   * Fuse two countries: all regions from `sourceId` move to `targetId`,
   * then `sourceId` is deleted.
   */
  fuseCountries: (sourceId: CountryId, targetId: CountryId) => void;

  // ── Actions — Geographic Editing (Fuse / Split) ───────────────────────
  /**
   * Complete a fuse operation: merge two regions into one, update
   * geometries, regions, and country assignments atomically.
   */
  completeFuse: (
    regionIdA: RegionId,
    regionIdB: RegionId,
    result: import('../services/geospatial/geoManipulation').FuseSuccess,
    newId?: RegionId,
  ) => RegionId;

  /**
   * Complete a split operation: replace one region with multiple parts,
   * update geometries, regions, and country assignments atomically.
   */
  completeSplit: (
    originalId: RegionId,
    result: import('../services/geospatial/geoManipulation').SplitSuccess,
  ) => RegionId[];

  // ── Actions — Camera ───────────────────────────────────────────────────
  /**
   * Begin a spring-animated fly-to transition.
   * `target` is [lon, lat]; `distance` controls zoom level.
   */
  flyTo: (target: [number, number], distance: number) => void;

  /** Snap the camera immediately (no animation). */
  setCameraImmediate: (patch: Partial<CameraState>) => void;

  // ── Actions — Interaction ──────────────────────────────────────────────
  selectRegion: (id: RegionId | null) => void;
  selectCountry: (id: CountryId | null) => void;
  setHoveredRegion: (id: RegionId | null) => void;
  setActiveTool: (tool: EditorTool) => void;
  setPaintCountry: (id: CountryId | null) => void;
  toggleBottomSheet: (open?: boolean) => void;

  // ── Actions — Settings ─────────────────────────────────────────────────
  updateSettings: (patch: Partial<WorldSettings>) => void;

  // ── Actions — Persistence ──────────────────────────────────────────────
  /**
   * Serialize the persistable subset to MMKV.
   * Called automatically by middleware on every mutation, but can also
   * be triggered manually (e.g. before app backgrounding).
   */
  persist: () => void;

  /**
   * Rehydrate persistable state from MMKV.
   * Called once at startup, before `loadGeometries`.
   */
  rehydrate: () => void;

  /**
   * Reset the entire world to factory defaults (new blank globe).
   * Clears MMKV as well.
   */
  resetWorld: () => void;
}
