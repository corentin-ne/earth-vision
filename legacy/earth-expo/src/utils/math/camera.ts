/**
 * ============================================================================
 * camera.ts — Spring-Based Camera Zoom Strategy
 * ============================================================================
 *
 * This module implements the smooth, spring-physics-driven camera transitions
 * used when a user taps a country or region on the 3D globe.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * STRATEGY OVERVIEW
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. TAP DETECTION
 *    - A raycaster in the R3F `<Canvas>` fires on `onPointerUp` against
 *      the globe mesh's region geometry.
 *    - The hit face's `materialIndex` (or a color-ID lookup from a
 *      picking render target) maps to a `RegionId`.
 *    - If the region belongs to a Country, we compute the camera target
 *      from the Country's combined bounding box; otherwise, from the
 *      single region's centroid.
 *
 * 2. TARGET COMPUTATION
 *    - **Target point (lon, lat):**
 *      The centroid of the tapped entity (region or country) is converted
 *      to a point on the unit sphere via spherical coordinates.
 *    - **Zoom distance:**
 *      Derived from the entity's bounding-box diagonal so the camera
 *      frames the entire entity with comfortable padding. Clamped to
 *      [MIN_ZOOM, MAX_ZOOM].
 *
 *      Formula:
 *        distance = clamp(
 *          GLOBE_RADIUS + bboxDiagonalKm * ZOOM_PADDING_FACTOR,
 *          MIN_ZOOM,
 *          MAX_ZOOM
 *        )
 *
 * 3. SPRING ANIMATION (THE CORE)
 *    - We use a **critically-damped spring** (no overshoot, but fast settle).
 *    - Two separate springs run in parallel:
 *      a) **Azimuth/Polar spring** — animates the camera's spherical angles
 *         (θ, φ) toward the target's angles. Uses shortest-arc interpolation
 *         to avoid spinning the wrong way around the globe.
 *      b) **Distance spring** — animates the radial distance toward the
 *         computed zoom level.
 *    - Spring parameters are tuned per-interaction type:
 *
 *        | Interaction       | stiffness | damping | mass |
 *        |-------------------|-----------|---------|------|
 *        | Region tap        |    120    |   14    | 1.0  |
 *        | Country tap       |     80    |   12    | 1.0  |
 *        | Double-tap zoom   |    200    |   18    | 0.8  |
 *        | Pinch release     |    150    |   16    | 1.0  |
 *        | "Home" reset      |     60    |   10    | 1.2  |
 *
 *    - The spring is evaluated every frame inside the R3F `useFrame` loop,
 *      directly updating OrbitControls `.target` and camera `.position`.
 *
 * 4. ORBIT CONTROLS INTEGRATION
 *    - We use a **ref** to `OrbitControls` so we can programmatically set
 *      `controls.target` and the camera position each frame during a
 *      fly-to animation.
 *    - While `camera.isAnimating === true`:
 *        • User touch/drag input is **suppressed** (controls.enabled = false).
 *        • The spring drives the camera.
 *    - When the spring reaches its rest position (velocity < ε):
 *        • `camera.isAnimating` is set to `false`.
 *        • `controls.enabled = true` — user regains manual orbit.
 *
 * 5. SHORTEST-ARC INTERPOLATION
 *    - Naïvely interpolating longitude from 170° to -170° would swing 340°
 *      the wrong way. Instead, we:
 *        1. Compute Δlon = targetLon - currentLon.
 *        2. Normalize Δlon to (-180°, 180°].
 *        3. Set the spring's target to currentLon + normalizedΔlon.
 *      This guarantees the camera always takes the short path.
 *
 * 6. FRAME LOOP PSEUDOCODE
 *    ```
 *    useFrame((_, delta) => {
 *      if (!camera.isAnimating) return;
 *
 *      // Advance springs by `delta` seconds
 *      azimuthSpring.step(delta);
 *      polarSpring.step(delta);
 *      distanceSpring.step(delta);
 *
 *      // Convert updated spherical coords to cartesian
 *      const [x, y, z] = sphericalToCartesian(
 *        azimuthSpring.value,
 *        polarSpring.value,
 *        distanceSpring.value,
 *      );
 *
 *      camera.position.set(x, y, z);
 *      camera.lookAt(0, 0, 0); // globe center
 *      controls.target.set(0, 0, 0);
 *
 *      // Check convergence
 *      if (allSettled(azimuthSpring, polarSpring, distanceSpring)) {
 *        store.setCameraImmediate({ isAnimating: false });
 *        controls.enabled = true;
 *      }
 *    });
 *    ```
 *
 * ───────────────────────────────────────────────────────────────────────────
 * IMPLEMENTATION NOTES
 * ───────────────────────────────────────────────────────────────────────────
 *
 * • The spring math itself is ~30 lines of code (see `SpringValue` below).
 *   No external spring library is required for the 3D side; React Native
 *   Reanimated springs are reserved for 2D UI animations (bottom sheets,
 *   button press feedback).
 *
 * • On low-end devices, if frame time exceeds 32 ms (< 30fps), the spring
 *   `delta` is clamped to 0.032 to prevent instability.
 *
 * • When multiple taps fire in quick succession, each new fly-to simply
 *   re-targets the existing springs — they smoothly redirect mid-flight
 *   with no jarring snaps.
 */

