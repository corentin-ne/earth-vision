/**
 * ============================================================================
 * RegionMesh.tsx — Individual Extruded Region Polygon
 * ============================================================================
 *
 * Renders a single region as an extruded polygon on the globe surface.
 * Used when an individual region needs isolated rendering — e.g., for
 * elevation extrusion animations, selection outlines, or custom shaders
 * that can't be applied through the merged GlobeMesh vertex colors.
 *
 * For the base static map, prefer GlobeMesh (merged geometry, fewer draw calls).
 * Mount RegionMesh only for the currently selected/animated region.
 *
 * Architecture:
 * - Pure presentational — all data flows in via props.
 * - Uses the custom region.vert / region.frag shaders.
 * - Triangulates its geometry on mount and caches it.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { RegionId, RegionGeometry, RegionMeta } from '../../types';
import { triangulateMultiPolygon } from '../../utils/geo/triangulation';
import { hexToRgbNormalized } from '../../utils/math/color';
import { GLOBE_RADIUS, DEFAULT_UNOWNED_COLOR } from '../../constants';

// Import shader source as strings
// In a bundler-configured project, these would use raw-loader or asset/source
import atmosphereVert from '../../shaders/region.vert';
import atmosphereFrag from '../../shaders/region.frag';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RegionMeshProps {
  /** The immutable geometry for this region. */
  geometry: RegionGeometry;

  /** The mutable metadata for this region. */
  meta: RegionMeta;

  /** Resolved display color (hex string). */
  color: string;

  /** Whether this region is currently hovered. */
  isHovered: boolean;

  /** Whether this region is currently selected. */
  isSelected: boolean;

  /** Ambient light intensity from world settings. */
  ambientIntensity: number;

  /** Sun/light direction (normalized). */
  lightDirection?: [number, number, number];
}

// ─── Component ──────────────────────────────────────────────────────────────

export const RegionMesh: React.FC<RegionMeshProps> = React.memo(function RegionMesh({
  geometry: regionGeometry,
  meta,
  color,
  isHovered,
  isSelected,
  ambientIntensity,
  lightDirection = [0.5, 1.0, 0.3],
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // ── Triangulate region geometry ─────────────────────────────────────────

  const bufferGeometry = useMemo(() => {
    const polygons = regionGeometry.rings.map(
      (ring) => [ring as unknown as readonly [number, number][]] as const,
    );

    const tri = triangulateMultiPolygon(
      polygons as unknown as ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>>,
      GLOBE_RADIUS,
      meta.elevation,
    );

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(tri.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(tri.normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(tri.uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(tri.indices, 1));
    geom.computeBoundingSphere();

    return geom;
  }, [regionGeometry, meta.elevation]);

  // ── Shader material ────────────────────────────────────────────────────

  const uniforms = useMemo(() => {
    const rgb = hexToRgbNormalized(color);
    return {
      uRegionColor: { value: new THREE.Vector3(rgb.r, rgb.g, rgb.b) },
      uIsHovered: { value: 0.0 },
      uIsSelected: { value: 0.0 },
      uTime: { value: 0.0 },
      uLightDirection: {
        value: new THREE.Vector3(...lightDirection).normalize(),
      },
      uAmbientIntensity: { value: ambientIntensity },
      uElevation: { value: meta.elevation },
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reactive uniform updates ───────────────────────────────────────────

  useFrame((_, delta) => {
    const mat = materialRef.current;
    if (!mat) return;

    // Update time for selection pulse animation
    mat.uniforms.uTime.value += delta;

    // Update color
    const rgb = hexToRgbNormalized(color);
    mat.uniforms.uRegionColor.value.set(rgb.r, rgb.g, rgb.b);

    // Update interaction state
    mat.uniforms.uIsHovered.value = isHovered ? 1.0 : 0.0;
    mat.uniforms.uIsSelected.value = isSelected ? 1.0 : 0.0;

    // Update lighting
    mat.uniforms.uAmbientIntensity.value = ambientIntensity;
    mat.uniforms.uElevation.value = meta.elevation;
  });

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <mesh ref={meshRef} geometry={bufferGeometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={atmosphereVert}
        fragmentShader={atmosphereFrag}
        uniforms={uniforms}
        transparent={false}
        depthWrite
        side={THREE.FrontSide}
      />
    </mesh>
  );
});
