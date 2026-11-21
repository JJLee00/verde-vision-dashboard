// The 3D view's WebGL layer: the yard, the leafy shrubs, the trees, the
// cacti, agaves and aloes, the yuccas, the ocotillo and the boulders, drawn
// by the graphics card on a canvas under the one that draws everything else. Each plant is grown once into triangles,
// strokes, flower heads, flecks and ellipses and kept on the card, so
// turning the camera costs a few draw calls a plant, not every leaf again.
//
// It draws what the canvas draws, from the same camera (`P` in
// LivingBlueprint) and the same growers: flat colours as each grower lit
// them, lines as wide as the canvas's in CSS pixels, in the canvas's order.

import { buildPlant, plantKey, type GLPlant } from "./shrubs";
import { buildYard, yardFrame, yardKey, SAND, GRID, type GLYard, type YardShapes, type YardStep } from "./yard";
import { BSTRIDE, ESTRIDE, FSTRIDE, KSTRIDE, LSTRIDE, MeshBuilder, SSTRIDE, VSTRIDE, type Built, type Cam, type Frame, type Op } from "./mesh";
import { CT_FINGERS } from "../bodies/chaste";

export type { GLPlant } from "./shrubs";
export type { GLYard } from "./yard";
export { GL_MODELS } from "./shrubs";

/** The canvas camera, as `updateCam` leaves it: scene feet, CSS pixels. */
export type GLView = {
  eye: number[];
  rt: number[];
  up: number[];
  fw: number[];
  focal: number;
  W: number;
  H: number;
};

export type GLLayer = {
  /** What the browser draws WebGL with: a graphics card, or software. */
  gpu: string;
  resize(W: number, H: number, dpr: number): void;
  /** False when it can't (the context was lost): the canvas draws it all. */
  draw(view: GLView, yard: GLYard, plants: GLPlant[], bodyA: number): boolean;
  dispose(): void;
};

/* ── shaders ── */

// Where the canvas's P puts a point, in CSS pixels: as the projection
// matrix does, but never nearer than a foot in front of the eye.
const SCREEN = `
vec2 scr(vec3 p) {
  vec4 c = uM * vec4(p, 1.0);
  float w = max(c.w, 1.0);
  return vec2((c.x / w * 0.5 + 0.5) * uView.x, (0.5 - c.y / w * 0.5) * uView.y);
}`;

// Filled shapes, and outlines as one-pixel lines. A sprig on the far side
// of its plant is passed over when `uCull` is 1: its normal, dotted with
// the eye, is under its normal dotted with its centre; at 2, a face is
// passed over when it faces away from the camera. With `uLocal`, each
// vertex is placed as the canvas places a cactus's: its centre's own
// projection, plus the local map times its offset from that. `uBias`
// draws it that many feet nearer than it stands. With `uFlat`, it takes
// the depth of its sprig's centre — a face of an agave drawn in the
// canvas's paint order (see `Placed` in mesh.ts).
const FILL_VS = `#version 300 es
uniform mat4 uM;
uniform vec2 uView;
uniform vec3 uEye;
uniform vec3 uFw;
uniform float uCull;
uniform float uGold;
uniform vec4 uLine;
uniform float uLocal;
uniform mat3x2 uLJ;
uniform float uBias;
uniform float uFlat;
layout(location = 0) in vec3 aP;
layout(location = 1) in vec4 aC;
layout(location = 2) in vec4 aG;
layout(location = 3) in vec4 aN;
layout(location = 4) in float aD;
layout(location = 5) in vec3 aAt;
layout(location = 6) in vec3 aK;
out vec4 vC;
${SCREEN}
void main() {
  if (uCull > 1.5 ? dot(aN.xyz, -uFw) - aD <= 0.0 : uCull > 0.5 && dot(aN.xyz, uEye) - aD < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vC = vec4(0.0);
    return;
  }
  vec4 c = uM * vec4(aP, 1.0);
  // Its depth as the rasterizer would have it: taken straight, so a face
  // in paint order lies at one depth to the bit, and what's drawn on it
  // clears it by its offset alone.
  float zn = c.z / c.w;
  bool moved = uBias != 0.0 || uFlat > 0.5;
  if (moved) {
    vec4 z = uM * vec4((uFlat > 0.5 ? aK : aP) - uFw * uBias, 1.0);
    zn = z.z / z.w;
  }
  if (uLocal > 0.5) {
    vec2 s = scr(aAt) + uLJ * (aP - aAt);
    c = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, c.w > 0.5 ? zn : 2.0, 1.0);
  } else if (moved) {
    c.z = zn * c.w;
  }
  gl_Position = c;
  vC = uLine.a > 0.0 ? uLine : (uGold > 0.5 ? aG : aC);
}`;

const FILL_FS = `#version 300 es
precision mediump float;
uniform float uA;
in vec4 vC;
out vec4 o;
void main() {
  float a = vC.a * uA;
  o = vec4(vC.rgb * a, a);
}`;

