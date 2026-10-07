/**
 * ============================================================================
 * screenProjection.ts — 2D Screen → 3D Sphere Projection
 * ============================================================================
 *
 * Translates 2D touch/pointer coordinates on the phone screen into
 * geographic [lon, lat] coordinates on the globe surface.
 *
 * ─── THE PROJECTION PIPELINE ───────────────────────────────────────────────
 *
 * When the user draws a line on-screen (to split a region), each finger
 * position must be projected through the following pipeline:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  STEP 1: SCREEN PIXEL → NORMALIZED DEVICE COORDINATES (NDC)        │
 *   │                                                                     │
 *   │  Screen pixels (0,0 = top-left) → NDC (-1,-1 to +1,+1).            │
 *   │                                                                     │
 *   │    ndcX = (screenX / viewportWidth)  × 2 − 1                       │
 *   │    ndcY = (screenY / viewportHeight) × −2 + 1  ← Y flipped!       │
 *   │                                                                     │
 *   │  STEP 2: NDC → 3D RAY DIRECTION (Camera Unprojection)              │
 *   │                                                                     │
 *   │  We construct a ray from the camera through the NDC point:          │
 *   │                                                                     │
 *   │    nearPoint = unproject([ndcX, ndcY, 0])  ← on near plane         │
 *   │    farPoint  = unproject([ndcX, ndcY, 1])  ← on far plane          │
 *   │    rayDir    = normalize(farPoint − nearPoint)                      │
 *   │    rayOrigin = camera.position                                      │
 *   │                                                                     │
 *   │  The unproject operation applies the inverse of:                    │
 *   │    projectionMatrix × viewMatrix                                    │
 *   │                                                                     │
 *   │  STEP 3: RAY-SPHERE INTERSECTION                                   │
 *   │                                                                     │
 *   │  The globe is a sphere centered at origin with radius R.            │
 *   │  We solve the quadratic equation:                                   │
 *   │                                                                     │
 *   │    |rayOrigin + t × rayDir|² = R²                                   │
 *   │                                                                     │
 *   │  Expanding:                                                         │
 *   │    a = dot(rayDir, rayDir)            = |d|² = 1 (normalized)       │
 *   │    b = 2 × dot(rayOrigin, rayDir)                                   │
 *   │    c = dot(rayOrigin, rayOrigin) − R²                               │
 *   │                                                                     │
 *   │    discriminant = b² − 4ac                                          │
 *   │                                                                     │
 *   │    If discriminant < 0 → ray misses sphere (finger off-globe)       │
 *   │    If discriminant ≥ 0 → t = (−b − √discriminant) / 2a             │
 *   │                         (take nearest intersection)                 │
 *   │                                                                     │
 *   │    hitPoint = rayOrigin + t × rayDir                                │
 *   │                                                                     │
 *   │  STEP 4: CARTESIAN → GEOGRAPHIC COORDINATES                        │
 *   │                                                                     │
 *   │  Convert the 3D hit point to [lon, lat] using:                      │
 *   │                                                                     │
 *   │    lat = arcsin(y / R)  × (180/π)                                   │
 *   │    lon = atan2(z, −x)   × (180/π)                                   │
 *   │                                                                     │
 *   │  (Using our project convention where x is negated for east)         │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * ─── USAGE ─────────────────────────────────────────────────────────────────
 *
 * This module provides pure math functions — no React dependencies.
 * The `useDrawLine` hook wraps these functions with gesture handling.
 */

import { GLOBE_RADIUS } from '../../constants';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A 3D vector as [x, y, z]. */
export type Vec3 = [number, number, number];

/** A 4×4 matrix stored as a flat 16-element array (column-major). */
export type Mat4 = number[];

/** Screen-space point in pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Viewport dimensions in pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/** A ray defined by origin and direction. */
export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

// ─── Step 1: Screen Pixel → NDC ────────────────────────────────────────────

/**
 * Convert screen pixel coordinates to Normalized Device Coordinates (NDC).
 *
 * NDC ranges from (-1, -1) at bottom-left to (+1, +1) at top-right.
 * Screen coordinates have (0, 0) at top-left, Y increasing downward.
 *
 * @param screen   Touch position in screen pixels.
 * @param viewport Viewport dimensions.
 * @returns        [ndcX, ndcY] in range [-1, 1].
 */
