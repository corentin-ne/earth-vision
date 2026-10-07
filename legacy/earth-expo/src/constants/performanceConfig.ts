/**
 * ============================================================================
 * performanceConfig.ts — Production Performance Configuration
 * ============================================================================
 *
 * Centralizes performance-related constants and provides a production
 * readiness checklist for React Native + Expo + Three.js.
 *
 * These values are tuned for mid-range mobile devices (e.g., iPhone 12,
 * Pixel 6) targeting a consistent 60fps rendering loop.
 */

// ─── Performance Budget Constants ───────────────────────────────────────────

/** Maximum allowed draw calls per frame. Beyond this, merge geometries. */
export const MAX_DRAW_CALLS = 10;

/** Maximum texture resolution for mobile GPUs (px per side). */
export const MAX_TEXTURE_SIZE = 2048;

/** Maximum vertices in the merged region geometry before LOD kicks in. */
export const MAX_VERTEX_COUNT = 500_000;

/** Target frame time in ms (60fps). Performance monitoring threshold. */
export const TARGET_FRAME_MS = 16.67;

/** Maximum allowed geometry memory (MB) before triggering a warning. */
export const MAX_GEOMETRY_MEMORY_MB = 64;

/** MMKV save debounce interval (ms). Prevents disk thrashing. */
export const PERSIST_DEBOUNCE_MS = 500;

/** Maximum JSON state size before considering compression (bytes). */
export const MAX_STATE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ─── Production Readiness Checklist ─────────────────────────────────────────

