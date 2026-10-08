// Animated water surface: a MapLibre custom layer that lights a procedural wave field.
//
// A grid over the whole mercator square is projected with MapLibre's own `projectTile`
// (so it works on the globe and the flat map). The fragment shader builds a moving
// height field from two drifting layers of gradient noise, takes its slope as the
// surface normal and lights it with a sun: lit slopes get a soft highlight, the far
// sides a little shade, crests a specular glint. The result is blended over the
// depth-coloured sea; the land layers drawn above hide it everywhere else.
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';

export interface WaterLook {
  /** Highlight colour (sun glint / foam), 0–1 RGB. */
  light: [number, number, number];
  /** Colour of the shaded wave sides, 0–1 RGB. */
  shade: [number, number, number];
  /** Overall strength, 0 disables the layer. */
  strength: number;
}

const GRID = 64;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_merc;
uniform float u_time;
uniform float u_zoom;
uniform vec3 u_light;
uniform vec3 u_shade;
uniform float u_strength;
out vec4 fragColor;

// Integer hash of a lattice point to a gradient in [-1, 1]². Unlike the classic sin() hash
// it is exact on every GPU (mobile ones lose precision with sin of large numbers).
vec2 hash2(vec2 p) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  uvec2 r = uvec2(n, n * 48271u) >> 8;
  return vec2(r) * (2.0 / 16777215.0) - 1.0;
}

// Gradient noise (Inigo Quilez), returns value and derivatives.
vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash2(i + vec2(0.0, 0.0));
  vec2 gb = hash2(i + vec2(1.0, 0.0));
  vec2 gc = hash2(i + vec2(0.0, 1.0));
  vec2 gd = hash2(i + vec2(1.0, 1.0));
  float va = dot(ga, f - vec2(0.0, 0.0));
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
              ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) +
              du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va));
}

// Slope of the wave field at p (in "wave units"), animated by t. Every layer and octave
// runs on its own rotated lattice: axis-aligned noise lattices show up as a faint grid.
vec2 slope(vec2 p, float t) {
  vec2 g = vec2(0.0);
  float a = 1.0;
  mat2 r1 = mat2(0.866, -0.5, 0.5, 0.866);    // 30°
  mat2 r2 = mat2(0.423, 0.906, -0.906, 0.423); // -65°
  mat2 oct = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 qa = r1 * p;
  vec2 qb = r2 * p * 1.31 + 17.3;
  for (int i = 0; i < 3; i++) {
    // Rotate the slopes back into map space before summing.
    g += a * (transpose(r1) * noised(qa + vec2(t * 0.35, t * 0.12)).yz);
    g += a * 0.8 * (transpose(r2) * noised(qb - vec2(t * 0.22, -t * 0.28)).yz);
    qa = oct * qa * 2.03 + 3.1;
    qb = oct * qb * 1.97 + 7.7;
    r1 = oct * r1;
    r2 = oct * r2;
    a *= 0.5;
  }
  return g;
}

void main() {
  // Wave units tied to the map, sized for the screen: computed at the current and the next
  // zoom level and cross-faded, so waves keep a similar on-screen size without popping.
  float zf = floor(u_zoom);
  float k = fract(u_zoom);
  vec2 px = v_merc * 512.0;
  vec2 s0 = slope(px * exp2(zf) / 26.0, u_time);
  vec2 s1 = slope(px * exp2(zf + 1.0) / 26.0, u_time * 1.15);
  vec2 g = mix(s0, s1, smoothstep(0.0, 1.0, k));

  vec3 n = normalize(vec3(-g * 0.22, 1.0));
  vec3 sun = normalize(vec3(-0.45, 0.55, 0.7));
  float diff = dot(n, sun) - dot(vec3(0.0, 0.0, 1.0), sun);
  vec3 h = normalize(sun + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 260.0);

  // Gentle relief shading plus small, sharp sun sparkles on the crests.
  float lit = clamp(diff * 2.0, 0.0, 1.0) * 0.28 + spec * 1.3;
  float dark = clamp(-diff * 2.0, 0.0, 1.0) * 0.32;
  // Premultiplied: highlights and shade over the depth colours underneath.
  float aL = clamp(lit * u_strength, 0.0, 0.9);
  float aD = clamp(dark * u_strength, 0.0, 0.6);
  vec3 col = u_light * aL + u_shade * aD * (1.0 - aL);
  float alpha = aL + aD * (1.0 - aL);
  // Fade out on the whole-globe view, where the waves would only read as noise.
  float fade = smoothstep(1.2, 3.0, u_zoom);
  fragColor = vec4(col, alpha) * fade;
}`;

export class WaterLayer implements CustomLayerInterface {
  readonly id = 'water-surface';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  look: WaterLook = { light: [1, 1, 1], shade: [0.1, 0.25, 0.4], strength: 0.5 };
  /** Animation clock in seconds; frozen when the animation is paused. */
  time = 0;
  private map: MlMap | null = null;
  private programs = new Map<string, { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }>();
  private buffer: WebGLBuffer | null = null;
  private index: WebGLBuffer | null = null;
  private count = 0;

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    const verts: number[] = [];
    // Mercator y range of ±85.05°, i.e. the whole square.
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) verts.push(i / GRID, j / GRID);
    const idx: number[] = [];
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i;
        idx.push(a, a + 1, a + GRID + 1, a + 1, a + GRID + 2, a + GRID + 1);
      }
    this.count = idx.length;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.programs.clear();
    gl.deleteBuffer(this.buffer);
    gl.deleteBuffer(this.index);
  }

  private program(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput['shaderData']) {
    const cached = this.programs.get(shaderData.variantName);
    if (cached) return cached;
    const vert = `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 a_pos;
out vec2 v_merc;
void main() {
  gl_Position = projectTile(a_pos);
  v_merc = a_pos;
}`;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Water shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Water shader: ' + gl.getProgramInfoLog(prog));
    const names = [
      'u_projection_matrix',
      'u_projection_fallback_matrix',
      'u_projection_tile_mercator_coords',
      'u_projection_clipping_plane',
      'u_projection_transition',
      'u_time',
      'u_zoom',
      'u_light',
      'u_shade',
      'u_strength',
    ];
    const entry = { prog, loc: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)])) };
    this.programs.set(shaderData.variantName, entry);
    return entry;
  }

  render(gl: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput) {
    if (!this.map || this.look.strength <= 0 || this.map.getZoom() < 1.2) return;
    const g = gl as WebGL2RenderingContext;
    const { prog, loc } = this.program(g, args.shaderData);
    const p = args.defaultProjectionData;
    g.useProgram(prog);
    g.uniformMatrix4fv(loc.u_projection_matrix, false, p.mainMatrix as Float32Array);
    g.uniformMatrix4fv(loc.u_projection_fallback_matrix, false, p.fallbackMatrix as Float32Array);
    g.uniform4f(loc.u_projection_tile_mercator_coords, ...p.tileMercatorCoords);
    g.uniform4f(loc.u_projection_clipping_plane, ...p.clippingPlane);
    g.uniform1f(loc.u_projection_transition, p.projectionTransition);
    g.uniform1f(loc.u_time, this.time);
    g.uniform1f(loc.u_zoom, this.map.getZoom());
    g.uniform3f(loc.u_light, ...this.look.light);
    g.uniform3f(loc.u_shade, ...this.look.shade);
    g.uniform1f(loc.u_strength, this.look.strength);
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, this.index);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.disable(g.DEPTH_TEST);
    g.drawElements(g.TRIANGLES, this.count, g.UNSIGNED_SHORT, 0);
  }
}

/** "#aabbcc" → [r, g, b] in 0–1. */
export const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
