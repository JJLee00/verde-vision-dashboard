import type { Doc } from "./doc";

// Just enough of CanvasRenderingContext2D, on top of a pdfkit page, for the
// viewer's drawPlanSymbol to draw the printed blueprint's plants — the same
// function, not a second copy of it.
//
// A canvas and a PDF disagree on one thing that matters: a canvas keeps its
// path until the next beginPath, and lets you set the line width and colour
// halfway through building it; a PDF paints and discards the path, and
// forbids state changes inside one. So the path is recorded here and only
// written to the page — state first, then path, then paint — when stroke()
// or fill() is called, as many times as the caller asks.

type Seg =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "Z" }
  | { op: "C"; x: number; y: number; r: number };

type State = {
  stroke: string;
  fill: string;
  lineWidth: number;
  dash: number[];
  join: CanvasLineJoin;
};

/** "rgba(r, g, b, a)" / "rgb(…)" / "#rrggbb" → pdfkit colour + opacity. */
function parseColor(css: string): { color: [number, number, number] | string; alpha: number } {
  const m = css.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((v) => parseFloat(v));
    return { color: [r, g, b], alpha: Number.isFinite(a) ? a : 1 };
  }
  return { color: css, alpha: 1 };
}

export class PdfCanvas {
  private path: Seg[] = [];
  private state: State = { stroke: "#000000", fill: "#000000", lineWidth: 1, dash: [], join: "miter" };
  private stack: State[] = [];

  constructor(private doc: Doc) {}

  set strokeStyle(v: string) {
    this.state.stroke = v;
  }
  set fillStyle(v: string) {
    this.state.fill = v;
  }
  set lineWidth(v: number) {
    this.state.lineWidth = v;
  }
  set lineJoin(v: CanvasLineJoin) {
    this.state.join = v;
  }
  setLineDash(d: number[]) {
    this.state.dash = [...d];
  }

  save() {
    this.stack.push({ ...this.state, dash: [...this.state.dash] });
    this.doc.save();
  }
  restore() {
    const s = this.stack.pop();
    if (s) this.state = s;
    this.doc.restore();
  }

  beginPath() {
    this.path = [];
  }
  moveTo(x: number, y: number) {
    this.path.push({ op: "M", x, y });
  }
  lineTo(x: number, y: number) {
    this.path.push({ op: "L", x, y });
  }
  closePath() {
    this.path.push({ op: "Z" });
  }
  /** Only ever a whole circle in drawPlanSymbol (0 → 7 radians). */
  arc(x: number, y: number, r: number) {
    this.path.push({ op: "C", x, y, r });
  }

  stroke() {
    if (!this.path.length) return;
    const { color, alpha } = parseColor(this.state.stroke);
    const d = this.doc;
    d.save();
    d.lineWidth(this.state.lineWidth).lineJoin(this.state.join).strokeColor(color, alpha);
    // pdfkit takes a whole dash array at runtime; its typings only admit
    // the [length, space] pair.
    if (this.state.dash.length) d.dash(this.state.dash as unknown as number, {});
    else d.undash();
    this.replay();
    d.stroke();
    d.restore();
  }

  fill() {
    if (!this.path.length) return;
    const { color, alpha } = parseColor(this.state.fill);
    const d = this.doc;
    d.save();
    d.fillColor(color, alpha);
    this.replay();
    d.fill("nonzero");
    d.restore();
  }

  private replay() {
    for (const s of this.path) {
      if (s.op === "M") this.doc.moveTo(s.x, s.y);
      else if (s.op === "L") this.doc.lineTo(s.x, s.y);
      else if (s.op === "Z") this.doc.closePath();
      else this.doc.circle(s.x, s.y, s.r);
    }
  }
}
