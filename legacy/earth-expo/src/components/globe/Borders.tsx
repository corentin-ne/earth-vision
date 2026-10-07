/**
 * ============================================================================
 * Borders.tsx — Political Border Line Rendering
 * ============================================================================
 *
 * Renders border lines between adjacent regions as 3D line segments
 * on the globe surface. Uses THREE.LineSegments with a custom line
 * material for GPU-efficient rendering.
 *
 * Design:
 * - Extracts shared edges between region polygons.
 * - Projects border polylines onto the sphere surface.
 * - Tessellates long edges to follow the great-circle curvature.
 * - Renders as a single LineSegments draw call.
 *
 * Performance:
 * - All borders are merged into one BufferGeometry.
 * - Only recomputed when geometry cache changes (startup only).
 * - Line width is controlled via material (limited by WebGL on mobile).
 */

import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';

import type { RegionId, RegionGeometry } from '../../types';
import { disposeGeometry } from '../../utils/disposal';
import { latLonToCartesian, slerpOnSphere } from '../../utils/geo/projection';
import { GLOBE_RADIUS, DEFAULT_BORDER_COLOR, DEFAULT_BORDER_WIDTH } from '../../constants';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Maximum arc length (in degrees) before a border segment is tessellated
 * into sub-segments. Ensures borders follow the sphere curvature.
 */
const MAX_SEGMENT_ARC_DEG = 2;

/**
 * Slight offset above the globe surface to prevent z-fighting with
 * the region mesh. Expressed as a multiplier on GLOBE_RADIUS.
 */
const BORDER_ELEVATION = 1.002;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BordersProps {
  /** Immutable geometry cache. */
  geometries: Record<RegionId, RegionGeometry>;

  /** Whether borders should be visible. */
  visible?: boolean;

  /** Border line color (hex string). */
  color?: string;

  /** Border line width (limited by GPU/driver on mobile). */
  lineWidth?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Tessellate a line segment along a great circle to follow the sphere
 * curvature. Returns an array of [x, y, z] points.
 */
function tessellateSegment(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radius: number,
): number[] {
  const dLat = Math.abs(lat2 - lat1);
  const dLon = Math.abs(lon2 - lon1);
  const arcDeg = Math.sqrt(dLat * dLat + dLon * dLon);

  const segments = Math.max(1, Math.ceil(arcDeg / MAX_SEGMENT_ARC_DEG));
  const points: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const [x, y, z] = slerpOnSphere(lat1, lon1, lat2, lon2, t, radius);
    points.push(x, y, z);
  }

  return points;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const Borders: React.FC<BordersProps> = React.memo(function Borders({
  geometries,
  visible = true,
  color = DEFAULT_BORDER_COLOR,
  lineWidth = 1,
}) {
  // ── Build merged border line geometry ──────────────────────────────────

  const lineGeometry = useMemo(() => {
    const positions: number[] = [];
    const radius = GLOBE_RADIUS * BORDER_ELEVATION;

    for (const geom of Object.values(geometries)) {
      for (const ring of geom.rings) {
        // Each ring is a closed polygon — draw line segments between consecutive vertices
        for (let i = 0; i < ring.length - 1; i++) {
          const [lon1, lat1] = ring[i];
          const [lon2, lat2] = ring[i + 1];

          // Tessellate to follow sphere curvature
          const tessellated = tessellateSegment(lat1, lon1, lat2, lon2, radius);

          // Convert tessellated points into line segment pairs
          for (let j = 0; j < tessellated.length / 3 - 1; j++) {
            // Start point
            positions.push(
              tessellated[j * 3],
              tessellated[j * 3 + 1],
              tessellated[j * 3 + 2],
            );
            // End point
            positions.push(
              tessellated[(j + 1) * 3],
              tessellated[(j + 1) * 3 + 1],
              tessellated[(j + 1) * 3 + 2],
            );
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeBoundingSphere();

    return geometry;
  }, [geometries]);

  // Dispose line geometry on change or unmount
  useEffect(() => {
    return () => {
      disposeGeometry(lineGeometry);
    };
  }, [lineGeometry]);

  // ── Border color ──────────────────────────────────────────────────────

  const borderColor = useMemo(() => new THREE.Color(color), [color]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (!visible) return null;

  return (
    <lineSegments geometry={lineGeometry}>
      <lineBasicMaterial
        color={borderColor}
        linewidth={lineWidth}
        transparent
        opacity={0.6}
        depthWrite={false}
      />
    </lineSegments>
  );
});
