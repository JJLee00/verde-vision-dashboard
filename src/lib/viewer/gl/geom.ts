// Geometry for the WebGL layer: polygons into triangles, a convex hull in
// 3D, and the canvas's colour strings as bytes.

export type Rgba = [number, number, number, number];

/** A CSS colour as the viewer writes them — `#rrggbb`, `rgb(…)` or
 *  `rgba(…)` — as straight-alpha bytes. */
export function rgba(css: string): Rgba {
  if (css[0] === "#") {
    const n = parseInt(css.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  const v = css.match(/[\d.]+/g)!.map(Number);
  return [v[0] | 0, v[1] | 0, v[2] | 0, v.length > 3 ? Math.round(v[3] * 255) : 255];
}

/** Bytes of an `[r, g, b]` triple, opaque. */
export const rgb3 = (c: number[]): Rgba => [c[0] | 0, c[1] | 0, c[2] | 0, 255];

/** The viewer's ink, green and (picked) gold, at a strength. */
export const verde = (a: number) => rgba(`rgba(46,93,67,${a})`);
export const gold = (a: number) => rgba(`rgba(168,123,47,${a})`);

/** The paper the canvas lays under a translucent face (`LEAF_BODY`). */
const PAPER = rgba("rgba(235,224,203,0.93)");
/** A tint over the paper, as the canvas fills one and then the other: the
 *  one colour they make, straight alpha. */
export function overPaper(t: Rgba): Rgba {
  const ta = t[3] / 255;
  const pa = (PAPER[3] / 255) * (1 - ta);
  const a = ta + pa;
  const c = (k: number) => Math.round((t[k] * ta + PAPER[k] * pa) / a);
  return [c(0), c(1), c(2), Math.round(a * 255)];
}

/** Convex hull, Andrew's monotone chain. A barrel cactus is a convex body,
 *  so its outline on screen is the hull of its surface — which stays right
 *  at any camera angle, where a drawn ellipse is only right from straight
 *  on and goes wrong the moment the view tips. */
export function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0)
        out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** A simple polygon into triangles by clipping ears: corner indices, three
 *  a triangle. Any winding; small polygons only (it's quadratic). */
export function earcut(pts: [number, number][]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  // Counter-clockwise (area > 0 is), so an ear is a left turn.
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse();
  const cross = (a: number, b: number, c: number) =>
    (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p: number, a: number, b: number, c: number) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      let ear = true;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        if (inside(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    // Only a degenerate polygon has no ear: fan what's left.
    if (!cut) break;
  }
  for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
  return out;
}

/** The convex hull of points in 3D, as triangles of their indices. Seen
 *  from anywhere, its outline on screen is the convex hull of the points'
 *  projections — what the canvas fills for a shrub's core. */
export function hull3(p: [number, number, number][]): number[] {
  const n = p.length;
  if (n < 4) return n === 3 ? [0, 1, 2] : [];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crs = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let scale = 0;
  for (const q of p) scale = Math.max(scale, Math.abs(q[0] - p[0][0]), Math.abs(q[1] - p[0][1]), Math.abs(q[2] - p[0][2]));
  const eps = scale * 1e-7;

  // A first tetrahedron from four points well apart.
  let i1 = 0;
  for (let i = 1; i < n; i++) if (dot(sub(p[i], p[0]), sub(p[i], p[0])) > dot(sub(p[i1], p[0]), sub(p[i1], p[0]))) i1 = i;
  let i2 = -1;
  let best = 0;
  for (let i = 0; i < n; i++) {
    const c = crs(sub(p[i1], p[0]), sub(p[i], p[0]));
    const m = dot(c, c);
    if (m > best) [best, i2] = [m, i];
  }
  if (i2 < 0) return [];
  const nrm0 = crs(sub(p[i1], p[0]), sub(p[i2], p[0]));
  let i3 = -1;
  best = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(dot(nrm0, sub(p[i], p[0])));
    if (d > best) [best, i3] = [d, i];
  }
  if (i3 < 0 || best < eps * Math.sqrt(dot(nrm0, nrm0))) return [];

  type Face = { a: number; b: number; c: number; n: number[]; d: number };
  const face = (a: number, b: number, c: number): Face => {
    const nn = crs(sub(p[b], p[a]), sub(p[c], p[a]));
    return { a, b, c, n: nn, d: dot(nn, p[a]) };
  };
  const mid = [0, i1, i2, i3].reduce((s, i) => [s[0] + p[i][0] / 4, s[1] + p[i][1] / 4, s[2] + p[i][2] / 4], [0, 0, 0]);
  // Wound so each faces away from the middle.
  const out = (a: number, b: number, c: number) => {
    const f = face(a, b, c);
    return dot(f.n, mid) - f.d > 0 ? face(a, c, b) : f;
  };
  let faces: Face[] = [out(0, i1, i2), out(0, i1, i3), out(0, i2, i3), out(i1, i2, i3)];
  const used = new Set([0, i1, i2, i3]);
  for (let i = 0; i < n; i++) {
    if (used.has(i)) continue;
    const q = p[i];
    const seen = faces.filter((f) => dot(f.n, q) - f.d > eps * Math.sqrt(dot(f.n, f.n)));
    if (!seen.length) continue;
    // The horizon: edges of the faces it sees whose other side it doesn't.
    const edges = new Set<string>();
    for (const f of seen) for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]]) edges.add(`${u},${v}`);
    const keep = faces.filter((f) => !seen.includes(f));
    for (const e of edges) {
      const [u, v] = e.split(",").map(Number);
      if (edges.has(`${v},${u}`)) continue;
      keep.push(face(u, v, i));
    }
    faces = keep;
  }
  return faces.flatMap((f) => [f.a, f.b, f.c]);
}

/** The edges of triangles (corner indices, three a triangle), each once,
 *  with the one or two triangles it bounds. */
export function edgesOf(tri: ArrayLike<number>) {
  const sides = new Map<string, [number, number, number[]]>();
  for (let f = 0; f < tri.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const a = tri[f * 3 + k];
      const b = tri[f * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const e = sides.get(key);
      if (e) e[2].push(f);
      else sides.set(key, [a, b, [f]]);
    }
  }
  return [...sides.values()];
}
