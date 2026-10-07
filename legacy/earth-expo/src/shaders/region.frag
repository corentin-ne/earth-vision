/**
 * ============================================================================
 * region.frag — Per-Region Color & Highlight Fragment Shader
 * ============================================================================
 *
 * Applied to each region mesh on the globe. Supports:
 *   - Base region color (from country or default)
 *   - Hover highlight (additive brightening)
 *   - Selection outline pulse (animated glow)
 *   - Basic Lambertian diffuse lighting
 *
 * The vertex shader is the standard Three.js MeshStandardMaterial vertex
 * shader — we only customize the fragment stage.
 */

precision highp float;

// ── Uniforms ────────────────────────────────────────────────────────────────

// Base fill color for this region (set per-instance or per-draw-call)
uniform vec3 uRegionColor;

// Whether this region is currently hovered (0.0 or 1.0)
uniform float uIsHovered;

// Whether this region is currently selected (0.0 or 1.0)
uniform float uIsSelected;

// Animation time in seconds (for pulsing selection glow)
uniform float uTime;

// Directional light direction (normalized, world-space)
uniform vec3 uLightDirection;

// Ambient light intensity [0, 1]
uniform float uAmbientIntensity;

// ── Varyings ────────────────────────────────────────────────────────────────

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;

// ── Constants ───────────────────────────────────────────────────────────────

const float HOVER_BRIGHTEN    = 0.15;
const float SELECTION_GLOW    = 0.12;
const float SELECTION_FREQ    = 3.0;    // pulse frequency in Hz
const vec3  SPECULAR_COLOR    = vec3(0.3, 0.3, 0.3);
const float SPECULAR_POWER    = 32.0;

void main() {
    // ── Lighting ────────────────────────────────────────────────────────
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(-vViewPosition);

    // Lambertian diffuse
    float NdotL = max(dot(normal, uLightDirection), 0.0);
    float diffuse = uAmbientIntensity + (1.0 - uAmbientIntensity) * NdotL;

    // Blinn-Phong specular
    vec3 halfDir = normalize(uLightDirection + viewDir);
    float NdotH = max(dot(normal, halfDir), 0.0);
    float specular = pow(NdotH, SPECULAR_POWER) * NdotL;

    // ── Base color ──────────────────────────────────────────────────────
    vec3 color = uRegionColor * diffuse + SPECULAR_COLOR * specular;

    // ── Hover highlight ─────────────────────────────────────────────────
    color += vec3(HOVER_BRIGHTEN) * uIsHovered;

    // ── Selection pulse ─────────────────────────────────────────────────
    float pulse = 0.5 + 0.5 * sin(uTime * SELECTION_FREQ * 6.2831853);
    color += vec3(SELECTION_GLOW * pulse) * uIsSelected;

    // ── Output ──────────────────────────────────────────────────────────
    gl_FragColor = vec4(color, 1.0);
}
