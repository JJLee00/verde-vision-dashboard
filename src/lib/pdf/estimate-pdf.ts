import {
  ACCENT,
  CONTENT_WIDTH,
  FAINT,
  FONT,
  INK,
  MUTED,
  PAGE,
  RULE,
  RULE_SOFT,
  TEXT,
  WASH,
  brandedHeader,
  createDoc,
  ensureSpace,
  label,
  longDate,
  money,
  rule,
  stampFooters,
  toBuffer,
  type Doc,
  type OrgBrand,
} from "./doc";
import {
  computeTotals,
  groupByCategory,
  sortItems,
  type EstimateItem,
  type EstimateSettings,
} from "@/lib/estimate";

// The proposal. Two shapes off the same rows, chosen per estimate:
//
//   itemized — every line with its quantity and unit price. Maximum
//              transparency, and the client can price-shop line by line.
//   grouped  — rows rolled up by category into one line each, label and
//              total only. Quantities and unit prices stay internal.
//
// They MUST reach the same bottom line. Both call computeTotals() on the
// same rows for exactly that reason — the grouping only changes what is
// printed above the totals, never the arithmetic.

export type EstimateDocInput = {
  project: {
    name: string;
    date: string | null;
    address: string | null;
    contactEmail: string | null;
  };
  org: OrgBrand;
  items: EstimateItem[];
  settings: EstimateSettings;
  /** Project-level override; falls back to the org's standing terms. */
  terms: string | null;
};

// Column geometry for the itemized table, measured from the left margin.
const COL = {
  item: { x: 0, w: 234 },
  qty: { x: 240, w: 40 },
  unit: { x: 286, w: 44 },
  price: { x: 334, w: 76 },
  total: { x: 416, w: 88 },
} as const;

const x = (c: { x: number }) => PAGE.margin + c.x;

export async function renderEstimatePDF(
  input: EstimateDocInput
): Promise<Buffer> {
  const { project, org, settings } = input;
  const items = sortItems(input.items);
  const totals = computeTotals(items, settings);

  const doc = createDoc(`Estimate — ${project.name}`);

  let y = brandedHeader(
    doc,
    org,
    "Estimate",
    project.date ? longDate.format(new Date(`${project.date}T12:00:00`)) : null
  );

  y = drawParties(doc, project, y);
  y += 20;

  y =
    settings.detail === "grouped"
      ? drawGrouped(doc, items, y)
      : drawItemized(doc, items, y);

  y = drawTotals(doc, totals, settings, y + 16);

  // Terms and the signature line are reserved as ONE block. A proposal whose
  // second page holds nothing but a lonely "Client signature" rule reads as a
  // printing mistake, so they break to a new page together or not at all.
  const terms = input.terms?.trim() || org.terms?.trim() || null;
  const termsHeight = terms ? measureTerms(doc, terms) : 0;
  y = ensureSpace(
    doc,
    y + 18,
    termsHeight + (terms ? 18 : 0) + SIGNATURE_HEIGHT
  );
  if (terms) y = drawTerms(doc, terms, y) + 18;
  drawSignature(doc, y);

  stampFooters(doc, org.name);
  return toBuffer(doc);
}

/* ── Who it's for ─────────────────────────────────────────────────────── */

function drawParties(
  doc: Doc,
  project: EstimateDocInput["project"],
  y: number
): number {
  const colW = (CONTENT_WIDTH - 24) / 2;

  label(doc, "Prepared for", PAGE.margin, y);
  label(doc, "Project", PAGE.margin + colW + 24, y);
  const bodyY = y + 12;

  // The schema has no homeowner name — migration-009 gives the project an
  // address and a contact email, and that's what a proposal can honestly
  // show. A name field belongs with the client-accounts work.
  const left = [project.contactEmail, project.address].filter(
    (v): v is string => Boolean(v && v.trim())
  );
  doc
    .font(FONT.sans)
    .fontSize(10)
    .fillColor(TEXT)
    .text(left.length ? left.join("\n") : "—", PAGE.margin, bodyY, {
      width: colW,
    });
  const leftEnd = doc.y;

  doc
    .font(FONT.sansSemi)
    .fontSize(10)
    .fillColor(INK)
    .text(project.name, PAGE.margin + colW + 24, bodyY, { width: colW });
  const rightEnd = doc.y;

  return Math.max(leftEnd, rightEnd);
}

