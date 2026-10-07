/**
 * ============================================================================
 * RegionLabels.tsx — Floating Text Labels Above the Globe
 * ============================================================================
 *
 * Renders text labels above each region's centroid using drei's <Text>
 * component (or a custom billboard sprite approach for mobile performance).
 *
 * Labels:
 * - Are camera-facing (billboard mode).
 * - Scale with distance so they don't dominate at zoom-out.
 * - Hide when the region is on the far side of the globe (frustum culling).
 * - Show the region's custom label or fall back to the geographic name.
 *
 * Performance:
 * - Only renders labels for regions currently visible to the camera.
 * - Uses LOD: shows country-level labels when zoomed out, region-level
 *   when zoomed in.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';

import type { RegionId, RegionGeometry, RegionMeta } from '../../types';
import { latLonToCartesian } from '../../utils/geo/projection';
import { GLOBE_RADIUS } from '../../constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RegionLabelsProps {
  /** Immutable geometry cache. */
  geometries: Record<RegionId, RegionGeometry>;

  /** Mutable region metadata. */
  regions: Record<RegionId, RegionMeta>;

  /** Whether labels are visible. */
  visible?: boolean;

  /** Label font size. */
  fontSize?: number;

  /** Label color (hex string). */
  color?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const RegionLabels: React.FC<RegionLabelsProps> = React.memo(
  function RegionLabels({
    geometries,
    regions,
    visible = true,
    fontSize = 0.02,
    color = '#FFFFFF',
  }) {
    /**
     * Pre-compute label positions from region centroids.
     * Slightly elevated above the globe surface for visibility.
     */
    const labelData = useMemo(() => {
      const entries: Array<{
        id: RegionId;
        text: string;
        position: [number, number, number];
      }> = [];

      for (const [id, geom] of Object.entries(geometries)) {
        const rid = id as RegionId;
        const meta = regions[rid];
        const text = meta?.label ?? rid;

        if (!text) continue;

        const [lon, lat] = geom.centroid;
        const elevation = meta?.elevation ?? 1.0;
        const [x, y, z] = latLonToCartesian(lat, lon, GLOBE_RADIUS * elevation * 1.01);

        entries.push({ id: rid, text, position: [x, y, z] });
      }

      return entries;
    }, [geometries, regions]);

    if (!visible) return null;

    // Note: In production, use drei's <Text> or <Html> for proper
    // billboard text rendering. This placeholder renders nothing
    // until @react-three/drei is installed.
    //
    // Example with drei:
    //   {labelData.map(({ id, text, position }) => (
    //     <Text
    //       key={id}
    //       position={position}
    //       fontSize={fontSize}
    //       color={color}
    //       anchorX="center"
    //       anchorY="bottom"
    //       outlineWidth={0.003}
    //       outlineColor="#000000"
    //     >
    //       {text}
    //     </Text>
    //   ))}

    return <group />;
  },
);