// A stroke: a quad round the segment on screen, its coverage worked out
// per pixel — so a line under a pixel wide is lighter rather than missing,
// and a round cap is round. Widths are the canvas's: the most of feet at
// the plant, line widths, and a floor in pixels. Mode 1 is a bottlebrush
// stamen, standing across its brush's axis as that lies on screen; mode 2
// a mark across a point on screen (a removal's slash); mode 3 a thorn,
// its width at its foot a quarter of its length back from its start,
// tapering to a point at its end; mode 4 a speck, a square as wide as the
// stroke, its way along it on screen (an organ pipe's spines). With uBias, its depth is taken that many
// feet nearer than it stands, as a flower's is — and uWBias more half its
// widths, so a stripe down a cactus's crest clears the faces beside it as
// they turn toward the eye. With uFlat, both ends take the depth of the
// nearer of its planes' points that faces the eye (see `Placed` in
// mesh.ts), uBias nearer. With uLocal, its ends are
// placed through the local map, as the fill shader places a vertex — with
// uAtK, the map at its own `pa`, whose longest column is then its
// feet-to-pixels, and it shows only while that's in its window (iX); uCull
// passes it over by its two planes (see `Op` strokes). Mode 5 is a piece of
// a curve, a quarter (iS.y) of the canvas's quadratic from end to end
// bowed by iS.x (a yucca's straw); mode 6 a piece of a ribbon down an
// axis (see below); mode 7 a ray from its start, the way the local map
// takes it to its end, as long as iS.x feet or iS.y pixels (an ocotillo's
// flame). With uSolid it's inked whole or not at all, to be written in
// depth, its edges left to the card's multisampling. uPass 1 draws only
// where it covers a pixel whole, 2 only where it doesn't (see `strokes`
// below).
const STROKE_VS = `#version 300 es
precision highp float;
uniform mat4 uM;
uniform vec2 uView;
uniform float uDpr;
uniform float uFoot;
uniform float uLw;
uniform vec2 uStamen;
uniform float uGold;
uniform vec3 uFw;
uniform vec3 uEye;
uniform float uBias;
uniform float uWBias;
uniform float uLocal;
uniform mat3x2 uLJ;
uniform float uCull;
uniform float uFlat;
uniform float uSolid;
uniform float uAtK;
layout(location = 0) in vec3 iA;
layout(location = 1) in vec3 iB;
layout(location = 2) in vec4 iW;
layout(location = 3) in vec4 iC;
layout(location = 4) in vec4 iG;
layout(location = 5) in vec4 iS;
layout(location = 6) in vec2 aQ;
layout(location = 7) in vec3 iCA;
layout(location = 8) in vec3 iCB;
layout(location = 9) in vec4 iNA;
layout(location = 10) in vec4 iNB;
layout(location = 11) in vec2 iND;
layout(location = 12) in vec3 iKA;
layout(location = 13) in vec3 iKB;
layout(location = 14) in vec4 iX;
out vec4 vC;
out vec2 vL;
flat out vec3 vG;
flat out vec3 vD;
${SCREEN}
const float NEAR = 1.0;
vec3 px(vec4 c) {
  vec3 n = c.xyz / c.w;
  return vec3((n.x * 0.5 + 0.5) * uView.x, (0.5 - n.y * 0.5) * uView.y, n.z);
}
// Depth at a point, uBias nearer.
float kz(vec3 k) {
  vec4 z = uM * vec4(k - uFw * uBias, 1.0);
  return clamp(z.z / max(z.w, NEAR), -1.0, 1.0);
}
void main() {
  float ea = dot(iNA.xyz, uEye) - iND.x;
  float eb = dot(iNB.xyz, uEye) - iND.y;
  bool off = false;
  if (uCull > 3.5) off = ea <= 0.0 || eb <= 0.0;
  else if (uCull > 2.5) off = (ea > 0.0) == (eb > 0.0);
  else if (uCull > 1.5) off = dot(iNA.xyz, -uFw) - iND.x <= 0.0 || dot(iNB.xyz, -uFw) - iND.y <= 0.0;
  else if (uCull > 0.5) off = ea <= 0.0 && eb <= 0.0;
  mat3x2 J = uLJ;
  float foot = uFoot;
  if (uAtK > 0.5) {
    vec2 q = scr(iKA);
    J = mat3x2(scr(iKA + vec3(1.0, 0.0, 0.0)) - q, scr(iKA + vec3(0.0, 1.0, 0.0)) - q, scr(iKA + vec3(0.0, 0.0, 1.0)) - q);
    foot = max(max(length(J[0]), length(J[1])), length(J[2]));
  }
  off = off || foot < iX.x || foot >= iX.y;
  vec4 ca = uM * vec4(iA, 1.0);
  vec4 cb = uM * vec4(iB, 1.0);
  if (off || (ca.w < NEAR && cb.w < NEAR)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // In paint order: the nearer of its planes' points that faces the eye.
  vec3 k = (ea >= 0.0) == (eb >= 0.0) ? (dot(iKA - iKB, uFw) < 0.0 ? iKA : iKB) : (ea >= 0.0 ? iKA : iKB);
  vC = uGold > 0.5 ? iG : iC;
  vD = vec3(0.0);
  if (iW.w > 5.5 && iW.w < 6.5) {
    // A piece of a ribbon down an axis (an ocotillo's cane), A to B, each
    // projected: across each as the axis runs there (from the points either
    // side of it: CA and B, A and CB), half as wide as iW.x feet at A and
    // iW.y at B, iW.z pixels at least. With iS, its middle that many feet
    // off the axis (x at A, y at B), to the side the axis climbs the
    // screen toward — the canvas's lit side of a cane.
    vec4 cc = uM * vec4(iCA, 1.0);
    vec4 cd = uM * vec4(iCB, 1.0);
    if (min(min(ca.w, cb.w), min(cc.w, cd.w)) < NEAR) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 A = px(ca);
    vec3 B = px(cb);
    vec2 dA = B.xy - px(cc).xy;
    vec2 dB = px(cd).xy - A.xy;
    float lA = length(dA) > 0.0 ? length(dA) : 1.0;
    float lB = length(dB) > 0.0 ? length(dB) : 1.0;
    vec2 nA = vec2(-dA.y, dA.x) / lA;
    vec2 nB = vec2(-dB.y, dB.x) / lB;
    float oA = -iS.x * foot * (dA.y > 0.0 ? 1.0 : -1.0);
    float oB = -iS.y * foot * (dB.y > 0.0 ? 1.0 : -1.0);
    bool atB = aQ.x > 0.5;
    vec2 p = atB ? B.xy + nB * (oB + aQ.y * max(iW.z, iW.y * foot)) : A.xy + nA * (oA + aQ.y * max(iW.z, iW.x * foot));
    float z = uFlat > 0.5 ? kz(k) : atB ? B.z : A.z;
    gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, z, 1.0);
    vL = vec2(0.0);
    vG = vec3(0.0, 0.0, 4.0);
    return;
  }
  vec3 a;
  vec3 b;
  if (uLocal > 0.5) {
    a = vec3(scr(iCA) + J * (iA - iCA), ca.z / max(ca.w, NEAR));
    b = vec3(scr(iCB) + J * (iB - iCB), cb.z / max(cb.w, NEAR));
  } else {
    if (ca.w < NEAR) ca = mix(ca, cb, (NEAR - ca.w) / (cb.w - ca.w));
    else if (cb.w < NEAR) cb = mix(cb, ca, (NEAR - cb.w) / (ca.w - cb.w));
    a = px(ca);
    b = px(cb);
  }
  // Line widths under 0: the rest, and that many line widths more.
  float w = iW.y < 0.0 ? max(iW.x * foot, iW.z) - iW.y * uLw : max(max(iW.x * foot, iW.y * uLw), iW.z);
  float bias = uBias + uWBias * 0.5 * w / max(foot, 1e-6);
  if (uFlat > 0.5) {
    a.z = kz(k);
    b.z = a.z;
  } else if (bias > 0.0) {
    vec4 za = uM * vec4(iA - uFw * bias, 1.0);
    vec4 zb = uM * vec4(iB - uFw * bias, 1.0);
    a.z = clamp(za.z / max(za.w, NEAR), -1.0, 1.0);
    b.z = clamp(zb.z / max(zb.w, NEAR), -1.0, 1.0);
  }
  float round = iS.x;
  vec3 dash = vec3(0.0);
  if (iW.w > 6.5) {
    vec2 d = J * (iB - iA);
    float l = length(d);
    b = vec3(a.xy + (l > 0.0 ? d / l : vec2(0.0)) * max(iS.y, iS.x * foot), a.z);
    round = 1.0;
  } else if (iW.w > 4.5) {
    vec2 c = (a.xy + b.xy) * 0.5 + vec2(a.y - b.y, b.x - a.x) * iS.x;
    float t0 = iS.y * 0.25;
    float t1 = t0 + 0.25;
    vec2 q0 = mix(mix(a.xy, c, t0), mix(c, b.xy, t0), t0);
    vec2 q1 = mix(mix(a.xy, c, t1), mix(c, b.xy, t1), t1);
    a.xy = q0;
    b.xy = q1;
    round = 1.0;
  } else if (iW.w > 3.5) {
    vec3 s = mix(a, b, iS.x);
    a = s;
    b = s;
    round = 3.0;
  } else if (iW.w > 2.5) {
    round = 2.0;
  } else if (iW.w > 1.5) {
    vec3 s = a;
    a = vec3(s.xy + iS.xy, s.z);
    b = vec3(s.xy + iS.zw, s.z);
    round = 0.0;
  } else if (iW.w > 0.5) {
    vec2 d = b.xy - a.xy;
    float l = length(d);
    vec2 u = l > 1e-6 ? d / l : vec2(1.0, 0.0);
    vec3 s = mix(a, b, iS.x);
    float len = max(uStamen.x * foot, uStamen.y);
    a = s;
    b = vec3(s.xy + (vec2(-u.y, u.x) * iS.z + u * iS.y) * len, s.z);
    round = 1.0;
  } else {
    dash = iS.yzw;
  }
  vec2 pa = a.xy * uDpr;
  vec2 pb = b.xy * uDpr;
  vec2 d = pb - pa;
  float L = length(d);
  vec2 u = L > 1e-6 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  float hw = 0.5 * w * uDpr;
  bool thorn = round > 1.5 && round < 2.5;
  bool solid = uSolid > 0.5;
  float ext = solid ? 0.0 : (round > 0.5 && !thorn ? hw : 0.0) + 1.0;
  float along = aQ.x > 0.5 ? L + ext : (thorn ? -0.25 * L - 1.0 : -ext);
  float across = aQ.y * (hw + (solid ? 0.0 : 1.0));
  vec2 p = pa + u * along + n * across;
  // One depth all along, in paint order, to the bit.
  float z = uFlat > 0.5 ? a.z : mix(a.z, b.z, clamp(along / max(L, 1e-6), 0.0, 1.0));
  gl_Position = vec4(p.x / (uView.x * uDpr) * 2.0 - 1.0, 1.0 - p.y / (uView.y * uDpr) * 2.0, z, 1.0);
  vL = vec2(along, across);
  vG = vec3(L, hw, solid ? 4.0 : round);
  vD = dash * uDpr;
}`;

const STROKE_FS = `#version 300 es
precision highp float;
uniform float uA;
uniform float uPass;
in vec4 vC;
in vec2 vL;
flat in vec3 vG;
flat in vec3 vD;
out vec4 o;
float span(float lo, float hi, float a, float b) {
  return clamp(min(hi, b) - max(lo, a), 0.0, 1.0);
}
void main() {
  float L = vG.x;
  float hw = vG.y;
  float c;
  if (vG.z > 3.5) {
    c = 1.0;
  } else if (vG.z > 2.5) {
    c = span(vL.y - 0.5, vL.y + 0.5, -hw, hw) * span(vL.x - 0.5, vL.x + 0.5, -hw, L + hw);
  } else if (vG.z > 1.5) {
    // A thorn: inside its two long edges and past its foot.
    float t0 = -0.25 * L;
    float k = hw / max(L - t0, 1e-6);
    float de = (k * (L - vL.x) - abs(vL.y)) / sqrt(1.0 + k * k);
    c = clamp(de + 0.5, 0.0, 1.0) * clamp(vL.x - t0 + 0.5, 0.0, 1.0);
  } else if (vG.z > 0.5) {
    float d = length(vec2(vL.x - clamp(vL.x, 0.0, L), vL.y));
    c = span(d - 0.5, d + 0.5, -hw, hw);
  } else {
    c = span(vL.y - 0.5, vL.y + 0.5, -hw, hw) * span(vL.x - 0.5, vL.x + 0.5, 0.0, L);
  }
  if (vD.x > 0.0) {
    float P = vD.x + vD.y;
    float m = mod(vL.x + vD.z, P);
    c *= span(m - 0.5, m + 0.5, 0.0, vD.x) + span(m - 0.5, m + 0.5, P, P + vD.x);
  }
  if (c <= 0.0 || (uPass > 1.5 ? c > 0.999 : uPass > 0.5 && c <= 0.999)) discard;
  float a = vC.a * uA * c;
  o = vec4(vC.rgb * a, a);
}`;

// A flower head: a square on screen round it, the head drawn in it as the
// canvas draws one — the same circles at the same sizes, by how many
// pixels the head is across. uPass 1 draws only where it's solid, 2 only
// its soft edge (see the flowers' draw).
const FLOWER_VS = `#version 300 es
precision highp float;
uniform mat4 uM;
uniform vec2 uView;
uniform vec3 uEye;
uniform vec3 uFw;
uniform mat2 uJ;
uniform float uFJ;
uniform int uStyle;
uniform float uBias;
layout(location = 0) in vec3 iP;
layout(location = 1) in vec4 iN;
layout(location = 2) in vec2 iR;
layout(location = 3) in vec4 iT;
layout(location = 4) in vec4 iJ0;
layout(location = 5) in vec4 iJ1;
layout(location = 6) in vec2 aQ;
out vec2 vP;
flat out vec4 vF;
flat out vec4 vF2;
flat out vec4 vJ0;
flat out vec4 vJ1;
void main() {
  vec4 c = uM * vec4(iP, 1.0);
  if ((iN.w > 0.5 && dot(iN.xyz, uEye - iP) < 0.0) || c.w < 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 s = vec2((c.x / c.w * 0.5 + 0.5) * uView.x, (0.5 - c.y / c.w * 0.5) * uView.y);
  vec4 cz = uM * vec4(iP - uFw * uBias, 1.0);
  float R;
  if (uStyle == 0) {
    float r = max(iR.x, 1.5 / uFJ);
    vec2 A = uJ[0] * r;
    vec2 B = uJ[1] * r;
    float px = uFJ * r;
    vF = vec4(A, B);
    vF2 = vec4(px, iR.y, 0.0, 0.0);
    R = length(A) + length(B) + 0.4 * px + 2.0;
  } else {
    float pr = max(uStyle == 1 ? 1.3 : 1.4, iR.x * uFJ);
    vF = vec4(pr, iT.x, iR.y, 0.0);
    vF2 = vec4(0.0);
    R = pr * 1.15 + 2.0;
  }
  vJ0 = iJ0 * 2.0 - 1.0;
  vJ1 = iJ1 * 2.0 - 1.0;
  vec2 q = vec2(aQ.x * 2.0 - 1.0, aQ.y);
  vP = q * R;
  vec2 p = s + vP;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, clamp(cz.z / cz.w, -1.0, 1.0), 1.0);
}`;