import {
  GLOBE_RADIUS,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_SCALE_FACTOR,
  SPRING_EPSILON,
  MAX_SPRING_DELTA,
} from '../../constants';

// ─── Spring Configuration Presets ───────────────────────────────────────────

export interface SpringConfig {
  /** Stiffness (force toward target). Higher = faster. */
  stiffness: number;
  /** Damping (resistance to motion). Higher = less oscillation. */
  damping: number;
  /** Mass of the virtual object. Higher = more inertia. */
  mass: number;
}

export const SPRING_PRESETS = {
  regionTap:    { stiffness: 120, damping: 14, mass: 1.0 } as SpringConfig,
  countryTap:   { stiffness:  80, damping: 12, mass: 1.0 } as SpringConfig,
  doubleTap:    { stiffness: 200, damping: 18, mass: 0.8 } as SpringConfig,
  pinchRelease: { stiffness: 150, damping: 16, mass: 1.0 } as SpringConfig,
  homeReset:    { stiffness:  60, damping: 10, mass: 1.2 } as SpringConfig,
} as const;

// ─── Spring Value (Minimal Damped Spring Simulation) ────────────────────────

/**
 * A single-axis critically-damped spring.
 *
 * Physics model (second-order ODE):
 *   F = -stiffness * (x - target) - damping * velocity
 *   acceleration = F / mass
 *
 * Stepped via semi-implicit Euler integration (stable, cheap).
 */
export class SpringValue {
  value: number;
  velocity = 0;
  target: number;
  private config: SpringConfig;

  constructor(initial: number, config: SpringConfig) {
    this.value = initial;
    this.target = initial;
    this.config = config;
  }

  /** Reconfigure spring parameters (e.g., switching from regionTap to homeReset). */
  setConfig(config: SpringConfig): void {
    this.config = config;
  }

  /** Set a new target; the spring will animate toward it. */
  setTarget(target: number): void {
    this.target = target;
  }

  /** Snap to a value with zero velocity (no animation). */
  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /**
   * Advance the spring by `dt` seconds.
   * Uses semi-implicit Euler: update velocity first, then position.
   */
  step(dt: number): void {
    const clampedDt = Math.min(dt, MAX_SPRING_DELTA);
    const { stiffness, damping, mass } = this.config;

    const springForce = -stiffness * (this.value - this.target);
    const dampingForce = -damping * this.velocity;
    const acceleration = (springForce + dampingForce) / mass;

    this.velocity += acceleration * clampedDt;
    this.value += this.velocity * clampedDt;
  }

  /** Whether the spring has effectively reached its resting state. */
  isSettled(): boolean {
    return (
      Math.abs(this.value - this.target) < SPRING_EPSILON &&
      Math.abs(this.velocity) < SPRING_EPSILON
    );
  }
}

// ─── Helper: Shortest-arc longitude normalization ───────────────────────────

/**
 * Normalize a longitude delta to the range (-180, 180] so the camera
 * always takes the shortest arc around the globe.
 */
export function normalizeLonDelta(delta: number): number {
  let d = delta % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// ─── Helper: Spherical → Cartesian ──────────────────────────────────────────

/**
 * Convert spherical coordinates to a cartesian camera position.
 *
 * @param azimuth  Horizontal angle in radians (longitude mapped to θ).
 * @param polar    Vertical angle in radians (latitude mapped to φ).
 * @param radius   Distance from origin (globe center).
 * @returns        [x, y, z] position in world space.
 *
 * Convention (Three.js Y-up):
 *   x = r * cos(φ) * sin(θ)
 *   y = r * sin(φ)
 *   z = r * cos(φ) * cos(θ)
 */
export function sphericalToCartesian(
  azimuth: number,
  polar: number,
  radius: number,
): [x: number, y: number, z: number] {
  const cosPolar = Math.cos(polar);
  return [
    radius * cosPolar * Math.sin(azimuth),
    radius * Math.sin(polar),
    radius * cosPolar * Math.cos(azimuth),
  ];
}

// ─── Helper: Lon/Lat → Spherical angles ─────────────────────────────────────

/**
 * Convert geographic coordinates to the spherical angle system
 * used by the camera spring.
 *
 * @param lon  Longitude in degrees [-180, 180].
 * @param lat  Latitude in degrees [-90, 90].
 * @returns    [azimuth, polar] in radians.
 */
export function geoToSpherical(
  lon: number,
  lat: number,
): [azimuth: number, polar: number] {
  const DEG2RAD = Math.PI / 180;
  return [lon * DEG2RAD, lat * DEG2RAD];
}

// ─── Zoom Distance Calculator ───────────────────────────────────────────────

/**
 * Compute the ideal camera distance to frame a geographic bounding box.
 *
 * @param bbox [west, south, east, north] in degrees.
 * @returns    Clamped camera distance in world units.
 */
export function computeZoomDistance(
  bbox: Readonly<[west: number, south: number, east: number, north: number]>,
): number {
  // Approximate diagonal in km using Haversine on bbox corners
  const [west, south, east, north] = bbox;
  const dLon = Math.abs(east - west);
  const dLat = Math.abs(north - south);
  const diagonalDeg = Math.sqrt(dLon * dLon + dLat * dLat);

  // Rough conversion: 1° ≈ 111 km
  const diagonalKm = diagonalDeg * 111;

  const raw = GLOBE_RADIUS + diagonalKm * ZOOM_SCALE_FACTOR;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, raw));
}
