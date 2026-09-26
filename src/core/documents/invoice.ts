import type { ClinicSettings, Invoice, Patient } from "../../shared/types.ts";
import { formatDate } from "../clock.ts";
import { formatPaisa } from "../money.ts";
import { bufferOf, COLORS, createDoc, drawFooter, drawHeader, ensureSpace, loadLogo, money, pageSize, patientBlock, type PageKind } from "./engine.ts";

export async function renderInvoicePdf(args: {
  clinic: ClinicSettings;
  patient: Patient;
  invoice: Invoice;
  paper?: PageKind;
}): Promise<Buffer> {
  const paper: PageKind = args.paper ?? (args.clinic.paperSize === "80mm" ? "A4" : args.clinic.paperSize);
  const size = pageSize(paper);
  const margin = 48;
  const doc = createDoc(paper);
  const { clinic, patient, invoice } = args;
  const contentW = size.width - margin * 2;

  const headerY = drawHeader(
    doc,
    clinic,
    "INVOICE",
    [
      ["Number", invoice.number],
      ["Date", formatDate(invoice.issuedAt, clinic.timezone)],
      ["Status", invoice.status.toUpperCase()],
    ],
    { width: size.width, margin, logo: loadLogo(clinic) },
  );

  let y = patientBlock(doc, margin, headerY, contentW, [
    ["Patient code", patient.code],
    ["Bill to", patient.fullName],
    ["Contact", patient.phone || patient.email || "—"],
  ]);

  const cols = [
    { w: 28, h: "#" },
    { w: 210, h: "Description" },
    { w: 50, h: "Tooth" },
    { w: 40, h: "Qty" },
    { w: 70, h: "Unit" },
    { w: 60, h: "Disc." },
    { w: 70, h: "Amount" },
  ];
  y = tableHead(doc, margin, y, cols, contentW);
  invoice.lines.forEach((line, idx) => {
    y = ensureSpace(doc, y, 22, size.height, margin, 56);
    const h = 20;
    if (idx % 2 === 0) doc.rect(margin, y, contentW, h).fill("#F7F4EE");
    const vals = [
      String(line.sequence),
      line.description,
      line.tooth || "—",
      String(line.quantity),
      formatPaisa(line.unitPricePaisa),
      formatPaisa(line.discountPaisa),
      formatPaisa(line.lineTotalPaisa),
    ];
    let x = margin;
    vals.forEach((v, i) => {
      const col = cols[i]!;
      const align = i >= 3 ? "right" : "left";
      doc.font("Times-Roman").fontSize(8).fillColor(COLORS.ink).text(v, x + 3, y + 5, { width: col.w - 6, align });
      x += col.w;
    });
    y += h;
  });

  y = ensureSpace(doc, y, 110, size.height, margin, 56);
  y += 12;
  const boxW = 220;
  const bx = size.width - margin - boxW;
  const rows: Array<[string, string, boolean?]> = [
    ["Subtotal", money(invoice.subtotalPaisa)],
    ["Discount", money(invoice.discountPaisa)],
    ["Tax", money(invoice.taxPaisa)],
    ["Total", money(invoice.totalPaisa), true],
    ["Paid", money(invoice.paidPaisa)],
    ["Amount due", money(invoice.duePaisa), true],
  ];
  for (const [k, v, strong] of rows) {
    if (strong) {
      doc.rect(bx, y - 2, boxW, 16).fill(k === "Amount due" ? COLORS.accent : "#EFEAE0");
      doc.fillColor(k === "Amount due" ? "#FFFFFF" : COLORS.ink);
      doc.font("Times-Bold").fontSize(10);
    } else {
      doc.fillColor(COLORS.ink).font("Times-Roman").fontSize(9);
    }
    doc.text(k, bx + 8, y, { width: 90 });
    doc.text(v, bx + 90, y, { width: boxW - 100, align: "right" });
    y += 16;
  }

  if (invoice.notes) {
    y += 10;
    doc.font("Times-Italic").fontSize(8).fillColor(COLORS.muted).text(invoice.notes, margin, y, { width: contentW - boxW - 16 });
  }

  drawFooter(doc, clinic, size.width, size.height, margin, clinic.invoiceFooter);
  return bufferOf(doc);
}

function tableHead(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  cols: Array<{ w: number; h: string }>,
  tableW: number,
): number {
  doc.rect(x, y, tableW, 16).fill(COLORS.accent);
  let cx = x;
  cols.forEach((c, i) => {
    doc.font("Times-Bold").fontSize(8).fillColor("#FFFFFF").text(c.h, cx + 3, y + 4, { width: c.w - 6, align: i >= 3 ? "right" : "left" });
    cx += c.w;
  });
  return y + 16;
}
