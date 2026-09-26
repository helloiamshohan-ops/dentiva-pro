import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("RBAC and financial tax", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("forbids dentist refunds and applies clinic tax_rate_bps on issue", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    await app.auth.createStaff(actor, {
      name: "Dr. Nila",
      username: "nila",
      password: "correct-horse-battery",
      role: "dentist",
    });
    const dent = await app.auth.login({ username: "nila", password: "correct-horse-battery" });
    const dActor = app.auth.touch(dent.token).actor;
    const patient = app.patients.create(dActor, { fullName: "RBAC Patient", ignoreDuplicateWarning: true });
    await app.clinic.update(actor, { taxRateBps: 1500 });
    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "Crown", quantity: 1, unitPricePaisa: 100000, discountPaisa: 0 }],
    });
    expect(inv.taxPaisa).toBe(15000);
    expect(inv.totalPaisa).toBe(115000);
    app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "cash",
      amountPaisa: 115000,
      paidAt: new Date().toISOString(),
    });
    expect(() =>
      app.billing.refund(dActor, {
        invoiceId: inv.id,
        amountPaisa: 1000,
        refundedAt: new Date().toISOString(),
        reason: "should fail",
      }),
    ).toThrow(/permission/i);
  });
});
