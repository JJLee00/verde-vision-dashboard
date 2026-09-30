// Building-footprint extraction: Solar API building mask → house polygon.
//
// The mask is a per-pixel "is this a building" raster covering a tile that
// usually contains SEVERAL properties (neighbours, casitas, sheds). Getting
// one house out of it is four steps: clip to the parcel, take the largest
// remaining blob, trace its outline, and simplify that outline to corners.
//
// --- Two honesty notes, both learned from real data -----------------------
//
// 1. The mask traces the ROOFLINE, not the walls. Arizona overhangs run
//    1–2 ft, so an extracted footprint is systematically FAT by that much,
//    and a designer standing at a wall corner is standing inside the
//    polygon. Partially cancels in the corner-walk rigid fit (both corners
//    shift outward similarly); properly fixed later by fusing the assessor's
//    dimensioned sketch. Do not pretend the polygon is a wall line.
//
// 2. The mask is imperfect. On the Aug 26 2026 test parcel (Cave Creek) it
//    dropped an entire west roof section while over-reporting total roofed
//    area by ~10% against the assessor sketch. That is why `areaSqFt` is
//    returned for cross-checking rather than trusted silently, and why the
//    designer confirms the outline on the align map before it is baked.
//
// Parcel clipping uses a TOLERANCE dilation because county parcel lines are
// tax-map quality (±2–10 ft) — on the test parcel the west line ran straight
// through the house's roof. Clipping to the raw ring would have sliced the
// building in half.

/** A single-band raster: `data[y * width + x]`. */
export interface MaskRaster {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Maps pixel centres to projected metres (UTM). Solar GeoTIFFs carry this
 * as a ModelTransformation: x = originX + col * scaleX, y = originY - row * scaleY.
 */
export interface PixelGrid {
  originX: number;
  originY: number;
  /** Metres per pixel. Solar imagery is 0.1 (HIGH) or 0.25 (MEDIUM). */
  scale: number;
}

export interface FootprintResult {
  /** Outline in pixel coordinates, unclosed. */
  ringPx: [number, number][];
  /** Roofed area of the chosen blob, square feet (cross-check value). */
  areaSqFt: number;
  /** Pixels in the blob before simplification — a tiny blob means a bad grab. */
  pixelCount: number;
}

const SQ_M_PER_SQ_FT = 0.09290304;

/** Point-in-polygon (ray casting) on an unclosed ring. */
function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Squared distance from point p to segment ab — the Douglas-Peucker metric,
 * kept squared to avoid a sqrt per candidate vertex.
 */
function sqDistToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
}

/** Douglas-Peucker on an open polyline. */
function simplifyOpen(
  points: [number, number][],
  toleranceSq: number
): [number, number][] {
  if (points.length < 3) return points.slice();
  let maxSq = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = sqDistToSegment(points[i], points[0], points[points.length - 1]);
    if (d > maxSq) {
      maxSq = d;
      index = i;
    }
  }
  if (maxSq <= toleranceSq) return [points[0], points[points.length - 1]];
  const left = simplifyOpen(points.slice(0, index + 1), toleranceSq);
  const right = simplifyOpen(points.slice(index), toleranceSq);
  return left.slice(0, -1).concat(right);
}

/**
 * Douglas-Peucker on a CLOSED ring. Splitting at the two most distant
 * vertices first matters: running the open algorithm on a ring anchored at
 * an arbitrary start vertex pins that vertex and can shave a real corner
 * next to it.
 */
function simplifyClosed(
  ring: [number, number][],
  tolerance: number
): [number, number][] {
  if (ring.length < 4) return ring.slice();
  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > best) {
      best = d;
      a = i;
    }
  }
  best = -1;
  for (let i = 0; i < ring.length; i++) {
    const d = (ring[i][0] - ring[a][0]) ** 2 + (ring[i][1] - ring[a][1]) ** 2;
    if (d > best) {
      best = d;
      b = i;
    }
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const tolSq = tolerance * tolerance;
  const first = simplifyOpen(ring.slice(lo, hi + 1), tolSq);
  const second = simplifyOpen(ring.slice(hi).concat(ring.slice(0, lo + 1)), tolSq);
  // Both halves repeat the two split vertices; drop the duplicates.
  return first.slice(0, -1).concat(second.slice(0, -1));
}

/**
 * Moore-neighbour boundary trace of the blob labelled `label`, walking
 * clockwise from the topmost-leftmost pixel. Returns every boundary pixel
 * in order (simplification happens afterwards).
 */
