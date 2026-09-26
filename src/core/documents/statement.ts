import type { ClinicSettings, Patient, StatementLine } from "../../shared/types.ts";
import { formatDate } from "../clock.ts";
import { formatPaisa } from "../money.ts";
import { bufferOf, COLORS, createDoc, drawFooter, drawHeader, ensureSpace, loadLogo, money, pageSize, patientBlock, type PageKind } from "./engine.ts";

export async function renderStatementPdf(args: {
  clinic: ClinicSettings;
  patient: Patient;
  from?: string;
  to?: string;
  openingPaisa: number;
  closingPaisa: number;
  totalBilled: number;
  totalPaid: number;
  lines: StatementLine[];
  paper?: PageKind;
}): Promise<Buffer> {
  const paper: PageKind = args.paper ?? "A4";
  const size = pageSize(paper);
  const margin = 48;
  const doc = createDoc(paper);
  const { clinic, patient } = args;
  const contentW = size.width - margin * 2;
  const period = [args.from ? formatDate(args.from, clinic.timezone) : "Opening", args.to ? formatDate(args.to, clinic.timezone) : "Today"].join(" — ");

  const headerY = drawHeader(
    doc,
    clinic,
    "STATEMENT",
    [
      ["Period", period],
      ["Patient", patient.code],
    ],
    { width: size.width, margin, logo: loadLogo(clinic) },
  );

  let y = patientBlock(doc, margin, headerY, contentW, [
    ["Patient code", patient.code],
    ["Name", patient.fullName],
    ["Opening balance", money(args.openingPaisa)],
  ]);

  const cols = [
    { w: 90, h: "Date" },
    { w: 70, h: "Type" },
    { w: 160, h: "Description" },
    { w: 70, h: "Debit" },
    { w: 70, h: "Credit" },
    { w: 70, h: "Balance" },
  ];
  y = head(doc, margin, y, cols, contentW);
  args.lines.forEach((line, idx) => {
    y = ensureSpace(doc, y, 18, size.height, margin, 56);
    const h = 16;
    if (idx % 2 === 0) doc.rect(margin, y, contentW, h).fill("#F7F4EE");
    const vals = [
      formatDate(line.at, clinic.timezone),
      line.kind,
      line.description,
      line.debitPaisa ? formatPaisa(line.debitPaisa) : "",
      line.creditPaisa ? formatPaisa(line.creditPaisa) : "",
      formatPaisa(line.runningPaisa),
    ];
    let x = margin;
    vals.forEach((v, i) => {
      const col = cols[i]!;
      doc.font("Times-Roman").fontSize(7.5).fillColor(COLORS.ink).text(v, x + 2, y + 3, {
        width: col.w - 4,
        align: i >= 3 ? "right" : "left",
      });
      x += col.w;
    });
    y += h;
  });

  y = ensureSpace(doc, y, 70, size.height, margin, 56);
  y += 12;
  const summary: Array<[string, string]> = [
    ["Total billed", money(args.totalBilled)],
    ["Total paid", money(args.totalPaid)],
    ["Closing balance", money(args.closingPaisa)],
  ];
  for (const [k, v] of summary) {
    doc.font("Times-Bold").fontSize(10).fillColor(k.startsWith("Closing") ? COLORS.accent : COLORS.ink);
    doc.text(k, size.width - margin - 220, y, { width: 110 });
    doc.text(v, size.width - margin - 110, y, { width: 110, align: "right" });
    y += 14;
  }

  drawFooter(doc, clinic, size.width, size.height, margin, "Patient statement — running balance must match stored records.");
  return bufferOf(doc);
}

function head(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  cols: Array<{ w: number; h: string }>,
  tableW: number,
): number {
  doc.rect(x, y, tableW, 16).fill(COLORS.accent);
  let cx = x;
  cols.forEach((c, i) => {
    doc.font("Times-Bold").fontSize(8).fillColor("#FFFFFF").text(c.h, cx + 2, y + 4, { width: c.w - 4, align: i >= 3 ? "right" : "left" });
    cx += c.w;
  });
  return y + 16;
}