export function screenToNDC(
  screen: ScreenPoint,
  viewport: Viewport,
): [ndcX: number, ndcY: number] {
  // X: 0 → -1, width → +1
  const ndcX = (screen.x / viewport.width) * 2 - 1;
  // Y: 0 → +1, height → -1 (flip because screen Y is inverted vs NDC)
  const ndcY = -(screen.y / viewport.height) * 2 + 1;

  return [ndcX, ndcY];
}

// ─── Step 2: NDC → 3D Ray (Camera Unprojection) ────────────────────────────

/**
 * Multiply a 4×4 matrix (column-major) by a 4D vector.
 * Used to unproject NDC coordinates through the inverse view-projection.
 */
function mat4MulVec4(
  m: Mat4,
  v: [number, number, number, number],
): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8]  * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9]  * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

/**
 * Unproject an NDC point at a given depth through the inverse
 * view-projection matrix to get a world-space 3D point.
 *
 * @param ndcX   Normalized device X [-1, 1].
 * @param ndcY   Normalized device Y [-1, 1].
 * @param ndcZ   Depth in NDC space. 0 = near plane, 1 = far plane.
 * @param invVP  Inverse of (projectionMatrix × viewMatrix), column-major.
 * @returns      [x, y, z] in world space.
 */
export function unprojectNDC(
  ndcX: number,
  ndcY: number,
  ndcZ: number,
  invVP: Mat4,
): Vec3 {
  // NDC to clip space: z maps from [0,1] to [-1,1] in clip space
  const clipZ = ndcZ * 2 - 1;

  // Multiply by inverse view-projection
  const [wx, wy, wz, ww] = mat4MulVec4(invVP, [ndcX, ndcY, clipZ, 1]);

  // Perspective divide (w-divide)
  const invW = 1 / ww;
  return [wx * invW, wy * invW, wz * invW];
}

/**
 * Construct a ray from the camera through a screen point.
 *
 * @param screen     Screen pixel position.
 * @param viewport   Viewport dimensions.
 * @param cameraPos  Camera world-space position [x, y, z].
 * @param invVP      Inverse view-projection matrix.
 * @returns          Ray with normalized direction.
 */
export function screenToRay(
  screen: ScreenPoint,
  viewport: Viewport,
  cameraPos: Vec3,
  invVP: Mat4,
): Ray {
  const [ndcX, ndcY] = screenToNDC(screen, viewport);

  // Unproject at near and far planes to define the ray
  const near = unprojectNDC(ndcX, ndcY, 0, invVP);
  const far = unprojectNDC(ndcX, ndcY, 1, invVP);

  // Direction: far - near, then normalize
  const dx = far[0] - near[0];
  const dy = far[1] - near[1];
  const dz = far[2] - near[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    origin: cameraPos,
    direction: [dx / len, dy / len, dz / len],
  };
}

// ─── Step 3: Ray-Sphere Intersection ────────────────────────────────────────

/**
 * Find the intersection point of a ray with a sphere centered at origin.
 *
 * Solves the quadratic equation:
 *   |O + t·D|² = R²
 * where O = ray origin, D = ray direction (unit), R = sphere radius.
 *
 * @param ray     The ray to test.
 * @param radius  Sphere radius. Defaults to GLOBE_RADIUS.
 * @returns       The nearest intersection point [x, y, z], or null if the
 *                ray misses the sphere.
 */
export function raySphereIntersect(
  ray: Ray,
  radius: number = GLOBE_RADIUS,
): Vec3 | null {
  const { origin: o, direction: d } = ray;

  // Quadratic coefficients:
  //   a = d·d = 1 (direction is normalized)
  //   b = 2(o·d)
  //   c = o·o - R²
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = 2 * (o[0] * d[0] + o[1] * d[1] + o[2] * d[2]);
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - radius * radius;

  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) {
    // Ray misses the sphere entirely — finger is off the globe
    return null;
  }

  // Take the nearest (smallest positive) t
  // We use (-b - sqrt(disc)) / 2a because we want the FRONT intersection
  // (the side of the sphere facing the camera)
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  // Pick the closest positive t (in front of the camera)
  const t = t1 >= 0 ? t1 : t2 >= 0 ? t2 : null;
  if (t === null) {
    // Sphere is entirely behind the camera
    return null;
  }

  return [
    o[0] + t * d[0],
    o[1] + t * d[1],
    o[2] + t * d[2],
  ];
}

// ─── Step 4: Cartesian → Geographic ────────────────────────────────────────

/**
 * Convert a 3D point on the sphere to geographic coordinates.
 * Re-exported from projection.ts for convenience in the pipeline.
 */
