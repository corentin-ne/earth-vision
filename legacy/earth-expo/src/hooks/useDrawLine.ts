/**
 * ============================================================================
 * useDrawLine.ts — Split Line Drawing Gesture Hook
 * ============================================================================
 *
 * Captures a user's finger/stylus swipe on the screen and converts it into
 * a geographic cutting line for the region split operation.
 *
 * ─── GESTURE PIPELINE ──────────────────────────────────────────────────────
 *
 *   User touches screen
 *       │
 *       ▼
 *   Gesture Handler captures touch points (React Native Gesture Handler)
 *       │
 *       ▼
 *   Points are sampled at ~60fps, deduplicated by distance threshold
 *       │
 *       ▼
 *   Each screen point is projected onto the globe surface via
 *   screenToGeo() from screenProjection.ts
 *       │
 *       ▼
 *   The resulting geo line is simplified (Douglas-Peucker) to reduce
 *   vertex count and smooth out hand jitter
 *       │
 *       ▼
 *   onLineComplete callback fires with the clean [lon, lat][] line
 *       │
 *       ▼
 *   The store action uses this line to call splitRegion()
 *
 * ─── ARCHITECTURE NOTES ────────────────────────────────────────────────────
 *
 * This hook is designed to work with the `DrawingOverlay` component, which
 * renders on top of the Canvas in React Native space (not inside R3F).
 *
 * The hook needs access to the Three.js camera to unproject screen coords.
 * It receives the camera's inverse view-projection matrix and position as
 * refs that are updated each frame by the R3F render loop.
 *
 * The hook itself does NOT import from R3F — it only uses pure math from
 * screenProjection.ts. This keeps it testable and framework-agnostic.
 */

import { useCallback, useRef, useState } from 'react';
import type {
  ScreenPoint,
  Viewport,
  Vec3,
  Mat4,
} from '../utils/geo/screenProjection';
import {
  screenToGeo,
  screenLineToGeoLine,
} from '../utils/geo/screenProjection';

// ─── Types ──────────────────────────────────────────────────────────────────

/** State of the drawing gesture. */
export type DrawingPhase = 'idle' | 'drawing' | 'processing';

/** Configuration for the draw line hook. */
export interface UseDrawLineOptions {
  /**
   * Minimum pixel distance between consecutive sampled points.
   * Prevents over-sampling when the finger barely moves.
   * Default: 8 pixels.
   */
  minSampleDistancePx?: number;

  /**
   * Maximum number of points to capture per swipe.
   * Prevents memory issues on very long / slow draws.
   * Default: 200.
   */
  maxPoints?: number;

  /**
   * How many degrees to extend the cutting line beyond its endpoints.
   * Ensures the cut crosses the region boundary for a clean bisection.
   * Default: 5 degrees.
   */
  lineExtensionDeg?: number;

  /**
   * Called when the user completes a drawing gesture.
   * Receives the geographic cutting line ([lon, lat][] points).
   */
  onLineComplete: (geoLine: [lon: number, lat: number][]) => void;

  /**
   * Called if the drawn line has too few valid points (< 2 on the globe).
   * The component can show an error toast.
   */
  onLineFailed?: (reason: string) => void;
}

/** What the hook exposes to the DrawingOverlay component. */
export interface UseDrawLineReturn {
  /** Current phase of the drawing gesture. */
  phase: DrawingPhase;

  /** Screen-space points being drawn (for rendering the visual line). */
  screenPoints: ScreenPoint[];

  /**
   * Call when a touch begins.
   * @param point  The starting screen position.
   */
  onTouchStart: (point: ScreenPoint) => void;

  /**
   * Call on each touch move event.
   * @param point  The current screen position.
   */
  onTouchMove: (point: ScreenPoint) => void;

  /**
   * Call when the touch ends.
   * Triggers projection & line completion.
   */
  onTouchEnd: () => void;

