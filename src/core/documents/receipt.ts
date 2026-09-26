import { PAYMENT_METHOD_LABELS } from "../../shared/constants.ts";
import type { ClinicSettings, Patient, Receipt } from "../../shared/types.ts";
import { formatDateTime } from "../clock.ts";
import { formatPaisa } from "../money.ts";
import { bufferOf, COLORS, createDoc, drawFooter, drawHeader, loadLogo, pageSize, type PageKind } from "./engine.ts";

export async function renderReceiptPdf(args: {
  clinic: ClinicSettings;
  patient: Patient;
  receipt: Receipt;
  paper?: PageKind;
}): Promise<Buffer> {
  const paper = args.paper ?? "A4";
  if (paper === "80mm") return renderThermal(args);
  const size = pageSize(paper);
  const margin = 48;
  const doc = createDoc(paper);
  const { clinic, patient, receipt } = args;

  drawHeader(
    doc,
    clinic,
    "RECEIPT",
    [
      ["Number", receipt.number],
      ["Date", formatDateTime(receipt.issuedAt, clinic.timezone)],
    ],
    { width: size.width, margin, logo: loadLogo(clinic) },
  );

  const y0 = 150;
  doc.font("Times-Roman").fontSize(11).fillColor(COLORS.muted).text("PAYMENT RECEIVED", margin, y0, {
    width: size.width - margin * 2,
    align: "center",
  });
  doc.font("Times-Bold").fontSize(28).fillColor(COLORS.accent).text(formatPaisa(receipt.amountPaisa), margin, y0 + 18, {
    width: size.width - margin * 2,
    align: "center",
  });

  const boxY = y0 + 70;
  const w = size.width - margin * 2;
  doc.roundedRect(margin, boxY, w, 130, 3).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  const rows: Array<[string, string]> = [
    ["Patient code", patient.code],
    ["Received from", patient.fullName],
    ["Invoice", receipt.invoiceNumber],
    ["Method", PAYMENT_METHOD_LABELS[receipt.method]],
    ["Reference", receipt.reference || "—"],
    ["Balance remaining", formatPaisa(receipt.remainingPaisa)],
  ];
  rows.forEach(([k, v], i) => {
    const yy = boxY + 10 + i * 18;
    doc.font("Times-Roman").fontSize(9).fillColor(COLORS.muted).text(k, margin + 16, yy, { width: 160 });
    doc.font("Times-Bold").fontSize(10).fillColor(COLORS.ink).text(v, margin + 180, yy, { width: w - 210 });
  });

  drawFooter(doc, clinic, size.width, size.height, margin, clinic.receiptFooter || "Thank you. This is a payment acknowledgement, not an invoice.");
  return bufferOf(doc);
}

async function renderThermal(args: { clinic: ClinicSettings; patient: Patient; receipt: Receipt }): Promise<Buffer> {
  const size = pageSize("80mm");
  const margin = 10;
  const doc = createDoc("80mm");
  const { clinic, patient, receipt } = args;
  let y = 12;
  doc.font("Times-Bold").fontSize(11).fillColor(COLORS.ink).text(clinic.clinicName || "Dentiva Pro", margin, y, {
    width: size.width - margin * 2,
    align: "center",
  });
  y = doc.y + 2;
  doc.font("Times-Roman").fontSize(7).fillColor(COLORS.muted).text(clinic.address || "", margin, y, {
    width: size.width - margin * 2,
    align: "center",
  });
  y = doc.y + 6;
  doc.moveTo(margin, y).lineTo(size.width - margin, y).strokeColor(COLORS.ink).lineWidth(0.8).stroke();
  y += 8;
  doc.font("Times-Bold").fontSize(9).text("PAYMENT RECEIVED", margin, y, { width: size.width - margin * 2, align: "center" });
  y = doc.y + 4;
  doc.font("Times-Bold").fontSize(16).fillColor(COLORS.accent).text(formatPaisa(receipt.amountPaisa), margin, y, {
    width: size.width - margin * 2,
    align: "center",
  });
  y = doc.y + 8;
  const lines = [
    ["Receipt", receipt.number],
    ["Patient", patient.fullName],
    ["Code", patient.code],
    ["Invoice", receipt.invoiceNumber],
    ["Method", PAYMENT_METHOD_LABELS[receipt.method]],
    ["Date", formatDateTime(receipt.issuedAt, clinic.timezone)],
    ["Balance", formatPaisa(receipt.remainingPaisa)],
  ];
  for (const row of lines) {
    const k = row[0] ?? "";
    const v = row[1] ?? "";
    doc.font("Times-Roman").fontSize(7).fillColor(COLORS.muted).text(k, margin, y, { width: 54 });
    doc.fillColor(COLORS.ink).text(v, margin + 54, y, { width: size.width - margin * 2 - 54 });
    y = Math.max(doc.y, y + 11);
  }
  y += 6;
  doc.moveTo(margin, y).lineTo(size.width - margin, y).dash(1, { space: 1 }).stroke();
  doc.undash();
  y += 8;
  doc.font("Times-Roman").fontSize(7).fillColor(COLORS.muted).text(clinic.receiptFooter || "Thank you", margin, y, {
    width: size.width - margin * 2,
    align: "center",
  });
  return bufferOf(doc);
}