const FLOWER_FS = `#version 300 es
precision highp float;
uniform vec4 uPal[17];
// highp as the vertex shader's ints are, or the two won't link.
uniform highp int uStyle;
uniform float uDpr;
uniform float uA;
uniform float uPass;
in vec2 vP;
flat in vec4 vF;
flat in vec4 vF2;
flat in vec4 vJ0;
flat in vec4 vJ1;
out vec4 o;
const float TAU = 6.283185307;
vec4 acc = vec4(0.0);
void lay(vec4 col, float cov) {
  float a = col.a * cov;
  acc = vec4(col.rgb * a, a) + acc * (1.0 - a);
}
float disc(vec2 c, float r) {
  float d = length(vP - c) * uDpr;
  float rr = r * uDpr;
  return clamp(min(d + 0.5, rr) - max(d - 0.5, -rr), 0.0, 1.0);
}
float jit(int k) {
  return k < 4 ? vJ0[k] : vJ1[k - 4];
}
void main() {
  if (uStyle == 0) {
    vec2 A = vF.xy;
    vec2 B = vF.zw;
    float px = vF2.x;
    float fx = vF2.y;
    mat2 M = mat2(A, B);
    if (abs(determinant(M)) > 1e-6) {
      float f = length(inverse(M) * vP);
      lay(uPal[0], clamp((1.0 - f) / max(fwidth(f), 1e-6) + 0.5, 0.0, 1.0));
    }
    if (px > 5.0) {
      float cv = 0.0;
      for (int k = 0; k < 6; k++) {
        float t = float(k) / 6.0 * TAU + fx;
        cv = max(cv, disc((A * cos(t) + B * sin(t)) * 0.55, px * 0.36));
      }
      lay(uPal[8], cv);
    }
    if (px > 2.5) lay(uPal[16], disc(vec2(0.0), max(0.8, px * 0.22)));
  } else if (uStyle == 1) {
    float pr = vF.x;
    int t = int(vF.y + 0.5);
    float spin = vF.z;
    lay(pr < 2.0 ? uPal[4 + t] : uPal[t], disc(vec2(0.0), pr));
    if (pr > 7.0) {
      float cv = 0.0;
      float ce = 0.0;
      for (int k = 0; k < 7; k++) {
        float a = float(k) / 6.0 * TAU + spin;
        vec2 c = k < 6 ? vec2(cos(a) * pr * 0.52, sin(a) * pr * 0.46) : vec2(0.0);
        cv = max(cv, disc(c, pr * 0.32));
        ce = max(ce, disc(c, pr * 0.06));
      }
      lay(uPal[8 + t], cv);
      lay(uPal[16], ce);
    } else if (pr > 1.6) {
      lay(uPal[4 + t], disc(vec2(-0.22, -0.25) * pr, pr * 0.55));
    }
  } else {
    float pr = vF.x;
    int t = int(vF.y + 0.5);
    float spin = vF.z;
    vec2 c0 = pr > 7.0 ? vec2(0.0) : pr > 3.0 ? vec2(0.1, 0.12) * pr : vec2(0.0);
    float r0 = pr > 7.0 ? pr * 0.74 : pr > 3.0 ? pr * 0.8 : pr;
    lay(pr <= 3.0 ? uPal[4 + t] : uPal[t], disc(c0, r0));
    if (pr > 7.0) {
      float cu = 0.0;
      float cl = 0.0;
      float ce = 0.0;
      for (int k = 0; k < 7; k++) {
        float a = float(k) / 7.0 * TAU + spin;
        float j = jit(k);
        float rr = pr * (0.55 + 0.12 * j);
        vec2 c = vec2(cos(a) * rr, sin(a) * rr * 0.9);
        float d = disc(c, pr * (0.27 + 0.07 * abs(j)));
        if (c.x + c.y * 1.2 < 0.0) cl = max(cl, d);
        else cu = max(cu, d);
        ce = max(ce, disc(c, pr * 0.05));
      }
      lay(uPal[8 + t], cu);
      lay(uPal[4 + t], cl);
      float cb = 0.0;
      for (int k = 0; k < 3; k++) {
        float a = float(k) / 3.0 * TAU + spin + 0.5;
        cb = max(cb, disc(vec2(cos(a) * pr * 0.16, sin(a) * pr * 0.14), pr * 0.2));
      }
      lay(uPal[12 + t], cb);
      lay(uPal[16], ce);
    } else if (pr > 3.0) {
      float cv = 0.0;
      for (int k = 0; k < 4; k++) {
        float a = float(k) / 4.0 * TAU + spin;
        float fr = pr * (k > 0 ? 0.48 : 0.4);
        cv = max(cv, disc(vec2(-0.05 * pr + cos(a) * pr * 0.42, -0.06 * pr + sin(a) * pr * 0.38), fr));
      }
      lay(uPal[4 + t], cv);
    }
  }
  if (acc.a < 0.002 || (uPass > 1.5 ? acc.a > 0.99 : uPass > 0.5 && acc.a <= 0.99)) discard;
  o = acc * uA;
}`;

// A tree's lobe of foliage: the ellipse its ellipsoid makes through the
// camera's local map at its centre, worked out as the canvas works it out,
// and filled as a fan of triangles from the middle — nine round an
// ebony's puff, each corner pushed in or out by its own amount.
const LOBE_VS = `#version 300 es
precision highp float;
uniform mat4 uM;
uniform vec2 uView;
uniform float uGold;
uniform float uSeg;
uniform float uRagged;
layout(location = 0) in vec3 iC;
layout(location = 1) in vec2 iR;
layout(location = 2) in vec4 iCol;
layout(location = 3) in vec4 iGold;
layout(location = 4) in vec4 iJ0;
layout(location = 5) in vec4 iJ1;
layout(location = 6) in vec4 iJ2;
out vec4 vC;
const float TAU = 6.283185307;
${SCREEN}
float jit(int k) {
  vec4 j = k < 4 ? iJ0 : k < 8 ? iJ1 : iJ2;
  return 0.78 + 0.32 * j[k % 4];
}
void main() {
  vec4 cc = uM * vec4(iC, 1.0);
  if (cc.w < 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vC = vec4(0.0);
    return;
  }
  vec2 q = scr(iC);
  vec2 jx = scr(iC + vec3(1.0, 0.0, 0.0)) - q;
  vec2 jy = scr(iC + vec3(0.0, 1.0, 0.0)) - q;
  vec2 jz = scr(iC + vec3(0.0, 0.0, 1.0)) - q;
  vec3 ax = vec3(jx.x * iR.x, jy.x * iR.y, jz.x * iR.x);
  vec3 ay = vec3(jx.y * iR.x, jy.y * iR.y, jz.y * iR.x);
  float c11 = dot(ax, ax);
  float c22 = dot(ay, ay);
  float c12 = dot(ax, ay);
  float mid = (c11 + c22) * 0.5;
  float d = sqrt(max(0.0, mid * mid - (c11 * c22 - c12 * c12)));
  float ea = sqrt(mid + d);
  float eb = sqrt(max(0.0, mid - d));
  // A circle has no long axis to turn to (and atan of nothing is nothing).
  float ang = abs(c12) + abs(c11 - c22) > 0.0 ? 0.5 * atan(2.0 * c12, c11 - c22) : 0.0;
  int k = gl_VertexID % 3;
  vec2 p = q;
  if (k > 0) {
    int r = (gl_VertexID / 3 + k - 1) % int(uSeg);
    float t = float(r) / uSeg * TAU;
    vec2 e = vec2(cos(t) * ea, sin(t) * eb) * (uRagged > 0.5 ? jit(r) : 1.0);
    p += vec2(e.x * cos(ang) - e.y * sin(ang), e.x * sin(ang) + e.y * cos(ang));
  }
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, clamp(cc.z / cc.w, -1.0, 1.0), 1.0);
  vC = uGold > 0.5 ? iGold : iCol;
}`;

