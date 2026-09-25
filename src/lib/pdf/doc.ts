import PDFDocument from "pdfkit";
import path from "node:path";

// Shared document layer for every PDF the dashboard generates.
//
// The estimate is the first one; the blueprint (plan doc §8) is next and
// reuses all of this. pdfkit was chosen over an HTML-to-PDF pipeline for
// exactly that reason: its drawing API is CoreGraphics-shaped (save/restore,
// moveTo/lineTo/bezierCurveTo, arc, fill/stroke, translate/rotate), so
// porting Blueprintexporter.swift and PlantSymbols.swift will be close to
// mechanical, and the plan prints as real vector rather than a screenshot of
// a canvas.
//
// Print palette, not the screen palette: the dashboard's sand-paper ground
// belongs on a screen, not on a client's printer. Documents go out on white
// with ink text and green accents, which is both cheaper to print and how a
// drawing set is supposed to look.

export const PAPER = "#ffffff";
export const INK = "#1c2a21";
export const TEXT = "#2b372f";
export const MUTED = "#5c675e";
export const FAINT = "#9aa39b";
export const ACCENT = "#2e5d43";
export const CLAY = "#b0552f";
export const RULE = "#d7d2c6";
export const RULE_SOFT = "#ebe7dd";
export const WASH = "#f6f4ee";

export const FONT = {
  sans: "sans",
  sansSemi: "sans-semi",
  sansBold: "sans-bold",
  serif: "serif",
  serifSemi: "serif-semi",
  italic: "italic",
} as const;

// US Letter, 0.75" margins. Wide enough for a 5-column bid without
// crowding, and it fits any printer a landscaper owns.
export const PAGE = {
  width: 612,
  height: 792,
  margin: 54,
} as const;

export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
export const CONTENT_BOTTOM = PAGE.height - PAGE.margin - 28; // room for the footer

export type Doc = InstanceType<typeof PDFDocument>;

const FONT_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");

// next.config.ts keeps pdfkit external and traces this folder into the
// serverless bundle; without both, font registration throws in production
// and works fine locally.
export function createDoc(title: string): Doc {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: PAGE.margin,
    // Footers stamp "page N of M", which can't be known until the last page
    // exists — so pages are buffered and flushed at the end.
    bufferPages: true,
    info: { Title: title, Creator: "Verde Vision" },
  });

  doc.registerFont(FONT.sans, path.join(FONT_DIR, "SchibstedGrotesk-Regular.ttf"));
  doc.registerFont(FONT.sansSemi, path.join(FONT_DIR, "SchibstedGrotesk-SemiBold.ttf"));
  doc.registerFont(FONT.sansBold, path.join(FONT_DIR, "SchibstedGrotesk-Bold.ttf"));
  doc.registerFont(FONT.serif, path.join(FONT_DIR, "Newsreader-Regular.ttf"));
  doc.registerFont(FONT.serifSemi, path.join(FONT_DIR, "Newsreader-SemiBold.ttf"));
  doc.registerFont(FONT.italic, path.join(FONT_DIR, "Newsreader-Italic.ttf"));

  return doc;
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const longDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "America/Phoenix",
});

/** A hairline across the content column. */
export function rule(doc: Doc, y: number, color = RULE, width = CONTENT_WIDTH) {
  doc
    .save()
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.margin + width, y)
    .lineWidth(0.6)
    .strokeColor(color)
    .stroke()
    .restore();
}

/** Small uppercase label — the same one the dashboard uses over its cards. */
export function label(doc: Doc, text: string, x: number, y: number, color = FAINT) {
  doc
    .font(FONT.sansSemi)
    .fontSize(7)
    .fillColor(color)
    .text(text.toUpperCase(), x, y, { characterSpacing: 1.1 });
}

export type OrgBrand = {
  name: string;
  logo: Buffer | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  licenseNumber: string | null;
  terms: string | null;
};

/**
 * The letterhead: the LANDSCAPER's business, never Verde Vision's. Their
 * client should see their brand; Verde Vision keeps the small mark in the
 * footer.
 *
 * Returns the y to carry on from.
 */
export function brandedHeader(
  doc: Doc,
  org: OrgBrand,
  documentTitle: string,
  dateText: string | null
): number {
  const top: number = PAGE.margin;
  let leftY: number = top;

  // pdfkit only decodes PNG and JPEG. A logo in any other format (or a
  // corrupt one) must not take the whole proposal down with it.
  if (org.logo) {
    try {
      doc.image(org.logo, PAGE.margin, top, { fit: [132, 44] });
      leftY = top + 54;
    } catch {
      leftY = top;
    }
  }

  doc
    .font(FONT.sansBold)
    .fontSize(13)
    .fillColor(INK)
    .text(org.name, PAGE.margin, leftY, { width: 300 });
  leftY = doc.y + 2;

  const contact = [org.address, org.phone, org.email, org.website].filter(
    (v): v is string => Boolean(v && v.trim())
  );
  if (contact.length) {
    doc
      .font(FONT.sans)
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(contact.join("  ·  "), PAGE.margin, leftY, { width: 355 });
    leftY = doc.y;
  }
  if (org.licenseNumber?.trim()) {
    doc
      .font(FONT.sans)
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`License ${org.licenseNumber}`, PAGE.margin, leftY, { width: 320 });
    leftY = doc.y;
  }

  // Document title, right-aligned against the margin.
  doc
    .font(FONT.serifSemi)
    .fontSize(26)
    .fillColor(ACCENT)
    .text(documentTitle, PAGE.margin, top, {
      width: CONTENT_WIDTH,
      align: "right",
    });
  let rightY = doc.y + 1;
  if (dateText) {
    doc
      .font(FONT.sans)
      .fontSize(9)
      .fillColor(MUTED)
      .text(dateText, PAGE.margin, rightY, {
        width: CONTENT_WIDTH,
        align: "right",
      });
    rightY = doc.y;
  }

  const y = Math.max(leftY, rightY) + 14;
  rule(doc, y, ACCENT);
  return y + 18;
}

/**
 * Stamps every buffered page with the footer, then the document is ready to
 * end. Call once, last — page count isn't knowable before then.
 */
export function stampFooters(doc: Doc, orgName: string) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = PAGE.height - PAGE.margin - 12;
    rule(doc, y - 8, RULE_SOFT);
    doc
      .font(FONT.sans)
      .fontSize(7.5)
      .fillColor(FAINT)
      .text(orgName, PAGE.margin, y, { width: CONTENT_WIDTH / 2 });
    doc
      .font(FONT.sans)
      .fontSize(7.5)
      .fillColor(FAINT)
      .text(
        `Designed with Verde Vision  ·  Page ${i + 1} of ${range.count}`,
        PAGE.margin,
        y,
        { width: CONTENT_WIDTH, align: "right" }
      );
  }
}

/**
 * Ensure `needed` points fit before the footer; start a page if not.
 * Returns the y to draw at.
 */
export function ensureSpace(doc: Doc, y: number, needed: number): number {
  if (y + needed <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return PAGE.margin;
}