/* ── Itemized ─────────────────────────────────────────────────────────── */

function tableHead(doc: Doc, y: number): number {
  label(doc, "Item", x(COL.item), y);
  doc
    .font(FONT.sansSemi)
    .fontSize(7)
    .fillColor(FAINT)
    .text("QTY", x(COL.qty), y, { width: COL.qty.w, align: "right", characterSpacing: 1.1 })
    .text("UNIT", x(COL.unit), y, { width: COL.unit.w, characterSpacing: 1.1 })
    .text("UNIT PRICE", x(COL.price), y, { width: COL.price.w, align: "right", characterSpacing: 1.1 })
    .text("TOTAL", x(COL.total), y, { width: COL.total.w, align: "right", characterSpacing: 1.1 });
  rule(doc, y + 12, RULE);
  return y + 19;
}

function drawItemized(doc: Doc, items: EstimateItem[], startY: number): number {
  let y = tableHead(doc, startY);

  for (const item of items) {
    const descHeight = doc
      .font(FONT.sans)
      .fontSize(9.5)
      .heightOfString(item.description || "—", { width: COL.item.w });
    const noteHeight = item.note
      ? doc.font(FONT.italic).fontSize(8.5).heightOfString(item.note, {
          width: COL.item.w + 60,
        }) + 3
      : 0;
    const rowHeight = Math.max(descHeight, 12) + noteHeight + 9;

    const beforeY = y;
    y = ensureSpace(doc, y, rowHeight + 6);
    // A page break mid-table loses the column headers, so redraw them.
    if (y !== beforeY) y = tableHead(doc, y);

    doc
      .font(FONT.sans)
      .fontSize(9.5)
      .fillColor(TEXT)
      .text(item.description || "—", x(COL.item), y, { width: COL.item.w });
    doc
      .font(FONT.sans)
      .fontSize(9.5)
      .fillColor(TEXT)
      .text(trimNumber(item.quantity), x(COL.qty), y, {
        width: COL.qty.w,
        align: "right",
      })
      .text(item.unit, x(COL.unit), y, { width: COL.unit.w })
      .fillColor(MUTED)
      .text(money.format(item.unitPrice), x(COL.price), y, {
        width: COL.price.w,
        align: "right",
      });
    doc
      .font(FONT.sansSemi)
      .fontSize(9.5)
      .fillColor(INK)
      .text(money.format(item.total), x(COL.total), y, {
        width: COL.total.w,
        align: "right",
      });

    if (item.note) {
      doc
        .font(FONT.italic)
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(item.note, x(COL.item), y + Math.max(descHeight, 12) + 2, {
          width: COL.item.w + 60,
        });
    }

    y += rowHeight;
    rule(doc, y - 4, RULE_SOFT);
  }

  if (items.length === 0) {
    doc
      .font(FONT.italic)
      .fontSize(10)
      .fillColor(MUTED)
      .text("No line items.", PAGE.margin, y);
    y = doc.y + 6;
  }

  return y;
}

/* ── Grouped lump sums ────────────────────────────────────────────────── */

function drawGrouped(doc: Doc, items: EstimateItem[], startY: number): number {
  let y = startY;
  label(doc, "Scope of work", PAGE.margin, y);
  rule(doc, y + 12, RULE);
  y += 20;

  for (const group of groupByCategory(items)) {
    y = ensureSpace(doc, y, 26);
    doc
      .font(FONT.sans)
      .fontSize(10.5)
      .fillColor(TEXT)
      .text(group.label, PAGE.margin, y, { width: CONTENT_WIDTH - 110 });
    doc
      .font(FONT.sansSemi)
      .fontSize(10.5)
      .fillColor(INK)
      .text(money.format(group.total), PAGE.margin, y, {
        width: CONTENT_WIDTH,
        align: "right",
      });
    y += 20;
    rule(doc, y - 5, RULE_SOFT);
  }

  if (items.length === 0) {
    doc
      .font(FONT.italic)
      .fontSize(10)
      .fillColor(MUTED)
      .text("No line items.", PAGE.margin, y);
    y = doc.y + 6;
  }

  return y;
}

