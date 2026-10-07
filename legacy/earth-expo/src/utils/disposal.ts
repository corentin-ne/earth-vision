/**
 * ============================================================================
 * disposal.ts — Three.js Resource Disposal Utilities
 * ============================================================================
 *
 * Provides functions for properly disposing of Three.js objects (Geometries,
 * Materials, Textures) to prevent WebGL context loss and memory leaks.
 *
 * Why This Matters:
 *   Three.js allocates GPU resources (vertex buffers, shader programs,
 *   texture memory) that are NOT managed by JavaScript's garbage collector.
 *   If a component unmounts without explicitly calling `.dispose()`, those
 *   GPU resources remain allocated until the WebGL context is destroyed
 *   (i.e., the entire app is killed).
 *
 *   On mobile (React Native + expo-gl), the WebGL context has strict
 *   memory limits. Leaked resources accumulate and eventually trigger
 *   GL_OUT_OF_MEMORY or context loss — crashing the 3D viewport.
 *
 * Usage:
 *   These utilities are designed to be called in React `useEffect` cleanup
 *   blocks or in `onUnmounted` callbacks for R3F components.
 *
 * Architecture:
 *   - Pure functions with zero React/R3F dependencies.
 *   - Safe to call multiple times (idempotent disposal checks).
 *   - Recursive traversal for scene graph cleanup.
 */

import * as THREE from 'three';

// ─── Individual Resource Disposal ───────────────────────────────────────────

/**
 * Dispose a single BufferGeometry, freeing all GPU vertex/index buffers.
 *
 * Safe to call on null/undefined — no-ops gracefully.
 */
export function disposeGeometry(geometry: THREE.BufferGeometry | null | undefined): void {
  if (!geometry) return;
  geometry.dispose();
}

/**
 * Dispose a single Material and all its texture maps.
 *
 * Handles both single materials and material arrays (common with
 * multi-material meshes). Automatically traverses known texture
 * properties (map, normalMap, envMap, etc.).
 */
export function disposeMaterial(
  material: THREE.Material | THREE.Material[] | null | undefined,
): void {
  if (!material) return;

  const materials = Array.isArray(material) ? material : [material];

  for (const mat of materials) {
    // Dispose all texture maps attached to the material
    disposeTexturesFromMaterial(mat);

    // Dispose the material's shader program
    mat.dispose();
  }
}

/**
 * Dispose a single Texture, freeing GPU texture memory.
 */
export function disposeTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture) return;
  texture.dispose();
}

// ─── Texture Map Traversal ──────────────────────────────────────────────────

/**
 * Known texture property names on Three.js materials.
 * Covers MeshStandardMaterial, MeshPhysicalMaterial, ShaderMaterial, etc.
 */
const TEXTURE_PROPERTIES = [
  'map',
  'lightMap',
  'bumpMap',
  'normalMap',
  'specularMap',
  'envMap',
  'alphaMap',
  'aoMap',
  'displacementMap',
  'emissiveMap',
  'gradientMap',
  'metalnessMap',
  'roughnessMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
] as const;

/**
 * Iterate over all known texture properties on a material and dispose them.
 */
function disposeTexturesFromMaterial(material: THREE.Material): void {
  for (const prop of TEXTURE_PROPERTIES) {
    const texture = (material as unknown as Record<string, unknown>)[prop];
    if (texture instanceof THREE.Texture) {
      texture.dispose();
    }
  }
}

// ─── Composite Disposal ─────────────────────────────────────────────────────

/**
 * Dispose a complete Three.js mesh: its geometry + material(s) + textures.
 *
 * This is the primary disposal function for individual R3F components.
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   return () => disposeMesh(meshRef.current);
 * }, []);
 * ```
 */
export function disposeMesh(mesh: THREE.Mesh | null | undefined): void {
  if (!mesh) return;
  disposeGeometry(mesh.geometry);
  disposeMaterial(mesh.material as THREE.Material | THREE.Material[]);
}

/**
 * Dispose a line object (LineSegments, Line, etc.): geometry + material.
 */
export function disposeLine(
  line: THREE.LineSegments | THREE.Line | null | undefined,
): void {
  if (!line) return;
  disposeGeometry(line.geometry);
  disposeMaterial(line.material as THREE.Material | THREE.Material[]);
}

// ─── Scene Graph Traversal ──────────────────────────────────────────────────

/**
 * Recursively traverse a Three.js object and dispose ALL geometries,
 * materials, and textures found in the subtree.
 *
 * Use this for full scene cleanup when the entire `<Canvas>` unmounts.
 *
 * @param root - The root Object3D (scene, group, or mesh) to traverse.
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   return () => disposeSceneGraph(sceneRef.current);
 * }, []);
 * ```
 */
export function disposeSceneGraph(root: THREE.Object3D | null | undefined): void {
  if (!root) return;

  root.traverse((child) => {
    // Dispose mesh geometry + material
    if (child instanceof THREE.Mesh) {
      disposeGeometry(child.geometry);
      disposeMaterial(child.material as THREE.Material | THREE.Material[]);
    }

    // Dispose line geometry + material
    if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
      disposeGeometry(child.geometry);
      disposeMaterial(child.material as THREE.Material | THREE.Material[]);
    }

    // Dispose points geometry + material
    if (child instanceof THREE.Points) {
      disposeGeometry(child.geometry);
      disposeMaterial(child.material as THREE.Material | THREE.Material[]);
    }
  });
}

// ─── React Hook Helper ──────────────────────────────────────────────────────

/**
 * Create a cleanup callback suitable for `useEffect` return.
 *
 * Accepts any combination of geometries, materials, and meshes.
 * Returns a single function that disposes them all.
 *
 * @example
 * ```tsx
 * const geometry = useMemo(() => new THREE.SphereGeometry(1, 64, 64), []);
 * const material = useMemo(() => new THREE.MeshStandardMaterial(), []);
 *
 * useEffect(() => {
 *   return createCleanup({ geometries: [geometry], materials: [material] });
 * }, [geometry, material]);
 * ```
 */
export function createCleanup(resources: {
  geometries?: (THREE.BufferGeometry | null | undefined)[];
  materials?: (THREE.Material | THREE.Material[] | null | undefined)[];
  textures?: (THREE.Texture | null | undefined)[];
  meshes?: (THREE.Mesh | null | undefined)[];
  lines?: (THREE.LineSegments | THREE.Line | null | undefined)[];
  scenes?: (THREE.Object3D | null | undefined)[];
}): () => void {
  return () => {
    resources.geometries?.forEach(disposeGeometry);
    resources.materials?.forEach(disposeMaterial);
    resources.textures?.forEach(disposeTexture);
    resources.meshes?.forEach(disposeMesh);
    resources.lines?.forEach(disposeLine);
    resources.scenes?.forEach(disposeSceneGraph);
  };
}