// An ellipse — a cactus's knob, or an agave's heart — placed as the canvas
// places one: its centre's projection, shifted through the local map, and
// the ellipse its ellipsoid's three half-axes make through that map (mode
// 1, the americana's upright heart; mode 2, a yucca's round heart). Written in depth at its centre, a
// little farther or nearer, so a knob's shadow, the knob and its shoulder
// stack as the canvas paints them and nearer knobs go over farther.
const ELLIPSE_VS = `#version 300 es
precision highp float;
uniform mat4 uM;
uniform vec2 uView;
uniform vec3 uEye;
uniform vec3 uFw;
uniform mat3x2 uLJ;
uniform float uMode;
uniform float uGold;
uniform float uSeg;
layout(location = 0) in vec3 iC;
layout(location = 1) in vec3 iS;
layout(location = 2) in vec3 iA1;
layout(location = 3) in vec3 iA2;
layout(location = 4) in vec3 iA3;
layout(location = 5) in vec4 iCol;
layout(location = 6) in vec4 iGold;
layout(location = 7) in vec4 iN;
layout(location = 8) in vec2 iT;
out vec4 vC;
const float TAU = 6.283185307;
${SCREEN}
void main() {
  vec4 cc = uM * vec4(iC, 1.0);
  vec3 v = uEye - iC;
  if (cc.w < 1.0 || (iN.w > 0.5 && dot(iN.xyz, v) < iT.x * length(v))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vC = vec4(0.0);
    return;
  }
  vec2 q = scr(iC) + uLJ * iS;
  float ea;
  float eb;
  float ang = 0.0;
  if (uMode > 1.5) {
    ea = max(1.0, iA1.x * max(max(length(uLJ[0]), length(uLJ[1])), length(uLJ[2])));
    eb = ea;
  } else if (uMode > 0.5) {
    ea = length(vec2(uLJ[0].x, uLJ[2].x)) * iA1.x;
    eb = length(vec2(uLJ[1].y * 0.8, uLJ[2].y)) * iA1.x;
  } else {
    vec2 p1 = uLJ * iA1;
    vec2 p2 = uLJ * iA2;
    vec2 p3 = uLJ * iA3;
    vec3 ax = vec3(p1.x, p2.x, p3.x);
    vec3 ay = vec3(p1.y, p2.y, p3.y);
    float c11 = dot(ax, ax);
    float c22 = dot(ay, ay);
    float c12 = dot(ax, ay);
    float mid = (c11 + c22) * 0.5;
    float d = sqrt(max(0.0, mid * mid - (c11 * c22 - c12 * c12)));
    ea = sqrt(mid + d);
    eb = sqrt(max(0.0, mid - d));
    ang = abs(c12) + abs(c11 - c22) > 0.0 ? 0.5 * atan(2.0 * c12, c11 - c22) : 0.0;
  }
  int k = gl_VertexID % 3;
  vec2 p = q;
  if (k > 0) {
    int r = (gl_VertexID / 3 + k - 1) % int(uSeg);
    float t = float(r) / uSeg * TAU;
    vec2 e = vec2(cos(t) * ea, sin(t) * eb);
    p += vec2(e.x * cos(ang) - e.y * sin(ang), e.x * sin(ang) + e.y * cos(ang));
  }
  vec4 cz = uM * vec4(iC + uFw * iT.y, 1.0);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, clamp(cz.z / max(cz.w, 1.0), -1.0, 1.0), 1.0);
  vC = uGold > 0.5 ? iGold : iCol;
}`;

// A yucca's blade. Which pass it goes in turns with the camera, so it's
// worked out here, as the canvas works it out: the far side of the ball,
// or how far toward the camera its tip comes in quarters of a blade, then
// its tone. A pass draws those of its own (uPick, see `Op` blades): close
// up as kites, long and pointed, widest a third of the way out — the whole
// blade, or its half toward the sun or away from it; far off as strokes;
// and close up each one's shaded edge. Placed as the canvas places them,
// through the local map at the ball.
const BLADE_VS = `#version 300 es
precision highp float;
uniform mat4 uM;
uniform vec2 uView;
uniform float uDpr;
uniform vec3 uFw;
uniform mat3x2 uLJ;
uniform vec3 uAt;
uniform vec2 uSun;
uniform vec4 uPick;
uniform float uMode;
uniform float uFoot;
uniform vec2 uBlade;
uniform vec4 uCol;
uniform vec4 uGoldCol;
uniform float uGold;
layout(location = 0) in vec3 iB;
layout(location = 1) in vec3 iT;
layout(location = 2) in float iTone;
out vec4 vC;
out vec2 vL;
flat out vec3 vG;
flat out vec3 vD;
${SCREEN}
const int FAN[9] = int[](0, 1, 2, 0, 2, 3, 0, 3, 4);
const int QUAD[9] = int[](0, 1, 2, 0, 2, 3, 0, 0, 0);
const vec2 CORNER[9] = vec2[](vec2(0.0, -1.0), vec2(0.0, 1.0), vec2(1.0, -1.0), vec2(0.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(0.0, -1.0), vec2(0.0, -1.0), vec2(0.0, -1.0));
void main() {
  float d = -dot(uFw, iT) / uBlade.x;
  float band = d < 0.0 ? 0.0 : 1.0 + min(3.0, floor(d * 4.4));
  float key = band * 5.0 + iTone;
  float side = 0.0;
  bool on = true;
  if (uMode > 1.5) on = abs(band - uPick.x) < 0.5;
  else if (abs(key - uPick.x) < 0.5) side = uPick.y;
  else if (uPick.z >= 0.0 && abs(key - uPick.z) < 0.5) side = uPick.w;
  else on = false;
  vec4 cc = uM * vec4(uAt, 1.0);
  if (!on || cc.w < 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 q = scr(uAt);
  vec2 b = q + uLJ * iB;
  vec2 t = q + uLJ * iT;
  float wPx = uBlade.y * uFoot;
  float z = clamp(cc.z / cc.w, -1.0, 1.0);
  vec2 u = t - b;
  float ul = length(u) > 0.0 ? length(u) : 1.0;
  float hk = wPx * 0.36 * sqrt(min(1.0, ul / (uBlade.x * uFoot)));
  vec2 n = vec2(-u.y, u.x) / ul * hk;
  int k = gl_VertexID % 9;
  vC = uGold > 0.5 ? uGoldCol : uCol;
  vD = vec3(0.0);
  if (uMode > 0.5 && uMode < 1.5) {
    if (dot(n, uSun) < 0.0) n = -n;
    vec2 m = b + u * 0.35;
    vec2 p;
    if (side == 0.0) {
      vec2 P5[5] = vec2[](b + n * 0.4, m + n, t, m - n, b - n * 0.4);
      p = P5[FAN[k]];
    } else {
      vec2 P4[4] = vec2[](b, b + n * 0.4 * side, m + n * side, t);
      p = P4[QUAD[k]];
    }
    gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, z, 1.0);
    vL = vec2(0.0);
    vG = vec3(0.0, 0.0, 4.0);
    return;
  }
  // A stroke, butt-ended: the whole blade, or from its widest point on its
  // shaded side to its tip.
  vec2 a = b;
  float w = max(0.6, wPx * 0.5);
  if (uMode > 1.5) {
    if (dot(n, uSun) > 0.0) n = -n;
    a = b + u * 0.35 + n;
    w = max(0.6, wPx * 0.1);
  }
  vec2 pa = a * uDpr;
  vec2 dd = t * uDpr - pa;
  float L = length(dd);
  vec2 uu = L > 1e-6 ? dd / L : vec2(1.0, 0.0);
  float hw = 0.5 * w * uDpr;
  vec2 cq = CORNER[k];
  float along = cq.x > 0.5 ? L + 1.0 : -1.0;
  float across = cq.y * (hw + 1.0);
  vec2 p = pa + uu * along + vec2(-uu.y, uu.x) * across;
  gl_Position = vec4(p.x / (uView.x * uDpr) * 2.0 - 1.0, 1.0 - p.y / (uView.y * uDpr) * 2.0, z, 1.0);
  vL = vec2(along, across);
  vG = vec3(L, hw, 0.0);
}`;

// A fleck of leaf — a dash slanted on screen, a chaste leaf's hand of five
// fingers, or a flower spike — placed as the canvas places them, by its
// lobe's local map rather than projected itself. Its size in CSS pixels is
// the draw's; it's passed over on the far side of the tree (the ebony's)
// or of its lobe (the chaste's), as the canvas passes over it.
const FLECK_VS = `#version 300 es
precision highp float;
uniform mat4 uM;
uniform vec2 uView;
uniform vec3 uEye;
uniform float uGold;
uniform float uShape;
uniform float uS;
uniform float uWd;
uniform float uCull;
uniform vec3 uCentre;
uniform float uSlack;
uniform vec2 uFinger[5];
layout(location = 0) in vec3 iC;
layout(location = 1) in vec3 iO;
layout(location = 2) in float iA;
layout(location = 3) in vec4 iCol;
layout(location = 4) in vec4 iGold;
layout(location = 5) in vec3 iD;
layout(location = 6) in vec3 iN;
out vec4 vC;
${SCREEN}
const int CORNER[6] = int[](0, 1, 2, 0, 2, 3);
void main() {
  vec3 w = iC + iO;
  vec4 cc = uM * vec4(iC, 1.0);
  bool off = cc.w < 1.0;
  if (uCull > 1.5) {
    vec3 e = uEye - w;
    off = off || dot(iN, e) < -uSlack * length(e);
  } else if (uCull > 0.5) {
    off = off || dot(w - uCentre, uEye - w) < 0.0;
  }
  if (off) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vC = vec4(0.0);
    return;
  }
  vec2 q = scr(iC);
  mat3x2 J = mat3x2(scr(iC + vec3(1.0, 0.0, 0.0)) - q, scr(iC + vec3(0.0, 1.0, 0.0)) - q, scr(iC + vec3(0.0, 0.0, 1.0)) - q);
  vec2 p = q + J * iO;
  int k = CORNER[gl_VertexID % 6];
  vec2 at;
  if (uShape > 1.5) {
    // Thickest a quarter of the way up, tapering to its tip.
    vec2 d = J * iD;
    float l = length(d);
    if (l == 0.0) l = 1.0;
    vec2 s = vec2(-d.y, d.x) * (max(l * 0.09, 0.6) / l);
    at = k == 0 ? -0.1 * d : k == 1 ? 0.25 * d + s : k == 2 ? d : 0.25 * d - s;
  } else if (uShape > 0.5) {
    vec2 f = uFinger[gl_VertexID / 6];
    float a = iA + f.x;
    vec2 d = vec2(cos(a), sin(a)) * uS * f.y;
    vec2 s = vec2(-d.y, d.x) * 0.12;
    at = k == 0 ? vec2(0.0) : k == 1 ? 0.45 * d + s : k == 2 ? d : 0.45 * d - s;
  } else {
    vec2 u = vec2(cos(iA), sin(iA)) * uS;
    vec2 s = vec2(-u.y, u.x) * uWd;
    at = k == 0 ? u : k == 1 ? s : k == 2 ? -u : -s;
  }
  p += at;
  vec4 cw = uM * vec4(w, 1.0);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, clamp(cw.z / max(cw.w, 1.0), -1.0, 1.0), 1.0);
  vC = uGold > 0.5 ? iGold : iCol;
}`;

// Paving's hatch and dots, laid on screen as the canvas lays them: from
// the corner of the shape's box on screen, in CSS pixels.
const PATTERN_VS = `#version 300 es
uniform mat4 uM;
layout(location = 0) in vec3 aP;
void main() {
  gl_Position = uM * vec4(aP, 1.0);
}`;