/* ── Totals ───────────────────────────────────────────────────────────── */

function drawTotals(
  doc: Doc,
  totals: ReturnType<typeof computeTotals>,
  settings: EstimateSettings,
  startY: number
): number {
  const boxW = 250;
  const boxX = PAGE.margin + CONTENT_WIDTH - boxW;
  const hasTax = settings.taxRate > 0;
  const hasDeposit = settings.depositPercent > 0;
  const rows = 1 + (hasTax ? 1 : 0) + (hasDeposit ? 2 : 0);
  const boxH = 30 + rows * 16 + 26;

  const y = ensureSpace(doc, startY, boxH);

  doc
    .save()
    .rect(boxX, y, boxW, boxH)
    .fillColor(WASH)
    .fill()
    .restore();

  let ry = y + 12;
  const line = (
    text: string,
    amount: string,
    strong = false,
    color = TEXT
  ) => {
    doc
      .font(strong ? FONT.sansSemi : FONT.sans)
      .fontSize(strong ? 10.5 : 9.5)
      .fillColor(strong ? INK : color)
      .text(text, boxX + 14, ry, { width: boxW - 120 });
    doc
      .font(strong ? FONT.sansSemi : FONT.sans)
      .fontSize(strong ? 12 : 9.5)
      .fillColor(strong ? INK : color)
      .text(amount, boxX + 14, ry - (strong ? 2 : 0), {
        width: boxW - 28,
        align: "right",
      });
    ry += strong ? 20 : 16;
  };

  line("Subtotal", money.format(totals.subtotal));
  if (hasTax) line(`Tax (${trimNumber(settings.taxRate)}%)`, money.format(totals.tax));

  doc
    .save()
    .moveTo(boxX + 14, ry + 1)
    .lineTo(boxX + boxW - 14, ry + 1)
    .lineWidth(0.6)
    .strokeColor(RULE)
    .stroke()
    .restore();
  ry += 9;

  line("Total", money.format(totals.total), true);

  if (hasDeposit) {
    line(
      `Deposit due (${trimNumber(settings.depositPercent)}%)`,
      money.format(totals.deposit),
      false,
      ACCENT
    );
    line("Balance on completion", money.format(totals.balance));
  }

  return y + boxH;
}

/* ── Terms + signature ────────────────────────────────────────────────── */

function measureTerms(doc: Doc, terms: string): number {
  return (
    doc.font(FONT.sans).fontSize(8.5).heightOfString(terms, {
      width: CONTENT_WIDTH,
    }) + 13
  );
}

// Label, one line of copy, the two rules and their captions.
const SIGNATURE_HEIGHT = 62;

function drawTerms(doc: Doc, terms: string, y: number): number {
  label(doc, "Terms", PAGE.margin, y);
  doc
    .font(FONT.sans)
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(terms, PAGE.margin, y + 13, { width: CONTENT_WIDTH, lineGap: 1.5 });
  return doc.y;
}

function drawSignature(doc: Doc, y: number) {
  label(doc, "Acceptance", PAGE.margin, y);

  doc
    .font(FONT.sans)
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      "Signing below accepts this estimate and authorizes the work described.",
      PAGE.margin,
      y + 13,
      { width: CONTENT_WIDTH }
    );

  const lineY = y + 46;
  const half = (CONTENT_WIDTH - 40) / 2;
  for (const [i, text] of ["Client signature", "Date"].entries()) {
    const lx = PAGE.margin + i * (half + 40);
    doc
      .save()
      .moveTo(lx, lineY)
      .lineTo(lx + half, lineY)
      .lineWidth(0.6)
      .strokeColor(RULE)
      .stroke()
      .restore();
    doc
      .font(FONT.sans)
      .fontSize(7.5)
      .fillColor(FAINT)
      .text(text, lx, lineY + 5, { width: half });
  }
}

/** 12 not 12.00, but 12.5 stays 12.5 — quantities read as written. */
function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
