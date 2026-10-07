/**
 * ============================================================================
 * GlobeMesh.tsx — Base Globe Sphere + Merged Region Geometry
 * ============================================================================
 *
 * Renders the ocean sphere and all region polygons as a single merged
 * BufferGeometry for maximum GPU efficiency. Instead of mounting hundreds
 * of individual <mesh> components (which would thrash React's reconciler
 * and the WebGL draw-call budget), we:
 *
 *   1. Parse TopoJSON into per-region triangulated meshes.
 *   2. Merge all positions/normals/indices into one giant BufferGeometry.
 *   3. Assign each triangle a region-ID encoded into a per-vertex attribute
 *      so the shader (or a color-ID picking pass) can resolve which region
 *      was tapped.
 *   4. Set per-region colors via a data texture or vertex colors that update
 *      when the store changes.
 *
 * This keeps draw calls at O(1) regardless of how many regions exist.
 *
 * Architecture Notes:
 * - This component reads from `useWorldStore` for geometry + region meta.
 * - It does NOT handle user interaction — that's CameraController + useRegionTap.
 * - It does NOT render borders — that's the <Borders /> component.
 */

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { RegionId, RegionGeometry, RegionMeta, Country, WorldSettings } from '../../types';
import { disposeGeometry, disposeMaterial } from '../../utils/disposal';
import { triangulateMultiPolygon } from '../../utils/geo/triangulation';
import { hexToRgbNormalized } from '../../utils/math/color';
import { useRegionTap } from '../../hooks/useRegionTap';
import {
  GLOBE_RADIUS,
  GLOBE_SEGMENTS,
  DEFAULT_UNOWNED_COLOR,
} from '../../constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GlobeMeshProps {
  /** Immutable geometry cache keyed by RegionId. */
  geometries: Record<RegionId, RegionGeometry>;

  /** Mutable region metadata (colors, elevation, labels). */
  regions: Record<RegionId, RegionMeta>;

  /** User-created countries. */
  countries: Record<CountryId, Country>;

  /** World settings (ocean color, unowned color, etc.). */
  settings: WorldSettings;

  /** Currently hovered region for highlight. */
  hoveredRegionId: RegionId | null;

  /** Currently selected region for selection pulse. */
  selectedRegionId: RegionId | null;

  /** Callback when a region is tapped (resolved from raycasting). */
  onRegionTap?: (regionId: RegionId | null) => void;

  /** Callback when the hovered region changes (throttled). */
  onRegionHover?: (regionId: RegionId | null) => void;
}

// Need CountryId for the countries prop
import type { CountryId } from '../../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a reverse lookup: RegionId → CountryId for O(1) owner resolution. */
function buildRegionOwnerMap(
  countries: Record<CountryId, Country>,
): Map<RegionId, CountryId> {
  const map = new Map<RegionId, CountryId>();
  for (const country of Object.values(countries)) {
    for (const rid of country.regionIds) {
      map.set(rid, country.id);
    }
  }
  return map;
}

