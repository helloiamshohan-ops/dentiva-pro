import fs from "node:fs";
import PDFDocument from "pdfkit";
import { APP_NAME } from "../../shared/constants.ts";
import { formatPaisa } from "../money.ts";
import type { ClinicSettings } from "../../shared/types.ts";

export type PageKind = "A4" | "A5" | "Letter" | "80mm";

const SIZES: Record<PageKind, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  "80mm": { width: 226.77, height: 600 },
};

export const COLORS = {
  ink: "#1A1F24",
  muted: "#5C6570",
  line: "#D7D2C8",
  accent: "#1F4E4A",
  paper: "#FFFbf5",
  rule: "#1F4E4A",
  danger: "#8F2D2D",
};

export type DocFonts = {
  regular: string;
  bold: string;
  italic?: string;
};

export function pageSize(kind: PageKind): { width: number; height: number } {
  return SIZES[kind];
}

export function createDoc(kind: PageKind, _margins?: { top: number; bottom: number; left: number; right: number }): PDFKit.PDFDocument {
  const size = kind === "80mm" ? [SIZES[kind].width, SIZES[kind].height] : kind;
  return new PDFDocument({
    size: size as unknown as [number, number] | PageKind,
    margin: 0,
    bufferPages: true,
    compress: false,
    info: { Title: APP_NAME, Author: APP_NAME, Creator: APP_NAME },
  });
}

export async function bufferOf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export function drawHeader(
  doc: PDFKit.PDFDocument,
  clinic: ClinicSettings,
  title: string,
  meta: Array<[string, string]>,
  opts: { width: number; margin: number; logo?: Buffer | null },
): number {
  const y0 = opts.margin;
  let x = opts.margin;
  if (opts.logo) {
    try {
      doc.image(opts.logo, x, y0, { fit: [48, 48] });
      x += 58;
    } catch {
      /* ignore bad logo */
    }
  }
  doc.fillColor(COLORS.accent).font("Times-Bold").fontSize(16).text(clinic.clinicName || APP_NAME, x, y0, {
    width: opts.width - x - opts.margin - 160,
  });
  doc.fillColor(COLORS.muted).font("Times-Roman").fontSize(8);
  const contact = [clinic.address, clinic.phone, clinic.email].filter(Boolean).join("  ·  ");
  doc.text(contact, x, y0 + 20, { width: opts.width - x - opts.margin - 160 });
  if (clinic.dentistName) {
    const q = [clinic.dentistName, clinic.dentistQualifications, clinic.dentistRegistration].filter(Boolean).join("  ·  ");
    doc.text(q, x, y0 + 32, { width: opts.width - x - opts.margin - 160 });
  }
  const rightX = opts.width - opts.margin - 150;
  doc.fillColor(COLORS.accent).font("Times-Bold").fontSize(13).text(title, rightX, y0, { width: 150, align: "right" });
  doc.fillColor(COLORS.ink).font("Times-Roman").fontSize(8);
  let my = y0 + 18;
  for (const [k, v] of meta) {
    doc.fillColor(COLORS.muted).text(k, rightX, my, { width: 150, align: "right" });
    doc.fillColor(COLORS.ink).text(v, rightX, my + 9, { width: 150, align: "right" });
    my += 20;
  }
  const bottom = Math.max(y0 + 56, my);
  doc.moveTo(opts.margin, bottom).lineTo(opts.width - opts.margin, bottom).strokeColor(COLORS.rule).lineWidth(1.2).stroke();
  return bottom + 14;
}

export function drawFooter(doc: PDFKit.PDFDocument, clinic: ClinicSettings, width: number, height: number, margin: number, extra = ""): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = height - margin + 4;
    doc.moveTo(margin, y - 10).lineTo(width - margin, y - 10).strokeColor(COLORS.line).lineWidth(0.6).stroke();
    doc.font("Times-Roman").fontSize(7).fillColor(COLORS.muted);
    doc.text(extra || clinic.invoiceFooter || APP_NAME, margin, y - 8, { width: width - margin * 2 - 80 });
    doc.text(`Page ${i + 1} of ${range.count}`, width - margin - 80, y - 8, { width: 80, align: "right" });
  }
}

export function patientBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  fields: Array<[string, string]>,
): number {
  doc.roundedRect(x, y, width, 8 + fields.length * 12, 2).fillAndStroke("#F7F4EE", COLORS.line);
  let yy = y + 6;
  for (const [k, v] of fields) {
    doc.font("Times-Bold").fontSize(8).fillColor(COLORS.muted).text(k, x + 8, yy, { width: 90, continued: false });
    doc.font("Times-Roman").fontSize(9).fillColor(COLORS.ink).text(v || "—", x + 100, yy, { width: width - 112 });
    yy += 12;
  }
  return yy + 8;
}

export function sectionTitle(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number): number {
  doc.font("Times-Bold").fontSize(10).fillColor(COLORS.accent).text(text, x, y, { width });
  doc.moveTo(x, y + 13).lineTo(x + width, y + 13).strokeColor(COLORS.line).lineWidth(0.5).stroke();
  return y + 18;
}

export function money(v: number): string {
  return formatPaisa(v);
}

export function loadLogo(clinic: ClinicSettings): Buffer | null {
  if (!clinic.logoPath) return null;
  try {
    if (fs.existsSync(clinic.logoPath)) return fs.readFileSync(clinic.logoPath);
  } catch {
    return null;
  }
  return null;
}

export function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number, pageH: number, margin: number, headerY: number): number {
  if (y + needed < pageH - margin - 28) return y;
  doc.addPage();
  return headerY;
}