/**
 * REACT NATIVE PERFORMANCE CHECKLIST
 * ===================================
 *
 * ✅ = Implemented  |  🔲 = Verify before release
 *
 * ── Engine & Runtime ────────────────────────────────────────────────────
 *
 * ✅ 1. HERMES ENGINE ENABLED
 *    Verify in app.json: "jsEngine": "hermes" (default in Expo SDK 52+).
 *    Hermes provides AOT compilation, reduced memory footprint, and
 *    faster startup. Confirm with:
 *      `const isHermes = () => !!global.HermesInternal;`
 *
 * ✅ 2. PRODUCTION BUILD OPTIMIZATIONS
 *    - Babel minification enabled (expo default)
 *    - Tree-shaking via Metro bundler
 *    - No `__DEV__` code paths in production
 *    - ProGuard/R8 for Android (expo default)
 *
 * ✅ 3. CONSOLE LOG STRIPPING
 *    babel-plugin-transform-remove-console enabled in babel.config.js
 *    for production builds. All console.* calls are removed at compile
 *    time — zero runtime string formatting overhead.
 *
 * ✅ 3a. EXPO SDK 54 + NEW ARCHITECTURE
 *    App migrated to Expo SDK 54 with New Architecture enabled:
 *    • Fabric (new rendering system)
 *    • TurboModules (native module interop)
 *    • Bridgeless mode (no legacy bridge)
 *    • React 19 + react-native 0.79
 *
 * ✅ 3b. LAZY-LOADED GLOBE + SUSPENSE
 *    Globe component and TopoJSON parser are React.lazy() loaded.
 *    Keeps initial JS bundle small for <1.5s TTI on mid-range devices.
 *
 * ✅ 3c. GLOBAL ERROR BOUNDARY
 *    ErrorBoundary wraps entire tree, catches WebGL context loss,
 *    Turf.js math failures, and store corruption with retry/reset UI.
 *
 * ✅ 3d. MMKV ENCRYPTION VIA KEYCHAIN
 *    Encryption key derived from expo-secure-store (platform keychain).
 *    Key generated once and stored securely — never hardcoded in JS.
 *
 * ✅ 3e. TURF.JS TREE-SHAKING
 *    @turf/turf monolith replaced with individual @turf/* packages.
 *    Only imported modules are bundled (~60KB vs ~300KB).
 *
 * ── Memory Management ───────────────────────────────────────────────────
 *
 * ✅ 4. THREE.JS DISPOSAL
 *    All geometries, materials, and textures are disposed in useEffect
 *    cleanup blocks via `src/utils/disposal.ts`. Prevents WebGL context
 *    loss from accumulated GPU resource leaks.
 *
 * ✅ 5. MERGED BUFFER GEOMETRY
 *    All ~180 regions rendered in a single draw call via merged
 *    BufferGeometry. Per-vertex colors updated via DynamicDrawUsage
 *    attribute — no geometry rebuild on paint.
 *
 * ✅ 6. LAZY TURF.JS LOADING
 *    @turf/turf (~300KB) loaded via dynamic import() only when
 *    fuse/split operations are triggered. Not in the critical path.
 *
 * ✅ 7. MMKV PERSISTENCE (NOT ASYNCSTORAGE)
 *    react-native-mmkv is a synchronous, C++ backed key-value store.
 *    ~30x faster than AsyncStorage. State serialization is debounced
 *    to 500ms to avoid disk thrashing during rapid paint operations.
 *
 * ── Rendering ───────────────────────────────────────────────────────────
 *
 * ✅ 8. REACT.MEMO ON ALL GLOBE COMPONENTS
 *    GlobeMesh, Atmosphere, Borders, RegionLabels, CameraController
 *    are all wrapped in React.memo to prevent unnecessary R3F reconciliation.
 *
 * ✅ 9. STABLE CALLBACK REFS
 *    All event handlers passed to R3F components use useCallback with
 *    explicit dependency arrays. Prevents re-renders from reference changes.
 *
 * ✅ 10. USEMEMO FOR EXPENSIVE COMPUTATIONS
 *     Geometry merging, border tessellation, and color maps are memoized.
 *     Only recomputed when their source data actually changes.
 *
 * ✅ 11. SPATIAL INDEX FOR HIT TESTING
 *     5° grid-based spatial index provides O(1) region lookup on tap.
 *     No full-geometry raycast scan per interaction.
 *
 * ✅ 12. ATMOSPHERE SHADER OPTIMIZATION
 *     - Single draw call (BackSide sphere)
 *     - No depth writes (zero overdraw with globe)
 *     - Additive blending (no alpha sorting)
 *     - ~10 instructions per fragment
 *
 * ── Data Integrity ──────────────────────────────────────────────────────
 *
 * ✅ 13. ZOD SCHEMA VALIDATION ON HYDRATION
 *     All persisted state is validated through Zod schemas before
 *     reaching the Zustand store. Corrupt/tampered saves trigger
 *     best-effort salvage recovery instead of crashes.
 *
 * ✅ 14. BACKUP SAVE STATE
 *     Previous save promoted to backup key before each write.
 *     Corrupt primary → falls back to backup automatically.
 *
 * ✅ 15. MMKV ENCRYPTION AT REST
 *     MMKV initialized with encryptionKey for basic at-rest encryption.
 *     Prevents trivial file-system snooping of save data.
 *
 * ── Build & Release ─────────────────────────────────────────────────────
 *
 * 🔲 16. VERIFY HERMES BYTECODE
 *     Run `npx react-native info` and confirm Hermes is listed.
 *     Check bundle size with `npx expo export --platform ios`.
 *
 * 🔲 17. ENABLE PROGUARD (ANDROID)
 *     Ensure `android/app/build.gradle` has:
 *       `minifyEnabled true`
 *       `shrinkResources true`
 *
 * 🔲 18. ASSET OPTIMIZATION
 *     - TopoJSON compressed (world-110m.json ~150KB)
 *     - No unused textures/fonts in assets/
 *     - Fonts subset to used glyphs only
 *
 * 🔲 19. BUNDLE ANALYSIS
 *     Run `npx expo export` and analyze output size.
 *     Target: <5MB JavaScript bundle (Hermes bytecode).
 *
 * 🔲 20. MEMORY PROFILING
 *     Test on low-end device (2GB RAM) with Chrome DevTools
 *     or Flipper. Verify no monotonic memory growth after
 *     repeated paint/fuse/split operations.
 *
 * 🔲 21. FRAME RATE MONITORING
 *     Use `useFrame` perf counter or Flipper FPS monitor.
 *     Target: 60fps sustained on mid-range devices.
 *     Acceptable: 45fps floor on low-end devices.
 *
 * 🔲 22. STARTUP TIME
 *     Measure cold start time with Flipper or custom markers.
 *     Target: <2s to interactive on mid-range devices.
 *     MMKV rehydration should be <50ms.
 *
 * 🔲 23. DISABLE DEV-ONLY FEATURES
 *     - Remove React DevTools in production
 *     - Disable R3F performance overlay
 *     - Remove any debug HUD components
 *     - Verify __DEV__ guards strip properly
 */
