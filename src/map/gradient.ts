// Height colours with a gradient of its own for every country.
//
// MapLibre can colour land by elevation (color-relief) or by country (fill), not both at once.
// So the land is drawn three times, in each country's lowland, hill and peak colour, and after
// each the picture so far is kept in a texture (`CopyLayer`). Then a color-relief layer draws
// the "key": how high each pixel is, as a grey level. `ComposeLayer` keeps that too and paints
// every pixel as a blend of the three pictures, picked by the key.
//
// Everything stays as crisp as MapLibre draws it (vector borders, elevation at any zoom), and
// where the three pictures agree (sea, lakes, anything that is not land) nothing changes.
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';

/** Shared by the layers of one map. */
export class GradientState {
  /** Off: the copy and compose layers do nothing (and the mid, high and key layers are hidden). */
  enabled = false;
  readonly tex: (WebGLTexture | null)[] = [null, null, null, null];
  w = 0;
  h = 0;

  /** Makes the four screen-sized textures (again when the canvas changes size). */
  ensure(gl: WebGL2RenderingContext) {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.tex[0] && w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (let i = 0; i < 4; i++) {
      if (this.tex[i]) gl.deleteTexture(this.tex[i]);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tex[i] = t;
    }
  }

  /** Keeps what is on screen right now in texture `slot`. */
  grab(gl: WebGL2RenderingContext, slot: number) {
    this.ensure(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.w, this.h);
  }

  dispose(gl: WebGL2RenderingContext) {
    for (let i = 0; i < 4; i++) {
      if (this.tex[i]) gl.deleteTexture(this.tex[i]);
      this.tex[i] = null;
    }
  }
}

/** Keeps the picture so far (the land in one of its three colours). */
export class CopyLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  readonly id: string;
  constructor(
    private state: GradientState,
    private slot: number,
  ) {
    this.id = `grad-copy-${slot}`;
  }
  render(gl: WebGL2RenderingContext | WebGLRenderingContext) {
    if (this.state.enabled) this.state.grab(gl as WebGL2RenderingContext, this.slot);
  }
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_low;
uniform sampler2D u_mid;
uniform sampler2D u_high;
uniform sampler2D u_key;
out vec4 fragColor;
void main() {
  vec4 low = texture(u_low, v_uv);
  vec4 mid = texture(u_mid, v_uv);
  vec4 high = texture(u_high, v_uv);
  // Not land (the three pictures agree): leave the pixel as it was.
  vec3 d = abs(low.rgb - mid.rgb) + abs(mid.rgb - high.rgb);
  if (d.r + d.g + d.b < 0.004) {
    fragColor = low;
    return;
  }
  vec4 key = texture(u_key, v_uv);
  // Red: height, 0 = lowest ground, 0.5 = hills, 1 = highest peaks.
  float t = key.r;
  vec3 c = t < 0.5 ? mix(low.rgb, mid.rgb, t * 2.0) : mix(mid.rgb, high.rgb, t * 2.0 - 1.0);
  fragColor = vec4(c, low.a);
}`;

/** Keeps the height key, then paints the blend of the three pictures over the whole screen. */
export class ComposeLayer implements CustomLayerInterface {
  readonly id = 'grad-compose';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private prog: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private buffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  constructor(private state: GradientState) {}

  onAdd(_map: MlMap, gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Gradient shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Gradient shader: ' + gl.getProgramInfoLog(prog));
    this.prog = prog;
    for (const n of ['u_low', 'u_mid', 'u_high', 'u_key']) this.loc[n] = gl.getUniformLocation(prog, n);
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.state.dispose(gl);
  }

  render(glAny: WebGL2RenderingContext | WebGLRenderingContext) {
    const s = this.state;
    if (!s.enabled || !this.prog) return;
    const gl = glAny as WebGL2RenderingContext;
    s.grab(gl, 3);
    gl.useProgram(this.prog);
    ['u_low', 'u_mid', 'u_high', 'u_key'].forEach((n, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, s.tex[i]);
      gl.uniform1i(this.loc[n], i);
    });
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }
}
