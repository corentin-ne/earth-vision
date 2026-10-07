/**
 * ============================================================================
 * triangulation.ts — Spherical Polygon Triangulation
 * ============================================================================
 *
 * Converts geographic polygon rings into triangulated mesh data suitable
 * for Three.js BufferGeometry. Uses Earcut for 2D triangulation, then
 * projects vertices onto the sphere surface.
 *
 * Design Goals:
 * 1. Produce compact Float32Array outputs (position, normal, uv).
 * 2. Handle multi-polygon regions (archipelagos) and holes.
 * 3. Remain stateless and framework-agnostic for easy unit testing.
 */

import { latLonToCartesian, surfaceNormal } from './projection';
import { GLOBE_RADIUS } from '../../constants';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Output of triangulating a geographic polygon for GPU consumption. */
export interface TriangulatedRegion {
  /** Flat [x, y, z, x, y, z, …] vertex positions on the sphere. */
  positions: Float32Array;

  /** Flat [nx, ny, nz, …] outward-facing normals (unit vectors). */
  normals: Float32Array;

  /** Flat [u, v, …] texture coordinates derived from lon/lat. */
  uvs: Float32Array;

  /** Triangle index array referencing positions. */
  indices: Uint32Array;

  /** Number of triangles. */
  triangleCount: number;
}

// ─── Earcut Triangulation ───────────────────────────────────────────────────

// Re-export earcut's triangulation.
// The `earcut` package is a dependency — install via `npm i earcut`.
// Type definitions: `npm i -D @types/earcut`.
import earcutModule from 'earcut';

// Handle both ESM default and CJS module.exports
const earcut = (typeof earcutModule === 'function'
  ? earcutModule
  : (earcutModule as any).default ?? earcutModule) as typeof earcutModule;

function earcutTriangulate(
  flatCoords: number[],
  holeIndices: number[] | null,
  dim: number,
): number[] {
  return earcut(flatCoords, holeIndices ?? undefined, dim);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Triangulate one or more polygon rings into GPU-ready mesh data.
 *
 * @param rings     Array of coordinate rings. First ring is the exterior;
 *                  subsequent rings are holes. Each ring is [lon, lat][].
 * @param radius    Sphere radius. Defaults to GLOBE_RADIUS.
 * @param elevation Elevation multiplier (1.0 = surface, >1 = extruded).
 * @returns         TriangulatedRegion ready for BufferGeometry.
 */
export function triangulatePolygon(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  radius: number = GLOBE_RADIUS,
  elevation: number = 1.0,
): TriangulatedRegion {
  const effectiveRadius = radius * elevation;

  // 1. Flatten all rings into 2D coordinates for Earcut.
  //    We use lon/lat as the 2D plane for triangulation, which works
  //    well enough for most regions. Polar regions may need stereographic
  //    projection for better results — a future enhancement.
  const flatCoords: number[] = [];
  const holeIndices: number[] = [];
  let vertexCount = 0;

  for (let r = 0; r < rings.length; r++) {
    if (r > 0) {
      holeIndices.push(vertexCount);
    }
    const ring = rings[r];
    for (let i = 0; i < ring.length; i++) {
      flatCoords.push(ring[i][0], ring[i][1]); // lon, lat
      vertexCount++;
    }
  }

  // 2. Triangulate in 2D lon/lat space.
  const rawIndices = earcutTriangulate(
    flatCoords,
    holeIndices.length > 0 ? holeIndices : null,
    2,
  );

  // 3. Project each 2D vertex onto the sphere.
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const lon = flatCoords[i * 2];
    const lat = flatCoords[i * 2 + 1];

    const [x, y, z] = latLonToCartesian(lat, lon, effectiveRadius);
    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const [nx, ny, nz] = surfaceNormal(lat, lon);
    normals[i * 3]     = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;

    // UV: map longitude to U [0, 1], latitude to V [0, 1]
    uvs[i * 2]     = (lon + 180) / 360;
    uvs[i * 2 + 1] = (lat + 90) / 180;
  }

  const indices = new Uint32Array(rawIndices);

  return {
    positions,
    normals,
    uvs,
    indices,
    triangleCount: rawIndices.length / 3,
  };
}

/**
 * Triangulate a multi-polygon region (e.g., archipelago) and merge
 * all the individual polygon meshes into a single TriangulatedRegion.
 *
 * @param polygons  Array of polygons. Each polygon is an array of rings
 *                  (first = exterior, rest = holes).
 * @param radius    Sphere radius.
 * @param elevation Elevation multiplier.
 * @returns         Merged TriangulatedRegion.
 */
export function triangulateMultiPolygon(
  polygons: ReadonlyArray<
    ReadonlyArray<ReadonlyArray<readonly [number, number]>>
  >,
  radius: number = GLOBE_RADIUS,
  elevation: number = 1.0,
): TriangulatedRegion {
  if (polygons.length === 1) {
    return triangulatePolygon(polygons[0], radius, elevation);
  }

  const parts = polygons.map((p) => triangulatePolygon(p, radius, elevation));

  // Calculate total sizes
  let totalPositions = 0;
  let totalIndices = 0;
  for (const part of parts) {
    totalPositions += part.positions.length;
    totalIndices += part.indices.length;
  }

  const mergedPositions = new Float32Array(totalPositions);
  const mergedNormals = new Float32Array(totalPositions);
  const mergedUvs = new Float32Array((totalPositions / 3) * 2);
  const mergedIndices = new Uint32Array(totalIndices);

  let posOffset = 0;
  let uvOffset = 0;
  let idxOffset = 0;
  let vertexOffset = 0;

  for (const part of parts) {
    mergedPositions.set(part.positions, posOffset);
    mergedNormals.set(part.normals, posOffset);
    mergedUvs.set(part.uvs, uvOffset);

    // Offset indices by the running vertex count
    for (let i = 0; i < part.indices.length; i++) {
      mergedIndices[idxOffset + i] = part.indices[i] + vertexOffset;
    }

    posOffset += part.positions.length;
    uvOffset += part.uvs.length;
    idxOffset += part.indices.length;
    vertexOffset += part.positions.length / 3;
  }

  return {
    positions: mergedPositions,
    normals: mergedNormals,
    uvs: mergedUvs,
    indices: mergedIndices,
    triangleCount: totalIndices / 3,
  };
}