const PATTERN_FS = `#version 300 es
precision highp float;
uniform vec4 uBox;
uniform float uDots;
uniform float uDpr;
uniform float uH;
uniform vec4 uCol;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uH - gl_FragCoord.y / uDpr);
  float s = uBox.w;
  float c;
  if (uDots > 0.5) {
    float i = floor((p.x - uBox.x) / s + 0.5);
    float q = uBox.x / s + i;
    float off = (q - 2.0 * trunc(q / 2.0)) * (s / 2.0);
    float j = floor((p.y - uBox.y - off) / s + 0.5);
    float d = length(p - vec2(uBox.x + i * s, uBox.y + off + j * s)) * uDpr;
    float r = 1.1 * uDpr;
    c = i < 0.0 || j < 0.0 ? 0.0 : clamp(min(d + 0.5, r) - max(d - 0.5, -r), 0.0, 1.0);
  } else {
    float u = p.x - p.y + uBox.y - uBox.x + uBox.z;
    float k = u - floor(u / s + 0.5) * s;
    float d = abs(k) * 0.70710678 * uDpr;
    float hw = 0.5 * uDpr;
    c = clamp(min(d + 0.5, hw) - max(d - 0.5, -hw), 0.0, 1.0);
  }
  float a = uCol.a * c;
  if (a <= 0.0) discard;
  o = vec4(uCol.rgb * a, a);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;

export function createGLLayer(cv: HTMLCanvasElement): GLLayer | null {
  const gl = cv.getContext("webgl2", {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const program = (vs: string, fs: string, names: string[]) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    const u: Uniforms = {};
    for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  };
  const fill = program(FILL_VS, FILL_FS, ["uM", "uView", "uEye", "uFw", "uCull", "uGold", "uLine", "uLocal", "uLJ", "uBias", "uFlat", "uA"]);
  const stroke = program(STROKE_VS, STROKE_FS, [
    "uM",
    "uView",
    "uDpr",
    "uFoot",
    "uLw",
    "uStamen",
    "uGold",
    "uFw",
    "uEye",
    "uBias",
    "uWBias",
    "uLocal",
    "uLJ",
    "uCull",
    "uFlat",
    "uSolid",
    "uAtK",
    "uPass",
    "uA",
  ]);
  const blade = program(BLADE_VS, STROKE_FS, [
    "uM",
    "uView",
    "uDpr",
    "uFw",
    "uLJ",
    "uAt",
    "uSun",
    "uPick",
    "uMode",
    "uFoot",
    "uBlade",
    "uCol",
    "uGoldCol",
    "uGold",
    "uPass",
    "uA",
  ]);
  const ellipse = program(ELLIPSE_VS, FILL_FS, ["uM", "uView", "uEye", "uFw", "uLJ", "uMode", "uGold", "uSeg", "uA"]);
  const flower = program(FLOWER_VS, FLOWER_FS, ["uM", "uView", "uEye", "uFw", "uJ", "uFJ", "uStyle", "uBias", "uPal", "uDpr", "uPass", "uA"]);
  const pattern = program(PATTERN_VS, PATTERN_FS, ["uM", "uBox", "uDots", "uDpr", "uH", "uCol"]);
  const lobe = program(LOBE_VS, FILL_FS, ["uM", "uView", "uGold", "uSeg", "uRagged", "uA"]);
  const fleck = program(FLECK_VS, FILL_FS, [
    "uM",
    "uView",
    "uEye",
    "uGold",
    "uShape",
    "uS",
    "uWd",
    "uCull",
    "uCentre",
    "uSlack",
    "uFinger",
    "uA",
  ]);
  gl.useProgram(fleck.p);
  gl.uniform2fv(fleck.u.uFinger, CT_FINGERS.flat());

  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  cv.addEventListener("webglcontextlost", onLost);

  // The corners of a quad, as a triangle strip: along 0 or 1, across -1 or 1.
  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  /** Vertices and indices for the fill program. */
  const fillVao = (vbo: WebGLBuffer, ibo: WebGLBuffer) => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VSTRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, VSTRIDE, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, VSTRIDE, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.BYTE, true, VSTRIDE, 20);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, VSTRIDE, 24);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, VSTRIDE, 28);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, VSTRIDE, 40);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    return vao;
  };
  /** Stroke instances from `first` on, into the bound vertex array. */
  const strokePointers = (buf: WebGLBuffer, first: number) => {
    const o = first * SSTRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = (loc: number, n: number, type: number, norm: boolean, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, type, norm, SSTRIDE, o + off);
      gl.vertexAttribDivisor(loc, 1);
    };
    at(0, 3, gl.FLOAT, false, 0);
    at(1, 3, gl.FLOAT, false, 12);
    at(2, 4, gl.FLOAT, false, 24);
    at(3, 4, gl.UNSIGNED_BYTE, true, 40);
    at(4, 4, gl.UNSIGNED_BYTE, true, 44);
    at(5, 4, gl.FLOAT, false, 48);
    at(7, 3, gl.FLOAT, false, 64);
    at(8, 3, gl.FLOAT, false, 76);
    at(9, 4, gl.BYTE, true, 88);
    at(10, 4, gl.BYTE, true, 92);
    at(11, 2, gl.FLOAT, false, 96);
    at(12, 3, gl.FLOAT, false, 104);
    at(13, 3, gl.FLOAT, false, 116);
    at(14, 4, gl.FLOAT, false, 128);
  };
  const bladePointers = (buf: WebGLBuffer, first: number) => {
    const o = first * BSTRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = (loc: number, n: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, BSTRIDE, o + off);
      gl.vertexAttribDivisor(loc, 1);
    };
    at(0, 3, 0);
    at(1, 3, 12);
    at(2, 1, 24);
  };
  const flowerPointers = (buf: WebGLBuffer, first: number) => {
    const o = first * FSTRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = (loc: number, n: number, type: number, norm: boolean, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, type, norm, FSTRIDE, o + off);
      gl.vertexAttribDivisor(loc, 1);
    };
    at(0, 3, gl.FLOAT, false, 0);
    at(1, 4, gl.BYTE, true, 12);
    at(2, 2, gl.FLOAT, false, 16);
    at(3, 4, gl.UNSIGNED_BYTE, false, 24);
    at(4, 4, gl.UNSIGNED_BYTE, true, 28);
    at(5, 4, gl.UNSIGNED_BYTE, true, 32);
  };
  const fleckPointers = (buf: WebGLBuffer, first: number) => {
    const o = first * KSTRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = (loc: number, n: number, type: number, norm: boolean, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, type, norm, KSTRIDE, o + off);
      gl.vertexAttribDivisor(loc, 1);
    };
    at(0, 3, gl.FLOAT, false, 0);
    at(1, 3, gl.FLOAT, false, 12);
    at(2, 1, gl.FLOAT, false, 24);
    at(3, 4, gl.UNSIGNED_BYTE, true, 28);
    at(4, 4, gl.UNSIGNED_BYTE, true, 32);
    at(5, 3, gl.FLOAT, false, 36);
    at(6, 3, gl.FLOAT, false, 48);
  };
  const lobePointers = (buf: WebGLBuffer, first: number) => {
    const o = first * LSTRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = (loc: number, n: number, type: number, norm: boolean, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, type, norm, LSTRIDE, o + off);
      gl.vertexAttribDivisor(loc, 1);
    };
    at(0, 3, gl.FLOAT, false, 0);
    at(1, 2, gl.FLOAT, false, 12);
    at(2, 4, gl.UNSIGNED_BYTE, true, 20);
    at(3, 4, gl.UNSIGNED_BYTE, true, 24);
    at(4, 4, gl.UNSIGNED_BYTE, true, 28);
    at(5, 4, gl.UNSIGNED_BYTE, true, 32);
    at(6, 4, gl.UNSIGNED_BYTE, true, 36);
  };
  const ellipsePointers = (buf: WebGLBuffer, first: number) => {
    const o = first * ESTRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const at = (loc: number, n: number, type: number, norm: boolean, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, type, norm, ESTRIDE, o + off);
      gl.vertexAttribDivisor(loc, 1);
    };
    at(0, 3, gl.FLOAT, false, 0);
    at(1, 3, gl.FLOAT, false, 12);
    at(2, 3, gl.FLOAT, false, 24);
    at(3, 3, gl.FLOAT, false, 36);
    at(4, 3, gl.FLOAT, false, 48);
    at(5, 4, gl.UNSIGNED_BYTE, true, 60);
    at(6, 4, gl.UNSIGNED_BYTE, true, 64);
    at(7, 4, gl.BYTE, true, 68);
    at(8, 2, gl.FLOAT, false, 72);
  };
  const cornerPointer = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 0);
  };
  const instVao = (buf: WebGLBuffer, first: number, kind: "strokes" | "flowers" | "flecks" | "ellipses" | "blades") => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    if (kind === "flecks") fleckPointers(buf, first);
    else if (kind === "blades") bladePointers(buf, first);
    else if (kind === "ellipses") ellipsePointers(buf, first);
    else {
      if (kind === "flowers") flowerPointers(buf, first);
      else strokePointers(buf, first);
      cornerPointer();
    }
    gl.bindVertexArray(null);
    return vao;
  };

  /** A plant, or the yard, on the card. */
  type OnCard = {
    vbo: WebGLBuffer;
    ibo: WebGLBuffer;
    vao: WebGLVertexArrayObject;
    sbo: WebGLBuffer;
    fbo: WebGLBuffer;
    kbo: WebGLBuffer;
    ebo: WebGLBuffer;
    bbo: WebGLBuffer;
    /** a vertex array per stroke, flower, fleck, ellipse or blade run, by its place in `ops` */
    inst: (WebGLVertexArrayObject | null)[];
    /** a tree's lobes, kept here to be sorted each frame; and, this frame,
     *  each lobe run's draws (where in the frame's lobes, how many, and
     *  whether each inks a pixel once), by its place in `ops` */
    lobes: { rec: Uint8Array; c: Float64Array; level: Uint8Array } | null;
    lobeDraws: { first: number; count: number; once: boolean }[][];
    ops: Op[];
    wide: boolean;
    used: boolean;
  };
  const upload = (b: Built): OnCard => {
    // The index buffer's binding belongs to whichever vertex array is
    // bound: unbind the last plant's, or this would take its indices.
    gl.bindVertexArray(null);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.index, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    const vao = fillVao(vbo, ibo);
    const sbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, sbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.strokes.byteLength ? b.strokes : new Uint8Array(SSTRIDE), gl.STATIC_DRAW);
    const fbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.flowers.byteLength ? b.flowers : new Uint8Array(FSTRIDE), gl.STATIC_DRAW);
    const kbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, kbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.flecks.byteLength ? b.flecks : new Uint8Array(KSTRIDE), gl.STATIC_DRAW);
    const ebo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ARRAY_BUFFER, b.ellipses.byteLength ? b.ellipses : new Uint8Array(ESTRIDE), gl.STATIC_DRAW);
    const bbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, bbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.blades.byteLength ? b.blades : new Uint8Array(BSTRIDE), gl.STATIC_DRAW);
    const inst = b.ops.map((op) =>
      op.kind === "strokes"
        ? instVao(sbo, op.first, "strokes")
        : op.kind === "flowers"
          ? instVao(fbo, op.first, "flowers")
          : op.kind === "flecks"
            ? instVao(kbo, op.first, "flecks")
            : op.kind === "ellipses"
              ? instVao(ebo, op.first, "ellipses")
              : op.kind === "blades"
                ? instVao(bbo, op.first, "blades")
                : null,
    );
    const lobes = b.lobes.byteLength ? { rec: b.lobes, c: b.lobeC, level: b.lobeLevel } : null;
    return { vbo, ibo, vao, sbo, fbo, kbo, ebo, bbo, inst, lobes, lobeDraws: [], ops: b.ops, wide: b.index instanceof Uint32Array, used: true };
  };
  const free = (m: OnCard) => {
    gl.deleteVertexArray(m.vao);
    for (const v of m.inst) if (v) gl.deleteVertexArray(v);
    for (const b of [m.vbo, m.ibo, m.sbo, m.fbo, m.kbo, m.ebo, m.bbo]) gl.deleteBuffer(b);
  };

  // Plants by what they were grown from; let go when they leave the scene.
  const plants = new Map<string, OnCard>();
  // The yard's shapes; its outlines are laid out again each frame.
  let yardShapes: { src: GLYard; key: string; shapes: YardShapes; card: OnCard } | null = null;
  const yardStrokes = gl.createBuffer()!;
  const yardStrokeVao = gl.createVertexArray()!;
  // Strokes a plant lays out afresh each frame (see `Op` dyn).
  const dynBuf = gl.createBuffer()!;
  const dynVao = gl.createVertexArray()!;
  // Every tree's lobes this frame, in the order they're drawn.
  const lobeBuf = gl.createBuffer()!;
  const lobeVao = gl.createVertexArray()!;
  let lobeBytes = new Uint8Array(LSTRIDE * 1024);
  // Rim points round a smooth lobe: a fan this fine is round to a tenth of
  // a pixel at a lobe a hundred across.
  const LOBE_SEG = 64;
  // And round an ellipse (a cactus's knob, an agave's heart).
  const ELLIPSE_SEG = 48;

  let dpr = 1;
  const M = new Float32Array(16);

  return {
    gpu,
    resize(W, H, s) {
      dpr = s;
      const w = Math.round(W * s);
      const h = Math.round(H * s);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
    },
    draw(view, yard, list, bodyA) {
      if (lost || gl.isContextLost()) return false;
      const { eye, rt, up, fw, focal, W, H } = view;
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      /** The canvas's P, in CSS pixels. */
      const P = (x: number, y: number, z: number): [number, number] => {
        const d = [x - eye[0], y - eye[1], z - eye[2]];
        const zc = Math.max(dot(d, fw), 1);
        return [W / 2 + (dot(d, rt) * focal) / zc, H / 2 - (dot(d, up) * focal) / zc];
      };
      /** P as the canvas has it, with depth: for parts that change with
       *  the camera (see `Frame`). */
      const P3 = (x: number, y: number, z: number): [number, number, number] => {
        const d = [x - eye[0], y - eye[1], z - eye[2]];
        const zc = Math.max(dot(d, fw), 1);
        return [W / 2 + (dot(d, rt) * focal) / zc, H / 2 - (dot(d, up) * focal) / zc, zc];
      };
      /** The canvas's local map at a point: pixels per foot along x, y and
       *  z, as the shaders' mat3x2 takes it. */
      const localJ = (p: ArrayLike<number>) => {
        const q = P3(p[0], p[1], p[2]);
        const jx = P3(p[0] + 1, p[1], p[2]);
        const jy = P3(p[0], p[1] + 1, p[2]);
        const jz = P3(p[0], p[1], p[2] + 1);
        return new Float32Array([jx[0] - q[0], jx[1] - q[1], jy[0] - q[0], jy[1] - q[1], jz[0] - q[0], jz[1] - q[1]]);
      };
      /** Depth of a point on the ground, along the view. */
      const depth = (x: number, z: number) => (x - eye[0]) * fw[0] - eye[1] * fw[1] + (z - eye[2]) * fw[2];
      const ftPx = (x: number, z: number, r: number) => (r * focal) / Math.max(depth(x, z), 1);
      const cam: Cam = { P: P3, eye, fw, ft: (x, z) => ftPx(x, z, 1) };

      // P's projection, as a matrix: x and y as the canvas puts them, depth
      // between a near and a far plane round the yard.
      const gr = yard.ground;
      const gx = (gr.x0 + gr.x1) / 2;
      const gz = (gr.z0 + gr.z1) / 2;
      const far = Math.hypot(gx - eye[0], eye[1], gz - eye[2]) + Math.hypot(gr.x1 - gr.x0, gr.z1 - gr.z0) + 40;
      const near = 0.5;
      const A = (far + near) / (far - near);
      const B = (-2 * far * near) / (far - near);
      const sx = (2 * focal) / W;
      const sy = (2 * focal) / H;
      const rows = [
        [sx * rt[0], sx * rt[1], sx * rt[2], -sx * dot(rt, eye)],
        [sy * up[0], sy * up[1], sy * up[2], -sy * dot(up, eye)],
        [A * fw[0], A * fw[1], A * fw[2], -A * dot(fw, eye) + B],
        [fw[0], fw[1], fw[2], -dot(fw, eye)],
      ];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) M[c * 4 + r] = rows[r][c];

      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(SAND[0] / 255, SAND[1] / 255, SAND[2] / 255, 1);
      gl.clearDepth(1);
      gl.clearStencil(0);
      gl.depthMask(true);
      gl.stencilMask(0xff);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthFunc(gl.LEQUAL);
      gl.polygonOffset(1, 1);
      // (A plant's parts set their own offset; the yard's are 1.)

      // What's the same all frame, set once a program.
      gl.useProgram(fill.p);
      gl.uniformMatrix4fv(fill.u.uM, false, M);
      gl.uniform2f(fill.u.uView, W, H);
      gl.uniform3f(fill.u.uEye, eye[0], eye[1], eye[2]);
      gl.uniform3f(fill.u.uFw, fw[0], fw[1], fw[2]);
      gl.uniform1f(fill.u.uLocal, 0);
      gl.uniform1f(fill.u.uBias, 0);
      gl.uniform1f(fill.u.uFlat, 0);
      gl.useProgram(stroke.p);
      gl.uniformMatrix4fv(stroke.u.uM, false, M);
      gl.uniform2f(stroke.u.uView, W, H);
      gl.uniform1f(stroke.u.uDpr, dpr);
      gl.uniform3f(stroke.u.uFw, fw[0], fw[1], fw[2]);
      gl.uniform3f(stroke.u.uEye, eye[0], eye[1], eye[2]);
      gl.uniform1f(stroke.u.uLocal, 0);
      gl.uniform1f(stroke.u.uCull, 0);
      gl.uniform1f(stroke.u.uWBias, 0);
      gl.uniform1f(stroke.u.uFlat, 0);
      gl.uniform1f(stroke.u.uSolid, 0);
      gl.uniform1f(stroke.u.uAtK, 0);
      gl.useProgram(blade.p);
      gl.uniformMatrix4fv(blade.u.uM, false, M);
      gl.uniform2f(blade.u.uView, W, H);
      gl.uniform1f(blade.u.uDpr, dpr);
      gl.uniform3f(blade.u.uFw, fw[0], fw[1], fw[2]);
      gl.uniform1f(blade.u.uPass, 0);
      gl.useProgram(ellipse.p);
      gl.uniformMatrix4fv(ellipse.u.uM, false, M);
      gl.uniform2f(ellipse.u.uView, W, H);
      gl.uniform3f(ellipse.u.uEye, eye[0], eye[1], eye[2]);
      gl.uniform3f(ellipse.u.uFw, fw[0], fw[1], fw[2]);
      gl.uniform1f(ellipse.u.uSeg, ELLIPSE_SEG);
      gl.useProgram(flower.p);
      gl.uniformMatrix4fv(flower.u.uM, false, M);
      gl.uniform2f(flower.u.uView, W, H);
      gl.uniform3f(flower.u.uEye, eye[0], eye[1], eye[2]);
      gl.uniform3f(flower.u.uFw, fw[0], fw[1], fw[2]);
      gl.uniform1f(flower.u.uDpr, dpr);
      gl.useProgram(lobe.p);
      gl.uniformMatrix4fv(lobe.u.uM, false, M);
      gl.uniform2f(lobe.u.uView, W, H);
      gl.useProgram(fleck.p);
      gl.uniformMatrix4fv(fleck.u.uM, false, M);
      gl.uniform2f(fleck.u.uView, W, H);
      gl.uniform3f(fleck.u.uEye, eye[0], eye[1], eye[2]);
      gl.useProgram(pattern.p);
      gl.uniformMatrix4fv(pattern.u.uM, false, M);
      gl.uniform1f(pattern.u.uDpr, dpr);
      gl.uniform1f(pattern.u.uH, H);

      let current: WebGLProgram | null = pattern.p;
      const bind = (p: { p: WebGLProgram }) => {
        if (current !== p.p) gl.useProgram((current = p.p));
      };
      // Each pixel inked once a run: the stencil holds which run last
      // inked it.
      let mark = 0;
      const nextMark = () => {
        if (++mark > 255) {
          gl.clear(gl.STENCIL_BUFFER_BIT);
          mark = 1;
        }
        return mark;
      };
      const once = (m: number) => {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.NOTEQUAL, m, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      };
      /** `n` strokes; with a mark, inking each pixel once between them, as
       *  one canvas path does. Their solid middles go first, then their soft
       *  edges where no middle inked: inked first, one stroke's soft edge
       *  kept the next one's middle out, and seamed every joint. With
       *  `depth`, the middles are written in depth, and the edges not. */
      const strokes = (n: number, mark: number, depth = false) => {
        if (!mark && !depth) {
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
          return;
        }
        if (mark) once(mark);
        gl.uniform1f(stroke.u.uPass, 1);
        gl.depthMask(depth);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.depthMask(false);
        gl.uniform1f(stroke.u.uPass, 2);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.uniform1f(stroke.u.uPass, 0);
        gl.disable(gl.STENCIL_TEST);
      };

      /* the yard */
      if (yardShapes?.src !== yard) {
        const key = yardKey(yard);
        if (yardShapes?.key === key) yardShapes.src = yard;
        else {
          if (yardShapes) free(yardShapes.card);
          const shapes = buildYard(yard);
          yardShapes = { src: yard, key, shapes, card: upload(shapes.built) };
        }
      }
      const { shapes, card } = yardShapes;
      const ib = card.wide ? 4 : 2;
      const it = card.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      bind(fill);
      gl.bindVertexArray(card.vao);
      gl.uniform1f(fill.u.uCull, 0);
      gl.uniform1f(fill.u.uGold, 0);
      gl.uniform4f(fill.u.uLine, 0, 0, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      // The ground: its outline filled into the stencil, the square over
      // it where that's set, and the grid.
      gl.enable(gl.STENCIL_TEST);
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.drawElements(gl.TRIANGLES, shapes.ground.fan[1], it, shapes.ground.fan[0] * ib);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, 1, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.uniform1f(fill.u.uA, 1);
      gl.drawElements(gl.TRIANGLES, shapes.ground.cover[1], it, shapes.ground.cover[0] * ib);
      // A one-pixel line in the canvas is `dpr` device pixels wide; here
      // it's one, so it's that much darker instead.
      gl.uniform1f(fill.u.uA, Math.min(dpr, 255 / GRID[3]));
      gl.drawElements(gl.LINES, shapes.ground.grid[1], it, shapes.ground.grid[0] * ib);
      gl.disable(gl.STENCIL_TEST);
      gl.clear(gl.STENCIL_BUFFER_BIT);

      const sb = new MeshBuilder();
      const steps: YardStep[] = yardFrame(shapes, P, ftPx, sb);
      const sbytes = sb.finish().strokes;
      gl.bindVertexArray(yardStrokeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, yardStrokes);
      gl.bufferData(gl.ARRAY_BUFFER, sbytes.byteLength ? sbytes : new Uint8Array(SSTRIDE), gl.DYNAMIC_DRAW);
      cornerPointer();
      for (const st of steps) {
        if (st.k === "fill") {
          bind(fill);
          gl.bindVertexArray(card.vao);
          gl.uniform1f(fill.u.uA, 1);
          if (st.depth) {
            gl.enable(gl.DEPTH_TEST);
            gl.depthMask(true);
            gl.enable(gl.POLYGON_OFFSET_FILL);
          }
          gl.drawElements(gl.TRIANGLES, st.count, it, st.first * ib);
          gl.disable(gl.POLYGON_OFFSET_FILL);
          gl.depthMask(false);
        } else if (st.k === "pattern") {
          bind(pattern);
          gl.bindVertexArray(card.vao);
          gl.uniform4f(pattern.u.uBox, st.box[0], st.box[1], st.box[2], st.spacing);
          gl.uniform1f(pattern.u.uDots, st.dots ? 1 : 0);
          gl.uniform4f(pattern.u.uCol, st.col[0] / 255, st.col[1] / 255, st.col[2] / 255, st.col[3] / 255);
          gl.drawElements(gl.TRIANGLES, st.count, it, st.first * ib);
        } else {
          bind(stroke);
          gl.bindVertexArray(yardStrokeVao);
          strokePointers(yardStrokes, st.first);
          gl.uniform1f(stroke.u.uFoot, 1);
          gl.uniform1f(stroke.u.uLw, 1);
          gl.uniform1f(stroke.u.uGold, 0);
          gl.uniform1f(stroke.u.uBias, 0);
          gl.uniform1f(stroke.u.uLocal, 0);
          gl.uniform1f(stroke.u.uCull, 0);
          gl.uniform1f(stroke.u.uWBias, 0);
          gl.uniform1f(stroke.u.uA, 1);
          if (st.depth) gl.enable(gl.DEPTH_TEST);
          strokes(st.count, nextMark());
        }
      }

      /* the plants, far first */
      for (const m of plants.values()) m.used = false;
      gl.enable(gl.DEPTH_TEST);
      const order = list
        .map((p) => {
          const k = plantKey(p);
          const m = plants.get(k);
          if (m) m.used = true;
          return { p, k, d: depth(p.x, p.z) };
        })
        .sort((a, b) => b.d - a.d);
      if (bodyA > 0) {
        // Each tree's lobes far first, as the canvas sorts them, and the
        // ebony's in bands, a tone at a time: laid out for every tree, then
        // sent to the card at once.
        let lobeN = 0;
        for (const { p, k } of order) {
          let m = plants.get(k);
          if (!m) {
            m = upload(buildPlant(p));
            plants.set(k, m);
          }
          m.used = true;
          const lobes = m.lobes;
          if (!lobes) continue;
          m.ops.forEach((op, i) => {
            if (op.kind !== "lobes") return;
            const { c, level, rec } = lobes;
            const zc: number[] = [];
            const idx: number[] = [];
            for (let j = 0; j < op.count; j++) {
              const o = (op.first + j) * 3;
              zc.push(Math.max((c[o] - eye[0]) * fw[0] + (c[o + 1] - eye[1]) * fw[1] + (c[o + 2] - eye[2]) * fw[2], 1));
              idx.push(j);
            }
            idx.sort((a, b) => zc[b] - zc[a]);
            const draws: { first: number; count: number; once: boolean }[] = [];
            let seq = idx;
            if (!op.bands) draws.push({ first: lobeN, count: op.count, once: false });
            else {
              seq = [];
              let tones = 0;
              for (const j of idx) tones = Math.max(tones, level[op.first + j] + 1);
              const byTone: number[][] = Array.from({ length: tones }, () => []);
              for (let band = 0; band < op.bands; band++) {
                for (const list of byTone) list.length = 0;
                const from = Math.floor((op.count * band) / op.bands);
                const to = Math.floor((op.count * (band + 1)) / op.bands);
                for (let o = from; o < to; o++) byTone[level[op.first + idx[o]]].push(idx[o]);
                for (const list of byTone) {
                  if (!list.length) continue;
                  draws.push({ first: lobeN + seq.length, count: list.length, once: true });
                  seq.push(...list);
                }
              }
            }
            if ((lobeN + seq.length) * LSTRIDE > lobeBytes.byteLength) {
              const grown = new Uint8Array(Math.max(lobeBytes.byteLength * 2, (lobeN + seq.length) * LSTRIDE));
              grown.set(lobeBytes.subarray(0, lobeN * LSTRIDE));
              lobeBytes = grown;
            }
            for (const j of seq) {
              const r = (op.first + j) * LSTRIDE;
              lobeBytes.set(rec.subarray(r, r + LSTRIDE), lobeN++ * LSTRIDE);
            }
            m.lobeDraws[i] = draws;
          });
        }
        if (lobeN) {
          gl.bindBuffer(gl.ARRAY_BUFFER, lobeBuf);
          gl.bufferData(gl.ARRAY_BUFFER, lobeBytes.subarray(0, lobeN * LSTRIDE), gl.DYNAMIC_DRAW);
        }

        for (const { k, p, d } of order) {
          const card = plants.get(k)!;
          const foot = focal / Math.max(d, 1);
          const marks = new Map<number, number>();
          const markOf = (g: number) => {
            let v = marks.get(g);
            if (v === undefined) marks.set(g, (v = nextMark()));
            return v;
          };
          const pib = card.wide ? 4 : 2;
          const pit = card.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
          card.ops.forEach((op, i) => {
            // A cactus's or an agave's parts: some show only near enough,
            // and are placed through the local map at the plant.
            const placed = op as { local?: ArrayLike<number>; frame?: Frame; flat?: boolean };
            const fr = placed.frame?.(cam);
            if (fr?.show === false) return;
            const opA = bodyA * (fr?.alpha ?? 1);
            const lj = placed.local ? localJ(placed.local) : null;
            const setLocal = (pr: { u: Uniforms }) => {
              gl.uniform1f(pr.u.uLocal, lj ? 1 : 0);
              if (lj) gl.uniformMatrix3x2fv(pr.u.uLJ, false, lj);
            };
            if (op.kind === "tris") {
              bind(fill);
              gl.bindVertexArray(card.vao);
              gl.uniform1f(fill.u.uCull, op.cull === 2 ? 2 : op.cull ? 1 : 0);
              gl.uniform1f(fill.u.uGold, p.gold ? 1 : 0);
              gl.uniform4f(fill.u.uLine, 0, 0, 0, 0);
              gl.uniform1f(fill.u.uA, opA);
              gl.uniform1f(fill.u.uBias, op.bias ?? 0);
              gl.uniform1f(fill.u.uFlat, op.flat ? 1 : 0);
              setLocal(fill);
              gl.depthMask(op.depth);
              const off = op.depth ? (op.offset ?? 1) : 0;
              if (off) {
                gl.polygonOffset(off, off);
                gl.enable(gl.POLYGON_OFFSET_FILL);
              }
              gl.drawElements(gl.TRIANGLES, op.count, pit, op.first * pib);
              gl.disable(gl.POLYGON_OFFSET_FILL);
              gl.depthMask(false);
            } else if (op.kind === "lines") {
              bind(fill);
              gl.bindVertexArray(card.vao);
              const c = p.gold ? op.gold : op.colour;
              gl.uniform1f(fill.u.uBias, 0);
              gl.uniform1f(fill.u.uFlat, 0);
              gl.uniform1f(fill.u.uLocal, 0);
              gl.uniform1f(fill.u.uCull, op.cull ? 1 : 0);
              gl.uniform4f(fill.u.uLine, c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255);
              // The canvas strokes these at 0.45 of the plant's line width,
              // and one shape's crossings among the others' ink again: a
              // one-pixel line at the ink's own strength matches that, and
              // wider than a pixel (a sharp screen) as much darker as it's
              // wider.
              gl.uniform1f(fill.u.uA, bodyA * Math.max(1, p.lw * 0.45 * dpr));
              if (op.once) once(markOf(op.once));
              gl.drawElements(gl.LINES, op.count, pit, op.first * pib);
              gl.disable(gl.STENCIL_TEST);
            } else if (op.kind === "strokes") {
              bind(stroke);
              gl.bindVertexArray(card.inst[i]);
              gl.uniform1f(stroke.u.uFoot, fr?.foot ?? foot);
              gl.uniform1f(stroke.u.uLw, p.lw);
              gl.uniform2f(stroke.u.uStamen, op.stamen?.[0] ?? 0, op.stamen?.[1] ?? 0);
              gl.uniform1f(stroke.u.uGold, p.gold ? 1 : 0);
              gl.uniform1f(stroke.u.uBias, op.bias ?? 0);
              gl.uniform1f(stroke.u.uCull, op.cull ?? 0);
              gl.uniform1f(stroke.u.uWBias, op.wbias ?? 0);
              gl.uniform1f(stroke.u.uFlat, op.flat ? 1 : 0);
              gl.uniform1f(stroke.u.uAtK, op.atK ? 1 : 0);
              setLocal(stroke);
              gl.uniform1f(stroke.u.uA, opA);
              if (op.solid) {
                gl.uniform1f(stroke.u.uSolid, 1);
                gl.depthMask(true);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, op.count);
                gl.depthMask(false);
                gl.uniform1f(stroke.u.uSolid, 0);
              } else strokes(op.count, op.once ? markOf(op.once) : 0, op.depth);
              gl.uniform1f(stroke.u.uAtK, 0);
            } else if (op.kind === "ellipses") {
              bind(ellipse);
              gl.bindVertexArray(card.inst[i]);
              gl.uniformMatrix3x2fv(ellipse.u.uLJ, false, lj ?? localJ([p.x, 0, p.z]));
              gl.uniform1f(ellipse.u.uMode, op.mode ?? 0);
              gl.uniform1f(ellipse.u.uGold, p.gold ? 1 : 0);
              gl.uniform1f(ellipse.u.uA, opA);
              gl.depthMask(op.depth !== false);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, ELLIPSE_SEG * 3, op.count);
              gl.depthMask(false);
            } else if (op.kind === "blades") {
              bind(blade);
              gl.bindVertexArray(card.inst[i]);
              const sj = localJ(op.sun);
              gl.uniformMatrix3x2fv(blade.u.uLJ, false, localJ(op.at));
              gl.uniform3f(blade.u.uAt, op.at[0], op.at[1], op.at[2]);
              gl.uniform2f(blade.u.uSun, sj[0] * -0.44 + sj[4] * -0.43, sj[1] * -0.44 + sj[5] * -0.43);
              gl.uniform4f(blade.u.uPick, op.pick[0], op.pick[1], op.pick[2], op.pick[3]);
              gl.uniform1f(blade.u.uMode, op.mode);
              gl.uniform1f(blade.u.uFoot, fr?.foot ?? foot);
              gl.uniform2f(blade.u.uBlade, op.len, op.wd);
              const [c, g] = [op.colour, op.gold];
              gl.uniform4f(blade.u.uCol, c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255);
              gl.uniform4f(blade.u.uGoldCol, g[0] / 255, g[1] / 255, g[2] / 255, g[3] / 255);
              gl.uniform1f(blade.u.uGold, p.gold ? 1 : 0);
              gl.uniform1f(blade.u.uA, opA);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, 9, op.count);
            } else if (op.kind === "dyn") {
              const db = new MeshBuilder();
              op.build(cam, db);
              const bytes = db.finish().strokes;
              if (!bytes.byteLength) return;
              bind(stroke);
              gl.bindVertexArray(dynVao);
              gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
              gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
              strokePointers(dynBuf, 0);
              cornerPointer();
              gl.uniform1f(stroke.u.uFoot, 1);
              gl.uniform1f(stroke.u.uLw, p.lw);
              gl.uniform1f(stroke.u.uGold, p.gold ? 1 : 0);
              gl.uniform1f(stroke.u.uBias, 0);
              gl.uniform1f(stroke.u.uCull, 0);
              gl.uniform1f(stroke.u.uWBias, 0);
              gl.uniform1f(stroke.u.uFlat, 0);
              gl.uniform1f(stroke.u.uLocal, 0);
              gl.uniform1f(stroke.u.uA, bodyA);
              strokes(bytes.byteLength / SSTRIDE, 0);
            } else if (op.kind === "lobes") {
              bind(lobe);
              gl.bindVertexArray(lobeVao);
              const seg = op.ragged ? 9 : LOBE_SEG;
              gl.uniform1f(lobe.u.uSeg, seg);
              gl.uniform1f(lobe.u.uRagged, op.ragged ? 1 : 0);
              gl.uniform1f(lobe.u.uGold, p.gold ? 1 : 0);
              gl.uniform1f(lobe.u.uA, bodyA);
              for (const dr of card.lobeDraws[i] ?? []) {
                lobePointers(lobeBuf, dr.first);
                if (dr.once) once(nextMark());
                gl.drawArraysInstanced(gl.TRIANGLES, 0, seg * 3, dr.count);
                gl.disable(gl.STENCIL_TEST);
              }
            } else if (op.kind === "flecks") {
              bind(fleck);
              gl.bindVertexArray(card.inst[i]);
              // The chaste's leaves are hands of five fingers, close to;
              // too small to see the fingers, each is one leaf-shaped fleck.
              let shape: number = op.shape;
              let size = op.mul * Math.max(op.ft * foot, op.floor);
              let verts = 6;
              if (op.shape === 1) {
                if (size > 4.5) verts = 30;
                else {
                  shape = 0;
                  size *= 0.6;
                }
              }
              gl.uniform1f(fleck.u.uShape, shape);
              gl.uniform1f(fleck.u.uS, size);
              gl.uniform1f(fleck.u.uWd, op.wd);
              gl.uniform1f(fleck.u.uCull, op.cull);
              const ctr = op.centre ?? [0, 0, 0];
              gl.uniform3f(fleck.u.uCentre, ctr[0], ctr[1], ctr[2]);
              gl.uniform1f(fleck.u.uSlack, op.slack ?? 0);
              gl.uniform1f(fleck.u.uGold, p.gold ? 1 : 0);
              gl.uniform1f(fleck.u.uA, bodyA);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, verts, op.count);
            } else {
              bind(flower);
              gl.bindVertexArray(card.inst[i]);
              // The canvas places a plant's flowers through one local map
              // at its middle: pixels per foot along x and along z there.
              const cy = p.h * op.cy;
              const q = P(p.x, cy, p.z);
              const qx = P(p.x + 1, cy, p.z);
              const qz = P(p.x, cy, p.z + 1);
              const J = [qx[0] - q[0], qx[1] - q[1], qz[0] - q[0], qz[1] - q[1]];
              gl.uniformMatrix2fv(flower.u.uJ, false, J);
              gl.uniform1f(flower.u.uFJ, Math.max(Math.hypot(J[0], J[1]), Math.hypot(J[2], J[3])));
              gl.uniform1i(flower.u.uStyle, op.style);
              gl.uniform1f(flower.u.uBias, op.bias);
              gl.uniform4fv(flower.u.uPal, p.gold ? op.palGold : op.pal);
              gl.uniform1f(flower.u.uA, bodyA);
              // Heads hide the ones behind them where they're solid; their
              // soft edges go over after, hiding nothing — written in depth,
              // an edge cut a ring out of the head behind it.
              gl.depthMask(true);
              gl.uniform1f(flower.u.uPass, 1);
              gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, op.count);
              gl.depthMask(false);
              gl.uniform1f(flower.u.uPass, 2);
              gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, op.count);
              gl.uniform1f(flower.u.uPass, 0);
            }
          });
        }
      }
      for (const [k, m] of plants) {
        if (!m.used) {
          free(m);
          plants.delete(k);
        }
      }
      gl.bindVertexArray(null);
      return true;
    },
    dispose() {
      cv.removeEventListener("webglcontextlost", onLost);
      for (const m of plants.values()) free(m);
      plants.clear();
      if (yardShapes) free(yardShapes.card);
      yardShapes = null;
      gl.deleteBuffer(yardStrokes);
      gl.deleteBuffer(corners);
      gl.deleteBuffer(lobeBuf);
      gl.deleteBuffer(dynBuf);
      gl.deleteVertexArray(yardStrokeVao);
      gl.deleteVertexArray(lobeVao);
      gl.deleteVertexArray(dynVao);
      for (const p of [fill, stroke, flower, pattern, lobe, fleck, ellipse, blade]) gl.deleteProgram(p.p);
    },
  };
}
