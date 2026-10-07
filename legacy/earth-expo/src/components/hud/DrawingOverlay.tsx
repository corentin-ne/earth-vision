/**
 * ============================================================================
 * DrawingOverlay.tsx — Split Line Drawing UI Overlay
 * ============================================================================
 *
 * A transparent overlay rendered on top of the R3F Canvas that captures
 * touch gestures for the "Split" tool and renders the drawn line visually.
 *
 * ─── RENDERING ARCHITECTURE ───────────────────────────────────────────────
 *
 * This component lives in the React Native layer (NOT inside <Canvas>).
 * It uses react-native-svg to draw the cutting line preview on top of
 * the 3D globe. The SVG overlay is transparent to touches when the split
 * tool is not active (pointerEvents="none").
 *
 * ┌─────────────────────────────────────────────────┐
 * │  Screen                                         │
 * │  ┌───────────────────────────────────────────┐  │
 * │  │  <Canvas> (R3F globe)                     │  │
 * │  │  ┌─────────────────────────────────────┐  │  │
 * │  │  │  <DrawingOverlay> (SVG + gestures)  │  │  │
 * │  │  │  - captures touch when split active │  │  │
 * │  │  │  - renders line preview as SVG path │  │  │
 * │  │  └─────────────────────────────────────┘  │  │
 * │  └───────────────────────────────────────────┘  │
 * │  ┌───────────────────────────────────────────┐  │
 * │  │  <HUD> (toolbar, badges, etc.)            │  │
 * │  └───────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────┘
 *
 * ─── INTEGRATION WITH CAMERA ──────────────────────────────────────────────
 *
 * The overlay receives camera state (position, inverse view-projection
 * matrix, viewport) from the R3F scene via a shared ref. The
 * CameraController component updates this ref every frame so the
 * projection math always uses the current camera pose.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { useDrawLine } from '../../hooks/useDrawLine';
import type { Vec3, Mat4, Viewport } from '../../utils/geo/screenProjection';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DrawingOverlayProps {
  /**
   * Whether the split tool is currently active.
   * When false, the overlay is invisible and passes touches through.
   */
  isActive: boolean;

  /**
   * Ref to camera state, updated each frame by CameraController.
   * Contains { position, invViewProjection, viewport }.
   */
  cameraRef: React.RefObject<{
    position: Vec3;
    invViewProjection: Mat4;
    viewport: Viewport;
  }>;

  /**
   * Called with the geographic cutting line when the user finishes drawing.
   */
  onLineComplete: (geoLine: [lon: number, lat: number][]) => void;

  /**
   * Called when the drawn line is invalid (too short, off-globe, etc.).
   */
  onLineFailed?: (reason: string) => void;
}

// ─── Visual Constants ───────────────────────────────────────────────────────

/** Color of the drawing line preview. */
const LINE_COLOR = '#FF4444';
/** Color of the line when processing (after finger lifts). */
const PROCESSING_COLOR = '#FFAA00';
/** Width of the preview line in pixels. */
const LINE_WIDTH = 3;
/** Radius of the endpoint circles. */
const ENDPOINT_RADIUS = 6;
/** Dash pattern for the cutting line: [dash, gap]. */
const DASH_PATTERN = '8,4';

// ─── Component ──────────────────────────────────────────────────────────────

export function DrawingOverlay({
  isActive,
  cameraRef,
  onLineComplete,
  onLineFailed,
}: DrawingOverlayProps) {
  // ── Drawing Hook ────────────────────────────────────────────────────────

  const {
    phase,
    screenPoints,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    cancel,
  } = useDrawLine(cameraRef, {
    onLineComplete,
    onLineFailed,
    minSampleDistancePx: 8,
    maxPoints: 200,
    lineExtensionDeg: 5,
  });

  // ── Gesture Setup ──────────────────────────────────────────────────────
  // We use react-native-gesture-handler's Pan gesture for smooth,
  // debounced touch tracking. This provides better coordinates than
  // raw onTouchMove events on Android.

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isActive)
        .minDistance(0)
        .onBegin((event) => {
          onTouchStart({ x: event.x, y: event.y });
        })
        .onUpdate((event) => {
          onTouchMove({ x: event.x, y: event.y });
        })
        .onEnd(() => {
          onTouchEnd();
        })
        .onFinalize((_, success) => {
          if (!success) cancel();
        }),
    [isActive, onTouchStart, onTouchMove, onTouchEnd, cancel],
  );

  // ── Build the SVG polyline points string ───────────────────────────────
  // Format: "x1,y1 x2,y2 x3,y3 ..."
  const pointsString = useMemo(() => {
    if (screenPoints.length === 0) return '';
    return screenPoints.map((p) => `${p.x},${p.y}`).join(' ');
  }, [screenPoints]);

  // ── Determine visual state ─────────────────────────────────────────────
  const lineColor = phase === 'processing' ? PROCESSING_COLOR : LINE_COLOR;
  const showLine = screenPoints.length >= 2;
  const firstPoint = screenPoints[0];
  const lastPoint = screenPoints[screenPoints.length - 1];

  // ── Don't render anything if the tool isn't active ─────────────────────
  if (!isActive && phase === 'idle') return null;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.container}
        // When active, capture all touches. When inactive, pass through.
        pointerEvents={isActive ? 'auto' : 'none'}
      >
        <Svg style={StyleSheet.absoluteFill}>
          {/* The drawn cutting line */}
          {showLine && (
            <>
              {/* Shadow for visibility against any background */}
              <Polyline
                points={pointsString}
                fill="none"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth={LINE_WIDTH + 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Main dashed line */}
              <Polyline
                points={pointsString}
                fill="none"
                stroke={lineColor}
                strokeWidth={LINE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={DASH_PATTERN}
              />
            </>
          )}

          {/* Start endpoint marker */}
          {firstPoint && (
            <Circle
              cx={firstPoint.x}
              cy={firstPoint.y}
              r={ENDPOINT_RADIUS}
              fill={lineColor}
              stroke="white"
              strokeWidth={2}
            />
          )}

          {/* End endpoint marker (only show if line has length) */}
          {lastPoint && screenPoints.length >= 2 && (
            <Circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={ENDPOINT_RADIUS}
              fill={lineColor}
              stroke="white"
              strokeWidth={2}
            />
          )}
        </Svg>
      </View>
    </GestureDetector>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5, // Above canvas, below HUD
  },
});
