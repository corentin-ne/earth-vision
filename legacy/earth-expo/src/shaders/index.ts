/**
 * ============================================================================
 * shaders/index.ts — Shader Source Barrel Export
 * ============================================================================
 *
 * Centralizes all GLSL shader source strings for easy importing.
 * The atmosphere shaders are inlined in Atmosphere.tsx for self-containment,
 * but these exports are available for components that prefer file-based
 * shader imports.
 */

export { default as atmosphereVert } from './atmosphere.vert';
export { default as atmosphereFrag } from './atmosphere.frag';
export { default as regionVert } from './region.vert';
export { default as regionFrag } from './region.frag';