export function hitPointToLatLon(
  point: Vec3,
): [lon: number, lat: number] {
  const [x, y, z] = point;
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r === 0) return [0, 0];

  const RAD2DEG = 180 / Math.PI;
  const lat = Math.asin(y / r) * RAD2DEG;
  // Our projection convention: x = -R·cosφ·cosλ, z = R·cosφ·sinλ
  const lon = Math.atan2(z, -x) * RAD2DEG;

  return [lon, lat];
}

// ─── Complete Pipeline: Screen Point → Geo Coordinate ──────────────────────

/**
 * Project a single screen pixel position to a geographic [lon, lat]
 * coordinate on the globe surface.
 *
 * Returns null if the pixel doesn't hit the globe (finger is off-sphere).
 *
 * @param screen    Screen pixel position.
 * @param viewport  Viewport dimensions.
 * @param cameraPos Camera world position [x, y, z].
 * @param invVP     Inverse view-projection matrix (column-major).
 * @param radius    Globe radius. Defaults to GLOBE_RADIUS.
 * @returns         [longitude, latitude] or null.
 */
export function screenToGeo(
  screen: ScreenPoint,
  viewport: Viewport,
  cameraPos: Vec3,
  invVP: Mat4,
  radius: number = GLOBE_RADIUS,
): [lon: number, lat: number] | null {
  const ray = screenToRay(screen, viewport, cameraPos, invVP);
  const hit = raySphereIntersect(ray, radius);
  if (!hit) return null;
  return hitPointToLatLon(hit);
}

// ─── Screen Line → Geographic Line ─────────────────────────────────────────

/**
 * Convert an array of screen-space points (a drawn line) into an array
 * of geographic coordinates on the globe surface.
 *
 * Points that miss the globe (e.g., dragged off the edge) are silently
 * dropped. The result may have fewer points than the input.
 *
 * For a clean split, the line should be extended slightly beyond the
 * region's boundaries. This function handles that via the `extendBy`
 * parameter, which adds extra length at both endpoints.
 *
 * @param screenPoints  Array of screen-space touch points.
 * @param viewport      Viewport dimensions.
 * @param cameraPos     Camera world position.
 * @param invVP         Inverse view-projection matrix.
 * @param extendBy      How many degrees to extend the line at each end.
 *                      Default 5°. Ensures the cut crosses the region boundary.
 * @returns             Array of [lon, lat] geo coordinates, possibly shorter
 *                      than input if some points missed the globe.
 */
export function screenLineToGeoLine(
  screenPoints: ScreenPoint[],
  viewport: Viewport,
  cameraPos: Vec3,
  invVP: Mat4,
  extendBy: number = 5,
): [lon: number, lat: number][] {
  // Project each screen point onto the globe
  const geoPoints: [lon: number, lat: number][] = [];

  for (const sp of screenPoints) {
    const geo = screenToGeo(sp, viewport, cameraPos, invVP);
    if (geo) geoPoints.push(geo);
  }

  if (geoPoints.length < 2) return geoPoints;

  // ── Extend the line at both endpoints ────────────────────────────────
  // This ensures the cutting blade extends beyond the region boundary,
  // which is required for turf.difference to produce a clean bisection.
  //
  // We compute the direction at each endpoint and extrapolate.
  const first = geoPoints[0];
  const second = geoPoints[1];
  const last = geoPoints[geoPoints.length - 1];
  const secondToLast = geoPoints[geoPoints.length - 2];

  // Direction at start (pointing backward from start)
  const startDLon = first[0] - second[0];
  const startDLat = first[1] - second[1];
  const startLen = Math.sqrt(startDLon ** 2 + startDLat ** 2) || 1;

  // Direction at end (pointing forward from end)
  const endDLon = last[0] - secondToLast[0];
  const endDLat = last[1] - secondToLast[1];
  const endLen = Math.sqrt(endDLon ** 2 + endDLat ** 2) || 1;

  // Prepend an extended start point
  const extStart: [number, number] = [
    first[0] + (startDLon / startLen) * extendBy,
    Math.max(-89, Math.min(89, first[1] + (startDLat / startLen) * extendBy)),
  ];

  // Append an extended end point
  const extEnd: [number, number] = [
    last[0] + (endDLon / endLen) * extendBy,
    Math.max(-89, Math.min(89, last[1] + (endDLat / endLen) * extendBy)),
  ];

  return [extStart, ...geoPoints, extEnd];
}
