/**
 * ============================================================================
 * Atmosphere.tsx — Fresnel Atmospheric Glow Shell
 * ============================================================================
 *
 * Renders a translucent sphere slightly larger than the globe with a custom
 * Fresnel shader that produces a soft atmospheric rim glow.
 *
 * Physics Basis:
 *   Real atmospheric scattering (Rayleigh + Mie) is far too expensive for
 *   mobile GPUs. Instead, we approximate the visual effect with the Fresnel
 *   equation:
 *
 *     F = (1 - dot(viewDir, normal))^exponent
 *
 *   Surfaces viewed edge-on (rim) scatter more light → bright glow.
 *   Surfaces viewed face-on (center) scatter less → transparent.
 *
 *   This single equation, tuned with 3 parameters (exponent, intensity,
 *   maxOpacity), produces a convincing "thin atmosphere" look.
 *
 * Rendering Notes:
 *   - Backface culling is ON (we only see the outer shell).
 *   - Blending is additive for a natural "glow" compositing.
 *   - Depth write is OFF so the atmosphere doesn't occlude the globe.
 *   - The shell radius is 1.02× the globe radius for proper edge coverage.
 *
 * Performance:
 *   - Single draw call.
 *   - Shader runs ~10 instructions per fragment.
 *   - Can be toggled off via `settings.showAtmosphere` for low-end devices.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';

import { hexToRgbNormalized } from '../../utils/math/color';
import { disposeMesh } from '../../utils/disposal';
import { GLOBE_RADIUS, GLOBE_SEGMENTS, ATMOSPHERE_COLOR } from '../../constants';

// ─── Shader Source ──────────────────────────────────────────────────────────

/**
 * Vertex shader: transforms vertices and passes view-space data
 * to the fragment shader for Fresnel calculation.
 */
const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    vNormal = normalize(normalMatrix * normal);

    vec4 viewPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;

    gl_Position = projectionMatrix * viewPosition;
}
`;

/**
 * Fragment shader: computes Fresnel rim glow with artistic controls.
 */
const ATMOSPHERE_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uAtmosphereColor;
uniform float uFresnelExponent;
uniform float uIntensity;
uniform float uMaxOpacity;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    vec3 viewDir = normalize(-vViewPosition);

    // Core Fresnel calculation
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, uFresnelExponent);
    fresnel *= uIntensity;

    float alpha = clamp(fresnel, 0.0, uMaxOpacity);

    // Subtle color shift toward white at the rim for bloom feel
    vec3 color = uAtmosphereColor + vec3(0.1, 0.15, 0.2) * fresnel;

    gl_FragColor = vec4(color, alpha);
}
`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AtmosphereProps {
  /**
   * Whether the atmosphere is visible.
   * When false, the component renders nothing (zero GPU cost).
   */
  visible?: boolean;

  /**
   * Atmosphere color as a hex string.
   * Defaults to ATMOSPHERE_COLOR from constants.
   */
  color?: string;

  /**
   * Controls the sharpness of the Fresnel rim falloff.
   * Lower values produce a wider, softer glow.
   * Higher values produce a tighter, more defined rim.
   *
   * @default 2.5
   * @range [1.0, 6.0]
   */
  fresnelExponent?: number;

  /**
   * Overall brightness multiplier.
   *
   * @default 1.2
   * @range [0.0, 3.0]
   */
  intensity?: number;

  /**
   * Maximum opacity at the rim. Prevents the atmosphere from
   * ever becoming fully opaque, which looks unnatural.
   *
   * @default 0.7
   * @range [0.0, 1.0]
   */
  maxOpacity?: number;

  /**
   * Scale factor relative to GLOBE_RADIUS for the atmosphere shell.
   * Must be > 1.0 to extend beyond the globe surface.
   *
   * @default 1.025
   */
  shellScale?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const Atmosphere: React.FC<AtmosphereProps> = React.memo(function Atmosphere({
  visible = true,
  color = ATMOSPHERE_COLOR,
  fresnelExponent = 2.5,
  intensity = 1.2,
  maxOpacity = 0.7,
  shellScale = 1.025,
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Dispose GPU resources on unmount
  useEffect(() => {
    return () => {
      disposeMesh(meshRef.current);
    };
  }, []);

  // ── Uniforms ────────────────────────────────────────────────────────────

  const uniforms = useMemo(() => {
    const rgb = hexToRgbNormalized(color);
    return {
      uAtmosphereColor: { value: new THREE.Vector3(rgb.r, rgb.g, rgb.b) },
      uFresnelExponent: { value: fresnelExponent },
      uIntensity: { value: intensity },
      uMaxOpacity: { value: maxOpacity },
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reactive uniform updates ──────────────────────────────────────────

  // Update uniforms when props change without reconstructing the material
  React.useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    const rgb = hexToRgbNormalized(color);
    mat.uniforms.uAtmosphereColor.value.set(rgb.r, rgb.g, rgb.b);
    mat.uniforms.uFresnelExponent.value = fresnelExponent;
    mat.uniforms.uIntensity.value = intensity;
    mat.uniforms.uMaxOpacity.value = maxOpacity;
  }, [color, fresnelExponent, intensity, maxOpacity]);

  // ── Shell radius ──────────────────────────────────────────────────────

  const shellRadius = GLOBE_RADIUS * shellScale;

  // ── Render ─────────────────────────────────────────────────────────────

  if (!visible) return null;

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[shellRadius, GLOBE_SEGMENTS, GLOBE_SEGMENTS]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={ATMOSPHERE_VERT}
        fragmentShader={ATMOSPHERE_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
      />
    </mesh>
  );
});
