/**
 * ============================================================================
 * projection.ts — Geographic ↔ Cartesian Coordinate Transformations
 * ============================================================================
 *
 * Pure math functions for projecting geographic coordinates (latitude,
 * longitude) onto a Three.js sphere surface, and vice versa.
 *
 * Convention (Three.js Y-up, right-handed):
 *
 *   +Y = North Pole
 *   -Y = South Pole
 *   +Z = Prime Meridian (lon = 0°, lat = 0°)
 *   +X = lon = 90°E
 *
 * Formulas:
 *   x = -R × cos(φ) × cos(λ)   ← negated so lon increases eastward on-screen
 *   y =  R × sin(φ)
 *   z =  R × cos(φ) × sin(λ)
 *
 * Where:
 *   φ = latitude  in radians  [-π/2,  π/2]
 *   λ = longitude in radians  [-π,    π  ]
 *   R = globe radius
 *
 * All inputs are in DEGREES unless explicitly noted. Outputs are in
 * Three.js world-space units.
 */

import { GLOBE_RADIUS } from '../../constants';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ─── Lat/Lon → Cartesian (x, y, z) ─────────────────────────────────────────

/**
 * Convert a geographic coordinate pair to a 3D point on a sphere.
 *
 * @param lat     Latitude  in degrees, [-90, 90].
 * @param lon     Longitude in degrees, [-180, 180].
 * @param radius  Sphere radius in world units. Defaults to GLOBE_RADIUS.
 * @returns       [x, y, z] tuple in Three.js world space.
 *
 * @example
 * ```ts
 * // New York City
 * const [x, y, z] = latLonToCartesian(40.7128, -74.006);
 * ```
 */
export function latLonToCartesian(
  lat: number,
  lon: number,
  radius: number = GLOBE_RADIUS,
): [x: number, y: number, z: number] {
  const phi = lat * DEG2RAD;   // latitude  → radians
  const lambda = lon * DEG2RAD; // longitude → radians

  const cosPhi = Math.cos(phi);

  return [
    -radius * cosPhi * Math.cos(lambda),
     radius * Math.sin(phi),
     radius * cosPhi * Math.sin(lambda),
  ];
}

/**
 * Batch-convert an array of [lon, lat] rings (GeoJSON winding order)
 * into flat Float32 arrays suitable for a Three.js BufferGeometry.
 *
 * @param ring    Array of [longitude, latitude] pairs.
 * @param radius  Sphere radius. Defaults to GLOBE_RADIUS.
 * @returns       Float32Array of [x, y, z, x, y, z, …].
 */
export function ringToCartesianArray(
  ring: ReadonlyArray<readonly [number, number]>,
  radius: number = GLOBE_RADIUS,
): Float32Array {
  const out = new Float32Array(ring.length * 3);
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    const phi = lat * DEG2RAD;
    const lambda = lon * DEG2RAD;
    const cosPhi = Math.cos(phi);

    out[i * 3]     = -radius * cosPhi * Math.cos(lambda);
    out[i * 3 + 1] =  radius * Math.sin(phi);
    out[i * 3 + 2] =  radius * cosPhi * Math.sin(lambda);
  }
  return out;
}

// ─── Cartesian (x, y, z) → Lat/Lon ─────────────────────────────────────────

/**
 * Convert a 3D world-space point back to geographic coordinates.
 *
 * @param x  X coordinate in world space.
 * @param y  Y coordinate in world space.
 * @param z  Z coordinate in world space.
 * @returns  [latitude, longitude] in degrees.
 */
export function cartesianToLatLon(
  x: number,
  y: number,
  z: number,
): [lat: number, lon: number] {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r === 0) return [0, 0];

  const lat = Math.asin(y / r) * RAD2DEG;
  const lon = Math.atan2(z, -x) * RAD2DEG;

  return [lat, lon];
}

// ─── Surface Normal at a Geographic Point ───────────────────────────────────

/**
 * Compute the outward-facing unit normal vector at a given lat/lon.
 * Useful for extruding regions above the globe surface.
 *
 * @param lat  Latitude in degrees.
 * @param lon  Longitude in degrees.
 * @returns    [nx, ny, nz] unit normal.
 */
export function surfaceNormal(
  lat: number,
  lon: number,
): [nx: number, ny: number, nz: number] {
  const phi = lat * DEG2RAD;
  const lambda = lon * DEG2RAD;
  const cosPhi = Math.cos(phi);

  return [
    -cosPhi * Math.cos(lambda),
     Math.sin(phi),
     cosPhi * Math.sin(lambda),
  ];
}

// ─── Great-circle Distance ──────────────────────────────────────────────────

/**
 * Compute the great-circle distance between two points using the
 * Haversine formula. Returns distance in world-space units (not km).
 *
 * @param lat1  First point latitude (degrees).
 * @param lon1  First point longitude (degrees).
 * @param lat2  Second point latitude (degrees).
 * @param lon2  Second point longitude (degrees).
 * @param radius Sphere radius. Defaults to GLOBE_RADIUS.
 * @returns     Arc distance in world-space units.
 */
export function greatCircleDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radius: number = GLOBE_RADIUS,
): number {
  const φ1 = lat1 * DEG2RAD;
  const φ2 = lat2 * DEG2RAD;
  const Δφ = (lat2 - lat1) * DEG2RAD;
  const Δλ = (lon2 - lon1) * DEG2RAD;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

// ─── Interpolation Along a Great Circle ─────────────────────────────────────

/**
 * Spherical linear interpolation (SLERP) between two geographic points.
 * Useful for generating intermediate points along a great-circle arc
 * (e.g., border line tessellation).
 *
 * @param lat1  Start latitude (degrees).
 * @param lon1  Start longitude (degrees).
 * @param lat2  End latitude (degrees).
 * @param lon2  End longitude (degrees).
 * @param t     Interpolation parameter [0, 1].
 * @param radius Sphere radius. Defaults to GLOBE_RADIUS.
 * @returns     [x, y, z] interpolated point on the sphere surface.
 */
export function slerpOnSphere(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number,
  radius: number = GLOBE_RADIUS,
): [x: number, y: number, z: number] {
  const [x1, y1, z1] = latLonToCartesian(lat1, lon1, 1);
  const [x2, y2, z2] = latLonToCartesian(lat2, lon2, 1);

  // Dot product of unit vectors
  let dot = x1 * x2 + y1 * y2 + z1 * z2;
  dot = Math.max(-1, Math.min(1, dot)); // numerical safety

  const omega = Math.acos(dot);

  // Degenerate case: points are coincident or antipodal
  if (omega < 1e-6) {
    return [
      radius * (x1 + t * (x2 - x1)),
      radius * (y1 + t * (y2 - y1)),
      radius * (z1 + t * (z2 - z1)),
    ];
  }

  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;

  return [
    radius * (a * x1 + b * x2),
    radius * (a * y1 + b * y2),
    radius * (a * z1 + b * z2),
  ];
}
