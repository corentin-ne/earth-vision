/**
 * ============================================================================
 * Globe.tsx — Top-Level R3F Scene Component
 * ============================================================================
 *
 * Composes all 3D sub-components into the complete globe scene:
 *
 *   ┌─────────────────────────────────────────┐
 *   │  <Canvas>                               │
 *   │    <Globe>                              │
 *   │      ├── <ambientLight />               │
 *   │      ├── <directionalLight />           │
 *   │      ├── <GlobeMesh />        ← merged  │
 *   │      ├── <Borders />          ← lines   │
 *   │      ├── <RegionLabels />     ← text    │
 *   │      ├── <Atmosphere />       ← shader  │
 *   │      └── <CameraController /> ← springs │
 *   │    </Globe>                             │
 *   │  </Canvas>                              │
 *   └─────────────────────────────────────────┘
 *
 * This component is the bridge between the Zustand store and the R3F
 * scene graph. It subscribes to store slices via selectors and passes
 * data down as props to pure presentational sub-components.
 *
 * Architecture Rules:
 * - Globe.tsx is the ONLY globe/* component that reads from the store.
 * - All sub-components receive data via props (pure/presentational).
 * - No React Native UI imports here — only R3F and Three.js.
 */

import React, { useCallback, useMemo } from 'react';
import * as THREE from 'three';

import type { RegionId, CountryId, WorldStore } from '../../types';
import {
  DEFAULT_AMBIENT_INTENSITY,
  GLOBE_RADIUS,
} from '../../constants';
import { computeZoomDistance } from '../../utils/math/camera';
import { getCountryBbox, getCountryCentroid } from '../../services/geospatial/regionOps';

// Sub-components
import { GlobeMesh } from './GlobeMesh';
import { Atmosphere } from './Atmosphere';
import { Borders } from './Borders';
import { CameraController } from './CameraController';
import { RegionLabels } from './RegionLabels';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GlobeProps {
  /**
   * The Zustand store instance, or individual slices passed as props.
   * In production, this component would use `useWorldStore` selectors
   * directly. We accept props here for flexibility and testability.
   */

  // ── Persistable state ──────────────────────────────────────────────────
  geometries: WorldStore['geometries'];
  regions: WorldStore['regions'];
  countries: WorldStore['countries'];
  settings: WorldStore['settings'];

  // ── Transient state ────────────────────────────────────────────────────
  camera: WorldStore['camera'];
  interaction: WorldStore['interaction'];

  // ── Actions ────────────────────────────────────────────────────────────
  selectRegion: WorldStore['selectRegion'];
  selectCountry: WorldStore['selectCountry'];
  setHoveredRegion: WorldStore['setHoveredRegion'];
  setCameraImmediate: WorldStore['setCameraImmediate'];
  flyTo: WorldStore['flyTo'];
  assignRegion: WorldStore['assignRegion'];
  unassignRegion: WorldStore['unassignRegion'];
  toggleBottomSheet: WorldStore['toggleBottomSheet'];
}

// ─── Light Configuration ────────────────────────────────────────────────────