function traceBoundary(
  labels: Int32Array,
  width: number,
  height: number,
  label: number,
  start: [number, number]
): [number, number][] {
  const isSet = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label;

  // 8-neighbourhood, clockwise from west.
  const dirs: [number, number][] = [
    [-1, 0], [-1, -1], [0, -1], [1, -1],
    [1, 0], [1, 1], [0, 1], [-1, 1],
  ];

  const contour: [number, number][] = [];
  let current = start;
  let backtrackDir = 0;
  const maxSteps = width * height * 4; // hard stop; a trace must terminate
  let steps = 0;

  do {
    contour.push(current);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dirIndex = (backtrackDir + i) % 8;
      const [dx, dy] = dirs[dirIndex];
      const nx = current[0] + dx;
      const ny = current[1] + dy;
      if (isSet(nx, ny)) {
        // Resume the scan from just behind where we came from.
        backtrackDir = (dirIndex + 5) % 8;
        current = [nx, ny];
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    steps++;
  } while (
    steps < maxSteps &&
    !(current[0] === start[0] && current[1] === start[1])
  );

  return contour;
}

/**
 * Extracts the house footprint from a building mask.
 *
 * @param mask         building mask raster (non-zero = building)
 * @param grid         pixel → projected-metre mapping
 * @param parcelPx     parcel ring in PIXEL coordinates
 * @param toleranceM   parcel-line slop allowance, metres (tax-map quality)
 * @param simplifyM    Douglas-Peucker tolerance, metres
 */
export function extractFootprint(
  mask: MaskRaster,
  grid: PixelGrid,
  parcelPx: [number, number][],
  { toleranceM = 3, simplifyM = 0.5 }: { toleranceM?: number; simplifyM?: number } = {}
): FootprintResult | null {
  const { width, height, data } = mask;

  // 1. Clip to the parcel, dilated by the tax-map tolerance. Testing the
  //    dilation as a distance-to-ring would be exact but costs a segment
  //    scan per pixel; expanding the ring about its centroid is close
  //    enough for a slop allowance and runs once.
  const tolPx = toleranceM / grid.scale;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of parcelPx) {
    cx += x;
    cy += y;
  }
  cx /= parcelPx.length;
  cy /= parcelPx.length;
  const grown: [number, number][] = parcelPx.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * tolPx, y + (dy / len) * tolPx];
  });

  // 2. Connected components (4-neighbour flood fill) over the clipped mask.
  const labels = new Int32Array(width * height); // 0 = unlabelled
  let nextLabel = 0;
  let bestLabel = 0;
  let bestCount = 0;
  let bestStart: [number, number] = [0, 0];
  const stack: number[] = [];

  const inParcel = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (data[i] !== 0 && pointInRing(x, y, grown)) inParcel[i] = 1;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const seed = y * width + x;
      if (inParcel[seed] === 0 || labels[seed] !== 0) continue;
      nextLabel++;
      let count = 0;
      let topStart: [number, number] = [x, y];
      labels[seed] = nextLabel;
      stack.push(seed);
      while (stack.length > 0) {
        const idx = stack.pop() as number;
        const px = idx % width;
        const py = (idx - px) / width;
        count++;
        // Topmost-then-leftmost pixel is the trace's start point.
        if (py < topStart[1] || (py === topStart[1] && px < topStart[0])) {
          topStart = [px, py];
        }
        const neighbours = [
          px > 0 ? idx - 1 : -1,
          px < width - 1 ? idx + 1 : -1,
          py > 0 ? idx - width : -1,
          py < height - 1 ? idx + width : -1,
        ];
        for (const n of neighbours) {
          if (n >= 0 && inParcel[n] === 1 && labels[n] === 0) {
            labels[n] = nextLabel;
            stack.push(n);
          }
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestLabel = nextLabel;
        bestStart = topStart;
      }
    }
  }

  if (bestLabel === 0 || bestCount === 0) return null;

  // 3. Trace and simplify.
  const contour = traceBoundary(labels, width, height, bestLabel, bestStart);
  if (contour.length < 4) return null;
  const ringPx = simplifyClosed(contour, simplifyM / grid.scale);
  if (ringPx.length < 3) return null;

  const areaSqM = bestCount * grid.scale * grid.scale;
  return {
    ringPx,
    areaSqFt: areaSqM / SQ_M_PER_SQ_FT,
    pixelCount: bestCount,
  };
}
