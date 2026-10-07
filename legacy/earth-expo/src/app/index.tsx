/**
 * ============================================================================
 * index.tsx — Main Screen (Globe + HUD)
 * ============================================================================
 *
 * The primary screen rendered by expo-router at the "/" route.
 * Composes:
 *   1. A lazy-loaded R3F <Canvas> with the <Globe /> scene
 *   2. An overlay HUD layer (toolbar, info panels, world name)
 *   3. A @gorhom/bottom-sheet for region/country details
 *
 * SDK 54 Optimization:
 *   - Globe component is React.lazy() loaded to keep the initial bundle
 *     small. The heavy Three.js + R3F chunk loads after the splash screen.
 *   - TopoJSON parsing is deferred to an async useEffect, preventing
 *     main-thread blocking during startup.
 *   - Suspense fallback at the Canvas level shows a lightweight loader
 *     while the WebGL context initializes.
 */

import { useEffect, Suspense, lazy, useState } from 'react';
import { View, StyleSheet, InteractionManager } from 'react-native';
import { useWorldStore } from '../store/useWorldStore';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import type { RegionGeometry, RegionId } from '../types';
import type { Topology } from 'topojson-specification';

// ─── Lazy-loaded heavy components ───────────────────────────────────────────
// These imports are code-split into separate chunks to reduce TTI.

const LazyCanvas = lazy(() =>
  import('@react-three/fiber/native').then((mod) => ({ default: mod.Canvas })),
);

const LazyGlobe = lazy(() =>
  import('../components/globe/Globe').then((mod) => ({ default: mod.Globe })),
);

// Lazy-load HUD components (lighter, but still deferred to prioritize globe)
const LazyToolBar = lazy(() =>
  import('../components/ui/ToolBar').then((mod) => ({ default: mod.ToolBar })),
);
const LazyBottomSheet = lazy(() =>
  import('../components/ui/BottomSheet').then((mod) => ({ default: mod.BottomSheet })),
);
const LazyWorldNameBadge = lazy(() =>
  import('../components/hud/WorldNameBadge').then((mod) => ({ default: mod.WorldNameBadge })),
);
const LazyToastNotification = lazy(() =>
  import('../components/hud/ToastNotification').then((mod) => ({
    default: mod.ToastNotification,
  })),
);

// ─── Deferred TopoJSON Loader ───────────────────────────────────────────────

/**
 * Asynchronously load and parse TopoJSON after interactions settle.
 * Uses InteractionManager to avoid blocking touch responsiveness.
 */
async function loadAndParseTopoJSON(): Promise<Record<string, RegionGeometry> | null> {
  // Lazy-load both the data and the parser to keep the initial bundle small
  const [topoModule, parserModule] = await Promise.all([
    import('../../assets/data/world-110m.json').catch(() => null),
    import('../utils/geo/topoLoader'),
  ]);

  if (!topoModule) return null;

  const worldTopo = (topoModule.default ?? topoModule) as unknown as Topology;
  const { parseTopoJSON } = parserModule;

  const geometries = parseTopoJSON(worldTopo, {
    layerName: Object.keys(worldTopo.objects ?? {})[0] ?? 'countries',
    idProperty: 'ISO_A2',
    minAreaDeg2: 0.5,
  });

  return geometries as Record<string, RegionGeometry>;
}

// ─── Store-connected Globe wrapper ──────────────────────────────────────────

/**
 * Keeps Globe component pure & testable while using Zustand selectors.
 * All store access is isolated here — Globe receives only props.
 */
function GlobeConnected() {
  const geometries = useWorldStore((s) => s.geometries);
  const regions = useWorldStore((s) => s.regions);
  const countries = useWorldStore((s) => s.countries);
  const settings = useWorldStore((s) => s.settings);
  const camera = useWorldStore((s) => s.camera);
  const interaction = useWorldStore((s) => s.interaction);
  const selectRegion = useWorldStore((s) => s.selectRegion);
  const selectCountry = useWorldStore((s) => s.selectCountry);
  const setHoveredRegion = useWorldStore((s) => s.setHoveredRegion);
  const setCameraImmediate = useWorldStore((s) => s.setCameraImmediate);
  const flyTo = useWorldStore((s) => s.flyTo);
  const assignRegion = useWorldStore((s) => s.assignRegion);
  const unassignRegion = useWorldStore((s) => s.unassignRegion);
  const toggleBottomSheet = useWorldStore((s) => s.toggleBottomSheet);

  return (
    <LazyGlobe
      geometries={geometries}
      regions={regions}
      countries={countries}
      settings={settings}
      camera={camera}
      interaction={interaction}
      selectRegion={selectRegion}
      selectCountry={selectCountry}
      setHoveredRegion={setHoveredRegion}
      setCameraImmediate={setCameraImmediate}
      flyTo={flyTo}
      assignRegion={assignRegion}
      unassignRegion={unassignRegion}
      toggleBottomSheet={toggleBottomSheet}
    />
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function MainScreen() {
  const loadGeometries = useWorldStore((s) => s.loadGeometries);
  const updateRegion = useWorldStore((s) => s.updateRegion);
  const hasGeometries = useWorldStore((s) => Object.keys(s.geometries).length > 0);
  const [isGeoReady, setIsGeoReady] = useState(hasGeometries);

  // Deferred TopoJSON parsing — does not block the UI thread
  useEffect(() => {
    if (hasGeometries) {
      setIsGeoReady(true);
      return;
    }

    // Wait for current interactions to settle before heavy parsing
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const geometries = await loadAndParseTopoJSON();
        if (!geometries) return;

        loadGeometries(geometries as Record<RegionId, RegionGeometry>);

        // Create default region metas if none exist
        const regions = useWorldStore.getState().regions;
        if (Object.keys(regions).length === 0) {
          const { createDefaultRegionMetas } = await import('../utils/geo/topoLoader');
          const metas = createDefaultRegionMetas(
            geometries as Record<RegionId, RegionGeometry>,
          );
          for (const meta of Object.values(metas)) {
            updateRegion(meta.id as RegionId, meta);
          }
        }

        setIsGeoReady(true);
      } catch {
        // TopoJSON parse failed — geometry will remain empty
        // Error Boundary will catch if this is critical
        setIsGeoReady(true); // Allow rendering with empty globe
      }
    });

    return () => handle.cancel();
  }, [hasGeometries, loadGeometries, updateRegion]);

  // Show loading screen until geometry is parsed
  if (!isGeoReady) {
    return <LoadingScreen message="Parsing world map…" />;
  }

  return (
    <View style={styles.container}>
      {/* 3D Globe Layer — lazy-loaded */}
      <View style={styles.canvasContainer}>
        <Suspense fallback={<LoadingScreen message="Initializing 3D engine…" />}>
          <LazyCanvas
            camera={{ position: [0, 0, 2.5], fov: 50, near: 0.01, far: 100 }}
            gl={{ antialias: true }}
            style={styles.canvas}
          >
            <GlobeConnected />
          </LazyCanvas>
        </Suspense>
      </View>

      {/* HUD Overlay (above Canvas, below BottomSheet) */}
      <View style={styles.hud} pointerEvents="box-none">
        <Suspense fallback={null}>
          <LazyWorldNameBadge />
          <LazyToolBar />
          <LazyToastNotification />
        </Suspense>
      </View>

      {/* Bottom Sheet — sits at root level for gesture handling */}
      <Suspense fallback={null}>
        <LazyBottomSheet />
      </Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  canvasContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  canvas: {
    flex: 1,
  },
  hud: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
});