/** Default sun direction (upper-right, slightly toward camera). */
const DEFAULT_LIGHT_DIRECTION = new THREE.Vector3(5, 3, 5).normalize();
const DEFAULT_LIGHT_POSITION: [number, number, number] = [5, 3, 5];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a reverse lookup: RegionId → Country for O(1) owner resolution. */
function findOwnerCountry(
  regionId: RegionId,
  countries: Record<CountryId, import('../../types').Country>,
): import('../../types').Country | null {
  for (const country of Object.values(countries)) {
    if (country.regionIds.includes(regionId)) return country;
  }
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const Globe: React.FC<GlobeProps> = React.memo(function Globe({
  geometries,
  regions,
  countries,
  settings,
  camera: cameraState,
  interaction,
  selectRegion,
  selectCountry,
  setHoveredRegion,
  setCameraImmediate,
  flyTo,
  assignRegion,
  unassignRegion,
  toggleBottomSheet,
}) {
  // ── Callbacks ─────────────────────────────────────────────────────────

  /**
   * Handle a region tap from the GlobeMesh raycaster.
   * Dispatches the appropriate store action based on the active tool.
   *
   * For "select" mode:
   *   1. Store the selected region + owning country.
   *   2. Fly to the entity (country-aware if region has an owner).
   *   3. Open the bottom sheet for the info panel.
   */
  const handleRegionTap = useCallback(
    (regionId: RegionId | null) => {
      if (!regionId) {
        // Tapped ocean — deselect everything
        selectRegion(null);
        selectCountry(null);
        toggleBottomSheet(false);
        return;
      }

      switch (interaction.activeTool) {
        case 'select': {
          // 1. Select the region + resolve owner
          selectRegion(regionId);
          const owner = findOwnerCountry(regionId, countries);
          selectCountry(owner?.id ?? null);

          // 2. Fly to the entity
          const geom = geometries[regionId];
          if (geom) {
            if (owner && owner.regionIds.length > 1) {
              // Country-aware fly-to: frame the whole country
              const bbox = getCountryBbox(owner, geometries);
              const centroid = getCountryCentroid(owner, geometries);
              if (bbox && centroid) {
                flyTo(centroid, computeZoomDistance(bbox));
              }
            } else {
              // Single-region fly-to
              flyTo(
                [geom.centroid[0], geom.centroid[1]],
                computeZoomDistanceForRegion(geom),
              );
            }
          }

          // 3. Open the bottom sheet
          toggleBottomSheet(true);
          break;
        }

        case 'paint':
          if (interaction.paintCountryId) {
            assignRegion(regionId, interaction.paintCountryId);
          }
          break;

        case 'erase':
          unassignRegion(regionId);
          break;

        default:
          selectRegion(regionId);
      }
    },
    [
      interaction.activeTool,
      interaction.paintCountryId,
      geometries,
      countries,
      selectRegion,
      selectCountry,
      flyTo,
      assignRegion,
      unassignRegion,
      toggleBottomSheet,
    ],
  );

  /** Handle hover (throttled by useRegionTap internally). */
  const handleRegionHover = useCallback(
    (regionId: RegionId | null) => {
      setHoveredRegion(regionId);
    },
    [setHoveredRegion],
  );

  /** Handle animation completion — re-enable user controls. */
  const handleAnimationEnd = useCallback(() => {
    setCameraImmediate({ isAnimating: false });
  }, [setCameraImmediate]);

  // ── Ambient light intensity ───────────────────────────────────────────

  const ambientIntensity =
    settings.ambientLightIntensity ?? DEFAULT_AMBIENT_INTENSITY;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <group>
      {/* ── Lighting ────────────────────────────────────────────────── */}
      <ambientLight intensity={ambientIntensity} />
      <directionalLight
        position={DEFAULT_LIGHT_POSITION}
        intensity={1.0 - ambientIntensity * 0.5}
        castShadow={false}
      />

      {/* ── Globe mesh (ocean + merged regions) ─────────────────────── */}
      <GlobeMesh
        geometries={geometries}
        regions={regions}
        countries={countries}
        settings={settings}
        hoveredRegionId={interaction.hoveredRegionId}
        selectedRegionId={interaction.selectedRegionId}
        onRegionTap={handleRegionTap}
        onRegionHover={handleRegionHover}
      />

      {/* ── Political borders ───────────────────────────────────────── */}
      <Borders
        geometries={geometries}
        visible={settings.showBorders}
        color={settings.borderColor}
        lineWidth={settings.borderWidth * 100} // scale for WebGL line width
      />

      {/* ── Region labels ───────────────────────────────────────────── */}
      <RegionLabels
        geometries={geometries}
        regions={regions}
        visible={settings.showLabels}
      />

      {/* ── Atmospheric glow ────────────────────────────────────────── */}
      <Atmosphere visible={settings.showAtmosphere} />

      {/* ── Camera spring controller ────────────────────────────────── */}
      <CameraController
        cameraState={cameraState}
        onAnimationEnd={handleAnimationEnd}
        enableUserControl={!cameraState.isAnimating}
        autoRotateSpeed={settings.autoRotateSpeed}
      />
    </group>
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute an appropriate zoom distance for a single region.
 * Delegates to the camera utility's bbox-based calculator.
 */
function computeZoomDistanceForRegion(
  geom: import('../../types').RegionGeometry,
): number {
  return computeZoomDistance(geom.bbox);
}
