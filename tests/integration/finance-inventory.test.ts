import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("finance and inventory", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("refuses payment greater than due and does not rewrite issued invoices", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const patient = app.patients.create(actor, { fullName: "Pay Cap", ignoreDuplicateWarning: true });
    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "Exam", quantity: 1, unitPricePaisa: 10000, discountPaisa: 0 }],
    });
    expect(() =>
      app.billing.receivePayment(actor, {
        invoiceId: inv.id,
        method: "cash",
        amountPaisa: 10001,
        paidAt: new Date().toISOString(),
      }),
    ).toThrow(/greater than the amount due/i);
    expect(() =>
      app.billing.updateInvoice(actor, inv.id, {
        patientId: patient.id,
        issuedAt: inv.issuedAt,
        lines: [{ description: "Changed", quantity: 1, unitPricePaisa: 1, discountPaisa: 0 }],
      }),
    ).toThrow(/cannot be rewritten/i);
    const still = app.billing.getInvoice(actor, inv.id);
    expect(still.totalPaisa).toBe(10000);
    expect(still.paidPaisa).toBe(0);
  });

  it("voids an unpaid invoice and blocks void after payment", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const patient = app.patients.create(actor, { fullName: "Void Case", ignoreDuplicateWarning: true });
    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "X-Ray", quantity: 1, unitPricePaisa: 40000, discountPaisa: 0 }],
    });
    const voided = app.billing.voidInvoice(actor, inv.id, "Entered on wrong patient");
    expect(voided.status).toBe("void");
    expect(voided.duePaisa).toBe(0);
    const paid = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "Consult", quantity: 1, unitPricePaisa: 50000, discountPaisa: 0 }],
    });
    app.billing.receivePayment(actor, {
      invoiceId: paid.id,
      method: "nagad",
      amountPaisa: 50000,
      paidAt: new Date().toISOString(),
    });
    expect(() => app.billing.voidInvoice(actor, paid.id, "too late")).toThrow(/payments/i);
  });

  it("receives a purchase that increases stock and refuses a later negative issue", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const item = app.inventory.createItem(actor, { sku: "ANES-1", name: "Lidocaine" });
    const po = app.inventory.createPurchase(actor, {
      purchasedAt: new Date("2026-03-01T09:00:00+06:00").toISOString(),
      lines: [{ itemId: item.id, quantity: 10, unitCostPaisa: 2500, batchCode: "B1", expiryDate: "2027-01-01" }],
    });
    expect(String((po as unknown as { number: string }).number)).toMatch(/^PO-/);
    const after = app.inventory.getItem(actor, item.id);
    expect(after.quantity).toBe(10);
    app.inventory.adjustStock(actor, { itemId: item.id, delta: -3, reason: "clinic use", type: "use" });
    expect(app.inventory.getItem(actor, item.id).quantity).toBe(7);
    expect(() => app.inventory.adjustStock(actor, { itemId: item.id, delta: -8, reason: "over-issue", type: "use" })).toThrow(/negative/i);
    expect(app.inventory.getItem(actor, item.id).quantity).toBe(7);
  });

  it("will not deactivate the last administrator", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    expect(() => app.auth.updateStaff(actor, actor.staffId, { active: false })).toThrow(/at least one active administrator/i);
  });

  it("imports patients from CSV without mixing identity numbers", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const csv = "fullName,phone\nHasina Begum,01710001111\nKarim Uddin,01710002222\n";
    const preview = app.importexport.previewCsv(csv);
    expect(preview.headers).toContain("fullName");
    expect(preview.rows).toHaveLength(2);
    const result = app.importexport.importPatients(actor, csv, preview.mapping, true);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    const listed = app.patients.list(actor, { search: "Hasina", page: 1, pageSize: 10 });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((p) => /^P-\d{6}$/.test(p.code) && p.fullName.includes("Hasina"))).toBe(true);
    const exported = app.importexport.exportPatientsCsv(actor);
    expect(exported.charCodeAt(0)).toBe(0xfeff);
    expect(exported).toMatch(/Hasina Begum/);
  });

  it("resolves patients by code for queue enqueue", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const p = app.patients.create(actor, { fullName: "Queue Code", ignoreDuplicateWarning: true });
    const found = app.patients.resolve(actor, p.code);
    expect(found.id).toBe(p.id);
    const q = app.schedule.enqueue(actor, found.id);
    expect(q.serial).toBe(1);
  });
});