/** Resolve the display color for a region (override > country > default). */
function resolveRegionColor(
  regionMeta: RegionMeta,
  ownerMap: Map<RegionId, CountryId>,
  countries: Record<CountryId, Country>,
  unownedColor: string,
): { r: number; g: number; b: number } {
  // Priority 1: per-region color override
  if (regionMeta.colorOverride) {
    return hexToRgbNormalized(regionMeta.colorOverride);
  }

  // Priority 2: owning country's color
  const ownerId = ownerMap.get(regionMeta.id);
  if (ownerId && countries[ownerId]) {
    return hexToRgbNormalized(countries[ownerId].color);
  }

  // Priority 3: default unowned color
  return hexToRgbNormalized(unownedColor);
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * GlobeMesh renders:
 *   1. A base ocean sphere (solid color, slightly smaller than region mesh).
 *   2. A merged region mesh with per-vertex colors and region-ID encoding.
 */
export const GlobeMesh: React.FC<GlobeMeshProps> = React.memo(function GlobeMesh({
  geometries,
  regions,
  countries,
  settings,
  hoveredRegionId,
  selectedRegionId,
  onRegionTap,
  onRegionHover,
}) {
  const mergedMeshRef = useRef<THREE.Mesh>(null);
  const regionColorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const regionHighlightAttrRef = useRef<THREE.BufferAttribute | null>(null);

  // ── Build region → vertex-index range lookup ──────────────────────────

  /**
   * Memoized merged geometry. Recomputed only when the geometry cache
   * changes (which should be never after initial load).
   */
  const { mergedGeometry, regionVertexRanges, regionIdByTriangle } = useMemo(() => {
    const regionIds = Object.keys(geometries) as RegionId[];
    if (regionIds.length === 0) {
      return {
        mergedGeometry: new THREE.BufferGeometry(),
        regionVertexRanges: new Map<RegionId, { start: number; count: number }>(),
        regionIdByTriangle: [] as RegionId[],
      };
    }

    const allPositions: number[] = [];
    const allNormals: number[] = [];
    const allUvs: number[] = [];
    const allIndices: number[] = [];
    const ranges = new Map<RegionId, { start: number; count: number }>();
    const triRegionIds: RegionId[] = [];

    let vertexOffset = 0;

    for (const id of regionIds) {
      const geom = geometries[id];
      const elevation = regions[id]?.elevation ?? 1.0;

      // Group rings by polygon. For our simplified Ring[] storage,
      // treat each ring as a separate polygon (exterior only).
      const polygons = geom.rings.map((ring) => [ring as unknown as readonly [number, number][]]);

      const tri = triangulateMultiPolygon(
        polygons as ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>>,
        GLOBE_RADIUS,
        elevation,
      );

      const vertexStart = vertexOffset;
      const vertexCount = tri.positions.length / 3;

      // Append positions, normals, UVs
      for (let i = 0; i < tri.positions.length; i++) allPositions.push(tri.positions[i]);
      for (let i = 0; i < tri.normals.length; i++) allNormals.push(tri.normals[i]);
      for (let i = 0; i < tri.uvs.length; i++) allUvs.push(tri.uvs[i]);

      // Offset and append indices
      for (let i = 0; i < tri.indices.length; i++) {
        allIndices.push(tri.indices[i] + vertexOffset);
      }

      // Track which triangles belong to this region
      for (let i = 0; i < tri.triangleCount; i++) {
        triRegionIds.push(id);
      }

      ranges.set(id, { start: vertexStart, count: vertexCount });
      vertexOffset += vertexCount;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(allUvs, 2));
    geometry.setIndex(allIndices);

    // Per-vertex color attribute (will be updated reactively)
    const colorArray = new Float32Array(vertexOffset * 3);
    const colorAttr = new THREE.BufferAttribute(colorArray, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colorAttr);

    // Per-vertex highlight attribute (hover + selection)
    const highlightArray = new Float32Array(vertexOffset);
    const highlightAttr = new THREE.BufferAttribute(highlightArray, 1);
    highlightAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('highlight', highlightAttr);

    geometry.computeBoundingSphere();

    return {
      mergedGeometry: geometry,
      regionVertexRanges: ranges,
      regionIdByTriangle: triRegionIds,
    };
  }, [geometries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dispose previous geometry when it changes or on unmount
  useEffect(() => {
    return () => {
      disposeGeometry(mergedGeometry);
    };
  }, [mergedGeometry]);

  // Store attribute refs for reactive updates
  useEffect(() => {
    const colorAttr = mergedGeometry.getAttribute('color') as THREE.BufferAttribute;
    const highlightAttr = mergedGeometry.getAttribute('highlight') as THREE.BufferAttribute;
    regionColorAttrRef.current = colorAttr;
    regionHighlightAttrRef.current = highlightAttr;
  }, [mergedGeometry]);

  // ── Update vertex colors when regions/countries/settings change ────────

  useEffect(() => {
    const colorAttr = regionColorAttrRef.current;
    if (!colorAttr) return;

    const ownerMap = buildRegionOwnerMap(countries);
    const unownedColor = settings.unownedRegionColor ?? DEFAULT_UNOWNED_COLOR;

    for (const [id, range] of regionVertexRanges) {
      const meta = regions[id];
      if (!meta) continue;

      const color = resolveRegionColor(meta, ownerMap, countries, unownedColor);

      for (let i = range.start; i < range.start + range.count; i++) {
        colorAttr.setXYZ(i, color.r, color.g, color.b);
      }
    }

    colorAttr.needsUpdate = true;
  }, [regions, countries, settings, regionVertexRanges]);

  // ── Update highlight attribute for hover/selection ─────────────────────

  useEffect(() => {
    const highlightAttr = regionHighlightAttrRef.current;
    if (!highlightAttr) return;

    // Reset all to 0
    const arr = highlightAttr.array as Float32Array;
    arr.fill(0);

    // Hovered region → 0.5
    if (hoveredRegionId) {
      const range = regionVertexRanges.get(hoveredRegionId);
      if (range) {
        for (let i = range.start; i < range.start + range.count; i++) {
          arr[i] = 0.5;
        }
      }
    }

    // Selected region → 1.0 (overrides hover)
    if (selectedRegionId) {
      const range = regionVertexRanges.get(selectedRegionId);
      if (range) {
        for (let i = range.start; i < range.start + range.count; i++) {
          arr[i] = 1.0;
        }
      }
    }

    highlightAttr.needsUpdate = true;
  }, [hoveredRegionId, selectedRegionId, regionVertexRanges]);

  // ── Raycasting: optimized debounced handlers via useRegionTap ────────

  const tapCallback = useCallback(
    (regionId: import('../../types').RegionId | null) => {
      onRegionTap?.(regionId);
    },
    [onRegionTap],
  );

  const hoverCallback = useCallback(
    (regionId: import('../../types').RegionId | null) => {
      onRegionHover?.(regionId);
    },
    [onRegionHover],
  );

  const { onPointerDown, onPointerUp, onPointerMove } = useRegionTap(
    geometries,
    tapCallback,
    hoverCallback,
  );

  // ── Ocean color ────────────────────────────────────────────────────────

  const oceanColor = useMemo(
    () => new THREE.Color(settings.oceanColor),
    [settings.oceanColor],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <group>
      {/* Ocean base sphere — slightly smaller so regions sit on top */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 0.998, GLOBE_SEGMENTS, GLOBE_SEGMENTS]} />
        <meshStandardMaterial
          color={oceanColor}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>

      {/* Merged region mesh with vertex colors */}
      <mesh
        ref={mergedMeshRef}
        geometry={mergedGeometry}
        onPointerDown={onPointerDown as any}
        onPointerUp={onPointerUp as any}
        onPointerMove={onPointerMove as any}
      >
        <meshStandardMaterial
          vertexColors
          roughness={0.6}
          metalness={0.05}
          side={THREE.FrontSide}
        />
      </mesh>
    </group>
  );
});
