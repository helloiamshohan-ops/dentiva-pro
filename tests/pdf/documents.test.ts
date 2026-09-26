import { describe, expect, it } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";

function pdfExtract(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const decoded = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((m) => {
      try {
        return Buffer.from(m[1]!, "hex").toString("latin1");
      } catch {
        return "";
      }
    })
    .join(" ");
  return `${raw}\n${decoded}`;
}

describe("PDF documents", () => {
  it("generates prescription, invoice, receipt and statement with required labels", async () => {
    const { app, actor, dir } = await bootApp();
    await app.clinic.update(actor, { clinicName: "Banani Dental Studio", dentistName: "Dr. Rahman", dentistQualifications: "BDS" });
    const patient = app.patients.create(actor, {
      fullName: "Farhana Ahmed",
      phone: "01710000000",
      dateOfBirth: "1988-01-01",
      gender: "Female",
      ignoreDuplicateWarning: true,
    });
    const rx = app.clinical.createPrescription(actor, {
      patientId: patient.id,
      prescribedAt: new Date().toISOString(),
      cc_pain_on: true,
      cc_swelling: true,
      oe_carries: true,
      oe_gingivitis: true,
      re_notes: "Vitality test pending",
      advice: "Avoid hard food",
      medications: [
        { medicine: "Ibuprofen", strength: "400mg", dosage: "1 tab", frequency: "TDS", duration: "3 days", instructions: "After food" },
      ],
    });
    const rxPdf = await app.pdfPrescription(actor, rx.id);
    const rxText = pdfExtract(rxPdf);
    const compact = rxText.replace(/\s+/g, "");
    expect(rxText).toContain("PRESCRIPTION");
    expect(rxText).toContain(patient.code);
    expect(compact).toContain("Farhana");
    expect(compact).toContain("PainOn");
    expect(rxText).toContain("G. Carries");
    expect(rxText).toContain("Carries");
    expect(compact).toContain("Ibuprofen");
    expect(rxText).not.toMatch(/Subtotal|INVOICE/);

    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      discountPaisa: 10000,
      lines: [
        { description: "Root Canal Treatment (Posterior)", tooth: "46", quantity: 1, unitPricePaisa: 800000, discountPaisa: 0 },
      ],
    });
    const pay = app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "nagad",
      amountPaisa: 300000,
      paidAt: new Date().toISOString(),
    });
    const invPdf = await app.pdfInvoice(actor, inv.id);
    const invText = pdfExtract(invPdf).replace(/\s+/g, "");
    expect(invText).toContain("INVOICE");
    expect(invText).toContain(inv.number);
    expect(invText).toContain(patient.code);
    expect(inv.subtotalPaisa - inv.discountPaisa + inv.taxPaisa).toBe(inv.totalPaisa);

    const rctPdf = await app.pdfReceipt(actor, pay.receipt.id);
    const rctText = pdfExtract(rctPdf).replace(/\s+/g, "");
    expect(rctText).toContain("PAYMENTRECEIVED");
    expect(rctText).toContain(pay.receipt.number);
    expect(rctText).toContain(patient.code);

    const thermal = await app.pdfReceipt(actor, pay.receipt.id, "80mm");
    expect(thermal.length).toBeGreaterThan(200);

    const stPdf = await app.pdfStatement(actor, patient.id);
    const stText = pdfExtract(stPdf).replace(/\s+/g, "");
    expect(stText).toContain("STATEMENT");
    expect(stText).toContain(patient.code);

    cleanup(app, dir);
  });
});
