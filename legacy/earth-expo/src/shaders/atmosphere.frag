/**
 * ============================================================================
 * atmosphere.frag — Fresnel Atmosphere Glow Fragment Shader
 * ============================================================================
 *
 * Produces a soft, luminous atmospheric glow using the Fresnel equation.
 *
 * Physics:
 *   Fresnel factor = (1 - dot(viewDir, normal))^exponent
 *
 * At the rim (viewDir perpendicular to normal):
 *   dot ≈ 0 → Fresnel ≈ 1.0 → full glow
 *
 * At the center (viewDir parallel to normal):
 *   dot ≈ 1 → Fresnel ≈ 0.0 → transparent
 *
 * This simulates Rayleigh scattering without a full atmospheric model.
 */

precision highp float;

// Atmosphere color (default: light blue sky)
uniform vec3 uAtmosphereColor;

// Controls the sharpness of the rim falloff.
// Lower values = wider glow, higher = tighter rim.
// Recommended range: [1.5, 5.0]. Default: 2.5
uniform float uFresnelExponent;

// Overall intensity multiplier for brightness control.
// Range: [0.0, 2.0]. Default: 1.0
uniform float uIntensity;

// Opacity ceiling — prevents the atmosphere from being fully opaque
// even at extreme rim angles. Range: [0.0, 1.0]. Default: 0.8
uniform float uMaxOpacity;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
    // Normalized view direction (from fragment toward camera)
    vec3 viewDir = normalize(-vViewPosition);

    // Fresnel factor: rim = bright, center = transparent
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));

    // Apply power curve for artistic control of falloff
    fresnel = pow(fresnel, uFresnelExponent);

    // Scale by intensity
    fresnel *= uIntensity;

    // Compute final alpha, clamped to max opacity
    float alpha = clamp(fresnel, 0.0, uMaxOpacity);

    // Slight color variation: brighten toward the rim for a "bloom" feel
    vec3 color = uAtmosphereColor + vec3(0.1, 0.15, 0.2) * fresnel;

    gl_FragColor = vec4(color, alpha);
}
