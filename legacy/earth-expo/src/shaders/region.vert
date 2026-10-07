/**
 * ============================================================================
 * region.vert — Per-Region Vertex Shader
 * ============================================================================
 *
 * Transforms region mesh vertices and passes interpolated data to the
 * fragment shader. Supports elevation extrusion along the surface normal.
 */

// Three.js auto-injected uniforms:
//   uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
//   uniform mat3 normalMatrix;
//   attribute vec3 position, normal;
//   attribute vec2 uv;

// Elevation multiplier (1.0 = surface level)
uniform float uElevation;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;

void main() {
    // Apply elevation extrusion along the vertex normal
    vec3 extrudedPosition = position * uElevation;

    // Transform normal to view space
    vNormal = normalize(normalMatrix * normal);

    // Pass UV coordinates to fragment shader
    vUv = uv;

    // Compute view-space position for lighting calculations
    vec4 viewPosition = viewMatrix * modelMatrix * vec4(extrudedPosition, 1.0);
    vViewPosition = viewPosition.xyz;

    // Final clip-space position
    gl_Position = projectionMatrix * viewPosition;
}
