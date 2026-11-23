// An uploaded plot plan, read into a picture the sheet can lay down: an
// image as it is (smaller, when it's huge), a PDF's first page drawn out at
// print resolution. Browser-only — the PDF reader loads on first use, so the
// builder doesn't carry it until someone uploads one.

/** `ppi`: pixels to the printed inch, for a PDF — its page has a real size. */
export type ReadPlan = { blob: Blob; w: number; h: number; name: string; ppi?: number };

/** The longest side kept, in pixels: a 24×36" sheet at about 110 dpi —
 *  plenty to trace on, and a few megabytes at most. */
const MAX_SIDE = 4000;
/** A PDF page drawn at this many pixels per inch, up to MAX_SIDE. */
const PDF_DPI = 200;
const MAX_BYTES = 40 * 1024 * 1024;

export async function readPlanFile(file: File): Promise<ReadPlan> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 40 MB.");
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Plan";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return { ...(await readPdf(file)), name };
  if (!file.type.startsWith("image/")) throw new Error("Upload a PDF or a picture (PNG or JPEG).");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That picture couldn't be read. Save it as a PNG or JPEG and try again.");
  }
  const { width: w, height: h } = bitmap;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  // Small enough already: the file itself, untouched.
  if (k === 1 && file.size <= 12 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) {
    bitmap.close();
    return { blob: file, w, h, name };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Line drawings stay crisp as PNG; photos of a plan are far smaller as JPEG.
  const blob = await toBlob(canvas, file.type === "image/png" ? "image/png" : "image/jpeg");
  return { blob, w: canvas.width, h: canvas.height, name };
}

async function readPdf(file: File): Promise<Omit<ReadPlan, "name">> {
  // The legacy build: the modern one leans on Map methods only the newest
  // browsers have.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    void task.destroy();
    throw new Error("That PDF couldn't be opened. If it has a password, save a copy without one.");
  }
  try {
    const page = await doc.getPage(1);
    const at1 = page.getViewport({ scale: 1 }); // 72 to the inch
    const scale = Math.min(PDF_DPI / 72, MAX_SIDE / Math.max(at1.width, at1.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    // A point is 1/72 inch, so `scale` pixels a point is this many an inch.
    return { blob: await toBlob(canvas, "image/png"), w: canvas.width, h: canvas.height, ppi: scale * 72 };
  } finally {
    void task.destroy();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The plan couldn't be drawn out."))), type, 0.9)
  );
}
