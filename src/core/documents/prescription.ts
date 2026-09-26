import { CC_FIELDS, OE_FIELDS } from "../../shared/constants.ts";
import type { ClinicSettings, Patient, Prescription } from "../../shared/types.ts";
import { formatDate } from "../clock.ts";
import { ageLabel } from "../clock.ts";
import { bufferOf, COLORS, createDoc, drawFooter, drawHeader, loadLogo, pageSize, patientBlock, sectionTitle, type PageKind, ensureSpace } from "./engine.ts";

export async function renderPrescriptionPdf(args: {
  clinic: ClinicSettings;
  patient: Patient;
  prescription: Prescription;
  dentistName?: string;
  paper?: PageKind;
}): Promise<Buffer> {
  const paper: PageKind = args.paper ?? (args.clinic.paperSize === "80mm" ? "A4" : args.clinic.paperSize);
  const size = pageSize(paper);
  const margin = paper === "A5" ? 36 : 48;
  const doc = createDoc(paper);
  const logo = loadLogo(args.clinic);
  const { clinic, patient, prescription } = args;

  const headerY = drawHeader(
    doc,
    clinic,
    "PRESCRIPTION",
    [
      ["Date", formatDate(prescription.prescribedAt, clinic.timezone)],
      ["Patient", patient.code],
    ],
    { width: size.width, margin, logo },
  );

  let y = patientBlock(doc, margin, headerY, size.width - margin * 2, [
    ["Patient code", patient.code],
    ["Name", [patient.title, patient.fullName].filter(Boolean).join(" ")],
    ["Age / gender", [ageLabel(patient.dateOfBirth, clinic.timezone), patient.gender].filter(Boolean).join(" · ")],
  ]);

  y = sectionTitle(doc, "C/C", margin, y, size.width - margin * 2);
  y = drawChecks(doc, CC_FIELDS.map((f) => ({ label: f.label, on: Boolean(prescription.cc[f.key]) })), margin, y, size.width - margin * 2);
  if (prescription.cc.notes) {
    doc.font("Times-Roman").fontSize(9).fillColor(COLORS.ink).text(String(prescription.cc.notes), margin, y, { width: size.width - margin * 2 });
    y = doc.y + 8;
  }

  y = sectionTitle(doc, "O/E", margin, y + 4, size.width - margin * 2);
  y = drawChecks(doc, OE_FIELDS.map((f) => ({ label: f.label, on: Boolean(prescription.oe[f.key]) })), margin, y, size.width - margin * 2);
  if (prescription.oe.notes) {
    doc.font("Times-Roman").fontSize(9).fillColor(COLORS.ink).text(String(prescription.oe.notes), margin, y, { width: size.width - margin * 2 });
    y = doc.y + 8;
  }

  y = sectionTitle(doc, "R/E", margin, y + 4, size.width - margin * 2);
  doc.font("Times-Roman").fontSize(9).fillColor(COLORS.ink).text(prescription.reNotes || "—", margin, y, { width: size.width - margin * 2 });
  y = doc.y + 10;

  y = sectionTitle(doc, "Advice", margin, y, size.width - margin * 2);
  doc.font("Times-Roman").fontSize(9).fillColor(COLORS.ink).text(prescription.advice || "—", margin, y, { width: size.width - margin * 2 });
  y = doc.y + 12;

  y = sectionTitle(doc, "Medication", margin, y, size.width - margin * 2);
  const cols = [
    { w: 22, h: "#" },
    { w: 130, h: "Medicine" },
    { w: 60, h: "Strength" },
    { w: 50, h: "Dose" },
    { w: 50, h: "Route" },
    { w: 70, h: "Frequency" },
    { w: 50, h: "Duration" },
  ];
  const tableW = size.width - margin * 2;
  y = drawTableHeader(doc, margin, y, cols, tableW);
  const contentWidth = size.width - margin * 2;
  for (const m of prescription.medications) {
    y = ensureSpace(doc, y, 36, size.height, margin, 48);
    const rowH = 22;
    const vals = [String(m.sequence), m.medicine, m.strength, m.dosage, m.route, m.frequency, m.duration];
    let x = margin;
    doc.rect(margin, y, contentWidth, rowH).strokeColor("#E7E1D6").lineWidth(0.4).stroke();
    vals.forEach((v, i) => {
      const col = cols[i]!;
      doc.font("Times-Roman").fontSize(8).fillColor(COLORS.ink).text(v || "—", x + 3, y + 6, { width: col.w - 6, ellipsis: true });
      x += col.w;
    });
    y += rowH;
    if (m.instructions || m.timing) {
      y = ensureSpace(doc, y, 16, size.height, margin, 48);
      doc.font("Times-Italic").fontSize(8).fillColor(COLORS.muted).text([m.timing, m.instructions].filter(Boolean).join(" — "), margin + 24, y, {
        width: contentWidth - 24,
      });
      y = doc.y + 6;
    }
  }
  if (!prescription.medications.length) {
    doc.font("Times-Italic").fontSize(9).fillColor(COLORS.muted).text("No medicines recorded.", margin, y);
    y += 16;
  }

  y = ensureSpace(doc, y, 70, size.height, margin, 48);
  y += 24;
  doc.moveTo(size.width - margin - 160, y).lineTo(size.width - margin, y).strokeColor(COLORS.ink).lineWidth(0.7).stroke();
  doc.font("Times-Roman").fontSize(8).fillColor(COLORS.muted).text(args.dentistName || clinic.dentistName || "Dentist", size.width - margin - 160, y + 4, {
    width: 160,
    align: "center",
  });
  doc.text("Signature", size.width - margin - 160, y + 16, { width: 160, align: "center" });

  drawFooter(doc, clinic, size.width, size.height, margin, clinic.prescriptionFooter || "This prescription contains no financial amounts.");
  return bufferOf(doc);
}

function drawChecks(
  doc: PDFKit.PDFDocument,
  items: Array<{ label: string; on: boolean }>,
  x: number,
  y: number,
  width: number,
): number {
  const colW = width / 3;
  items.forEach((it, i) => {
    const cx = x + (i % 3) * colW;
    const cy = y + Math.floor(i / 3) * 14;
    doc.lineWidth(0.8).strokeColor(COLORS.accent);
    doc.rect(cx, cy, 7, 7).stroke();
    if (it.on) {
      doc.moveTo(cx + 1.5, cy + 3.5).lineTo(cx + 3, cy + 6).lineTo(cx + 6.2, cy + 1.5).stroke();
    }
    doc.font("Times-Roman").fontSize(8).fillColor(COLORS.ink).text(it.label, cx + 11, cy - 1, { width: colW - 14 });
  });
  return y + Math.ceil(items.length / 3) * 14 + 6;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  cols: Array<{ w: number; h: string }>,
  tableW: number,
): number {
  doc.rect(x, y, tableW, 16).fill(COLORS.accent);
  let cx = x;
  for (const c of cols) {
    doc.font("Times-Bold").fontSize(8).fillColor("#FFFFFF").text(c.h, cx + 3, y + 4, { width: c.w - 6 });
    cx += c.w;
  }
  return y + 16;
}
