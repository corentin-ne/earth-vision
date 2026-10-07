/**
 * ============================================================================
 * constants/index.ts — Application-wide constants
 * ============================================================================
 */

// ── Globe ────────────────────────────────────────────────────────────────────
export const GLOBE_RADIUS = 1.0;
export const GLOBE_SEGMENTS = 128;

// ── Camera Limits ────────────────────────────────────────────────────────────
export const MIN_ZOOM = GLOBE_RADIUS * 1.15;
export const MAX_ZOOM = GLOBE_RADIUS * 4.0;
export const DEFAULT_CAMERA_DISTANCE = GLOBE_RADIUS * 2.5;

/**
 * Scale factor applied to a bounding-box diagonal (in km) to derive
 * the camera zoom distance. Higher = more zoomed out for a given entity.
 */
export const ZOOM_SCALE_FACTOR = 0.0015;

// ── Colors ───────────────────────────────────────────────────────────────────
export const DEFAULT_UNOWNED_COLOR = '#B0BEC5';
export const DEFAULT_OCEAN_COLOR = '#1A237E';
export const DEFAULT_BORDER_COLOR = '#263238';
export const ATMOSPHERE_COLOR = '#4FC3F7';

// ── Spring Defaults ──────────────────────────────────────────────────────────
export const SPRING_EPSILON = 0.0001;
export const MAX_SPRING_DELTA = 0.032; // clamp to ~30fps minimum
// ── Raycasting & Interaction ─────────────────────────────────────────────
/** Minimum ms between successive tap-resolution callbacks. */
export const TAP_DEBOUNCE_MS = 120;
/** Minimum ms between hover/pointermove updates. */
export const HOVER_THROTTLE_MS = 50;
/** Maximum movement (in pixels) between pointerdown → pointerup to count as a tap. */
export const TAP_MOVE_THRESHOLD_PX = 8;
// ── World Defaults ───────────────────────────────────────────────────────────
export const DEFAULT_WORLD_NAME = 'My World';
export const DEFAULT_AMBIENT_INTENSITY = 0.6;
export const DEFAULT_BORDER_WIDTH = 0.002;
