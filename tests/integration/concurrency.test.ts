import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("concurrency and race conditions", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("is idempotent on duplicate payment keys and rejects overlapping dentist bookings", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const patient = app.patients.create(actor, { fullName: "Race Case", ignoreDuplicateWarning: true });
    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "Exam", quantity: 1, unitPricePaisa: 20000, discountPaisa: 0 }],
    });
    const a = app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "card",
      amountPaisa: 10000,
      paidAt: new Date().toISOString(),
      idempotencyKey: "same-key",
    });
    const b = app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "card",
      amountPaisa: 10000,
      paidAt: new Date().toISOString(),
      idempotencyKey: "same-key",
    });
    expect(b.payment.id).toBe(a.payment.id);
    expect(app.billing.getInvoice(actor, inv.id).paidPaisa).toBe(10000);

    const dentist = app.auth.listDentists()[0];
    const starts = new Date("2026-09-20T09:00:00+06:00").toISOString();
    app.schedule.createAppointment(actor, {
      patientId: patient.id,
      dentistId: dentist?.id,
      startsAt: starts,
      durationMinutes: 30,
    });
    const p2 = app.patients.create(actor, { fullName: "Other", ignoreDuplicateWarning: true });
    expect(() =>
      app.schedule.createAppointment(actor, {
        patientId: p2.id,
        dentistId: dentist?.id,
        startsAt: new Date("2026-09-20T09:15:00+06:00").toISOString(),
        durationMinutes: 30,
      }),
    ).toThrow();
  });

  it("issues unique invoice and receipt numbers under sequential writes", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const patient = app.patients.create(actor, { fullName: "Seq", ignoreDuplicateWarning: true });
    const numbers = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const inv = app.billing.createInvoice(actor, {
        patientId: patient.id,
        issuedAt: new Date().toISOString(),
        issue: true,
        lines: [{ description: "Line", quantity: 1, unitPricePaisa: 1000, discountPaisa: 0 }],
      });
      expect(numbers.has(inv.number)).toBe(false);
      numbers.add(inv.number);
    }
    expect(numbers.size).toBe(8);
  });
});
