/**
 * ============================================================================
 * glsl.d.ts — TypeScript declarations for GLSL shader imports
 * ============================================================================
 *
 * Allows importing .vert, .frag, and .glsl files as string modules.
 * Requires a bundler plugin (e.g., expo-asset, raw-loader, or Vite's
 * ?raw suffix) to resolve these imports at build time.
 */

declare module '*.vert' {
  const shader: string;
  export default shader;
}

declare module '*.frag' {
  const shader: string;
  export default shader;
}

declare module '*.glsl' {
  const shader: string;
  export default shader;
}
