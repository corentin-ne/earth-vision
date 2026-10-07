/**
 * ============================================================================
 * useRegionTap.ts — Optimized Region Hit-Testing Hook
 * ============================================================================
 *
 * Converts pointer/touch events into region IDs using a SpatialIndex with:
 *   • Debounced tap detection (prevents rapid-fire during scroll/pan).
 *   • Pointer-movement filtering (only fires on true "taps", not drags).
 *   • Throttled hover updates via a separate handler.
 *   • Lazy spatial-index construction on first query.
 *
 * The hook returns two handlers:
 *   1. `onPointerDown` + `onPointerUp` pair for tap detection.
 *   2. `onPointerMove` for throttled hover resolution.
 */

import { useCallback, useRef, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Vector3 } from 'three';
import type { RegionId, RegionGeometry } from '../types';
import { SpatialIndex } from '../utils/geo/spatialIndex';
import { cartesianToLatLon } from '../utils/geo/projection';
import {
  TAP_DEBOUNCE_MS,
  HOVER_THROTTLE_MS,
  TAP_MOVE_THRESHOLD_PX,
} from '../constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RegionTapHandlers {
  /** Attach to the globe mesh's onPointerDown. */
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  /** Attach to the globe mesh's onPointerUp — fires the actual tap callback. */
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  /** Attach to the globe mesh's onPointerMove for hover resolution. */
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Hook that builds a spatial index from region geometries and returns
 * optimized, debounced event handlers for tap and hover detection.
 *
 * @param geometries  - Map of region geometries (keyed by RegionId).
 * @param onRegionTap - Callback invoked when a true tap is detected.
 * @param onRegionHover - Optional callback for hover (pointermove).
 */
export function useRegionTap(
  geometries: Record<string, RegionGeometry>,
  onRegionTap: (regionId: RegionId | null) => void,
  onRegionHover?: (regionId: RegionId | null) => void,
): RegionTapHandlers {
  // ── Spatial Index (lazy, cached) ────────────────────────────────────────

  const indexRef = useRef<SpatialIndex | null>(null);
  const geometriesRef = useRef(geometries);

  if (geometries !== geometriesRef.current) {
    geometriesRef.current = geometries;
    indexRef.current = null; // invalidate on geometry change
  }

  const getIndex = useCallback((): SpatialIndex => {
    if (!indexRef.current) {
      const idx = new SpatialIndex();
      idx.build(geometriesRef.current);
      indexRef.current = idx;
    }
    return indexRef.current;
  }, []);

  // ── Tap debounce state ─────────────────────────────────────────────────

  const lastTapTimeRef = useRef(0);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  // ── Hover throttle state ───────────────────────────────────────────────

  const lastHoverTimeRef = useRef(0);
  const lastHoverRegionRef = useRef<RegionId | null>(null);

  // ── Resolve a 3D hit point to a RegionId ───────────────────────────────

  const resolveRegion = useCallback(
    (point: Vector3): RegionId | null => {
      const [lat, lon] = cartesianToLatLon(point.x, point.y, point.z);
      return getIndex().query(lon, lat);
    },
    [getIndex],
  );

  // ── Handlers ───────────────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      // Record starting position for drag-vs-tap discrimination
      pointerDownPosRef.current = {
        x: event.nativeEvent.clientX ?? event.nativeEvent.pageX ?? 0,
        y: event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0,
      };
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();

      // ── Drag rejection ────────────────────────────────────────────────
      const downPos = pointerDownPosRef.current;
      if (downPos) {
        const upX = event.nativeEvent.clientX ?? event.nativeEvent.pageX ?? 0;
        const upY = event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0;
        const dx = upX - downPos.x;
        const dy = upY - downPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_THRESHOLD_PX) {
          pointerDownPosRef.current = null;
          return; // This was a drag, not a tap
        }
      }
      pointerDownPosRef.current = null;

      // ── Debounce ──────────────────────────────────────────────────────
      const now = performance.now();
      if (now - lastTapTimeRef.current < TAP_DEBOUNCE_MS) return;
      lastTapTimeRef.current = now;

      // ── Resolve region ────────────────────────────────────────────────
      const regionId = resolveRegion(event.point);
      onRegionTap(regionId);
    },
    [resolveRegion, onRegionTap],
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!onRegionHover) return;

      // ── Throttle ──────────────────────────────────────────────────────
      const now = performance.now();
      if (now - lastHoverTimeRef.current < HOVER_THROTTLE_MS) return;
      lastHoverTimeRef.current = now;

      const regionId = resolveRegion(event.point);

      // Only fire callback when the hovered region actually changes
      if (regionId !== lastHoverRegionRef.current) {
        lastHoverRegionRef.current = regionId;
        onRegionHover(regionId);
      }
    },
    [resolveRegion, onRegionHover],
  );

  return useMemo(
    () => ({ onPointerDown, onPointerUp, onPointerMove }),
    [onPointerDown, onPointerUp, onPointerMove],
  );
}
