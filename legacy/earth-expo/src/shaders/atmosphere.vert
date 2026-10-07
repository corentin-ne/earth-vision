/**
 * ============================================================================
 * atmosphere.vert — Fresnel Atmosphere Glow Vertex Shader
 * ============================================================================
 *
 * Transforms vertices for the atmospheric shell sphere and passes
 * view-space data to the fragment shader for Fresnel rim-lighting.
 *
 * The atmosphere is rendered on a sphere slightly larger than the globe.
 * The Fresnel effect makes edges (rim) bright and center (face-on) transparent,
 * simulating atmospheric scattering.
 */

// Three.js injects these automatically:
//   uniform mat4 modelMatrix;
//   uniform mat4 viewMatrix;
//   uniform mat4 projectionMatrix;
//   uniform mat3 normalMatrix;
//   attribute vec3 position;
//   attribute vec3 normal;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    // Transform normal to view space for Fresnel calculation
    vNormal = normalize(normalMatrix * normal);

    // Compute vertex position in view space
    vec4 viewPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;

    // Standard MVP projection
    gl_Position = projectionMatrix * viewPosition;
}