  /**
   * Cancel the current drawing gesture without completing.
   */
  cancel: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MIN_SAMPLE_PX = 8;
const DEFAULT_MAX_POINTS = 200;
const DEFAULT_EXTENSION_DEG = 5;
const MIN_POINTS_FOR_LINE = 2;

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Hook that manages the state of a line-drawing gesture for the split tool.
 *
 * The caller must provide camera state (position, inverse VP matrix, viewport)
 * via refs that are updated each frame. These are stored as refs because
 * the camera moves continuously and we don't want to re-render the overlay
 * on every frame.
 *
 * @param cameraRef   Ref to { position, invViewProjection, viewport }.
 * @param options     Configuration + callbacks.
 * @returns           Gesture handlers + current screen points for rendering.
 *
 * @example
 * ```tsx
 * const cameraRef = useRef({ position: [0,0,2.5], invVP: [...], viewport: {...} });
 *
 * const { phase, screenPoints, onTouchStart, onTouchMove, onTouchEnd } =
 *   useDrawLine(cameraRef, {
 *     onLineComplete: (geoLine) => store.getState().splitSelectedRegion(geoLine),
 *     onLineFailed: (msg) => showToast(msg, 'error'),
 *   });
 * ```
 */
export function useDrawLine(
  cameraRef: React.RefObject<{
    position: Vec3;
    invViewProjection: Mat4;
    viewport: Viewport;
  }>,
  options: UseDrawLineOptions,
): UseDrawLineReturn {
  const {
    minSampleDistancePx = DEFAULT_MIN_SAMPLE_PX,
    maxPoints = DEFAULT_MAX_POINTS,
    lineExtensionDeg = DEFAULT_EXTENSION_DEG,
    onLineComplete,
    onLineFailed,
  } = options;

  // ── State ──────────────────────────────────────────────────────────────

  const [phase, setPhase] = useState<DrawingPhase>('idle');
  const [screenPoints, setScreenPoints] = useState<ScreenPoint[]>([]);

  // Mutable ref for accumulating points without re-renders on every move
  const pointsRef = useRef<ScreenPoint[]>([]);

  // ── Touch Start ────────────────────────────────────────────────────────

  const onTouchStart = useCallback(
    (point: ScreenPoint) => {
      pointsRef.current = [point];
      setScreenPoints([point]);
      setPhase('drawing');
    },
    [],
  );

  // ── Touch Move ─────────────────────────────────────────────────────────

  const onTouchMove = useCallback(
    (point: ScreenPoint) => {
      const pts = pointsRef.current;

      // Don't exceed max points
      if (pts.length >= maxPoints) return;

      // Deduplicate: skip if too close to last sampled point
      const last = pts[pts.length - 1];
      if (last) {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minSampleDistancePx) return;
      }

      pts.push(point);

      // Batch state updates — only update React state every 3rd point
      // to reduce re-renders while still keeping the visual line smooth
      if (pts.length % 3 === 0 || pts.length <= 3) {
        setScreenPoints([...pts]);
      }
    },
    [maxPoints, minSampleDistancePx],
  );

  // ── Touch End ──────────────────────────────────────────────────────────

  const onTouchEnd = useCallback(() => {
    const pts = pointsRef.current;

    // Ensure final state update shows all points
    setScreenPoints([...pts]);
    setPhase('processing');

    // ── Check minimum points ────────────────────────────────────────
    if (pts.length < MIN_POINTS_FOR_LINE) {
      setPhase('idle');
      setScreenPoints([]);
      pointsRef.current = [];
      onLineFailed?.('Draw a longer line across the region to split it.');
      return;
    }

    // ── Project screen points to geo coordinates ────────────────────
    const cam = cameraRef.current;
    if (!cam) {
      setPhase('idle');
      setScreenPoints([]);
      pointsRef.current = [];
      onLineFailed?.('Camera state not available. Try again.');
      return;
    }

    const geoLine = screenLineToGeoLine(
      pts,
      cam.viewport,
      cam.position,
      cam.invViewProjection,
      lineExtensionDeg,
    );

    // Clean up drawing state
    setPhase('idle');
    setScreenPoints([]);
    pointsRef.current = [];

    // ── Validate the geo line ───────────────────────────────────────
    if (geoLine.length < MIN_POINTS_FOR_LINE) {
      onLineFailed?.(
        'The drawn line does not intersect the globe. ' +
        'Make sure to draw across the visible globe surface.',
      );
      return;
    }

    // ── Fire the completion callback ────────────────────────────────
    onLineComplete(geoLine);
  }, [cameraRef, lineExtensionDeg, onLineComplete, onLineFailed]);

  // ── Cancel ─────────────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    setPhase('idle');
    setScreenPoints([]);
    pointsRef.current = [];
  }, []);

  // ── Return ─────────────────────────────────────────────────────────────

  return {
    phase,
    screenPoints,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    cancel,
  };
}
