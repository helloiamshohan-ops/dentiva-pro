import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import { pageSize, type PageKind } from "../../src/core/documents/engine.ts";
import type { DentivaApp } from "../../src/core/app.ts";

function mediaBox(buf: Buffer): { w: number; h: number } | null {
  const s = buf.toString("latin1");
  const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  if (!m) return null;
  return { w: Number(m[3]), h: Number(m[4]) };
}

describe("PDF layout / paper sizes", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("emits A4, A5, Letter and 80mm MediaBox sizes for invoice and receipt", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const patient = app.patients.create(actor, { fullName: "Paper Case", ignoreDuplicateWarning: true });
    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "Consultation", quantity: 1, unitPricePaisa: 50000, discountPaisa: 0 }],
    });
    const pay = app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "cash",
      amountPaisa: 50000,
      paidAt: new Date().toISOString(),
    });

    const kinds: PageKind[] = ["A4", "A5", "Letter", "80mm"];
    for (const kind of kinds) {
      const expected = pageSize(kind);
      const invoice = await app.pdfInvoice(actor, inv.id, kind);
      const receipt = await app.pdfReceipt(actor, pay.receipt.id, kind);
      const statement = await app.pdfStatement(actor, patient.id, undefined, undefined, kind === "80mm" ? "A4" : kind);
      for (const buf of [invoice, receipt, statement]) {
        expect(buf.subarray(0, 4).toString()).toBe("%PDF");
        const box = mediaBox(buf);
        expect(box).toBeTruthy();
        if (kind !== "80mm" && buf === statement && kind === "A4") {
          expect(Math.abs((box as { w: number }).w - expected.width)).toBeLessThan(2);
        }
        if (buf === invoice || buf === receipt) {
          expect(Math.abs((box as { w: number }).w - expected.width)).toBeLessThan(2);
        }
      }
    }
  });
});
