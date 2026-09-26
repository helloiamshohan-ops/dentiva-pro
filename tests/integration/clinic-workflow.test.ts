import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("clinic workflow", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("runs patient → visit 1 → Rx → invoice → partial payment → visit 2 without mutating visit 1", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;

    const patient = app.patients.create(actor, {
      fullName: "Ayesha Karim",
      phone: "01711112222",
      dateOfBirth: "1990-03-12",
      gender: "Female",
      ignoreDuplicateWarning: true,
      medical: { allergies: "Penicillin", allergyAlert: true },
    });
    expect(patient.code).toMatch(/^P-\d{6}$/);
    expect(patient.allergyAlert).toBe(true);

    const v1 = app.clinical.createVisit(actor, {
      patientId: patient.id,
      visitedAt: new Date("2026-01-10T09:00:00+06:00").toISOString(),
      chiefComplaint: "Pain On lower right",
      findings: "Caries 46",
      diagnosis: "Deep caries 46",
      treatmentPerformed: "Excavation",
    });
    const rx1 = app.clinical.createPrescription(actor, {
      patientId: patient.id,
      visitId: v1.id,
      prescribedAt: v1.visitedAt,
      cc_pain_on: true,
      oe_carries: true,
      advice: "Warm saline",
      medications: [{ medicine: "Amoxicillin", strength: "500mg", dosage: "1 cap", frequency: "TDS", duration: "5 days" }],
    });
    expect(rx1.cc.cc_pain_on).toBe(true);

    const inv1 = app.billing.createInvoice(actor, {
      patientId: patient.id,
      visitId: v1.id,
      issuedAt: v1.visitedAt,
      issue: true,
      lines: [{ description: "Composite Filling (Posterior)", quantity: 1, unitPricePaisa: 250000, discountPaisa: 0 }],
    });
    expect(inv1.totalPaisa).toBe(250000);
    expect(inv1.subtotalPaisa - inv1.discountPaisa + inv1.taxPaisa).toBe(inv1.totalPaisa);

    const pay1 = app.billing.receivePayment(actor, {
      invoiceId: inv1.id,
      method: "bkash",
      amountPaisa: 100000,
      paidAt: new Date().toISOString(),
      idempotencyKey: "pay-1",
    });
    expect(pay1.invoice.duePaisa).toBe(150000);
    expect(pay1.receipt.amountPaisa).toBe(100000);
    const dup = app.billing.receivePayment(actor, {
      invoiceId: inv1.id,
      method: "bkash",
      amountPaisa: 100000,
      paidAt: new Date().toISOString(),
      idempotencyKey: "pay-1",
    });
    expect(dup.payment.id).toBe(pay1.payment.id);

    const v2 = app.clinical.createVisit(actor, {
      patientId: patient.id,
      visitedAt: new Date("2026-02-10T09:00:00+06:00").toISOString(),
      chiefComplaint: "Review",
      findings: "Healing well",
      treatmentPerformed: "Polish",
    });
    expect(v2.id).not.toBe(v1.id);
    const still = app.clinical.getVisit(actor, v1.id);
    expect(still.findings).toBe("Caries 46");
    expect(still.treatmentPerformed).toBe("Excavation");

    app.clinical.createPrescription(actor, {
      patientId: patient.id,
      visitId: v2.id,
      prescribedAt: v2.visitedAt,
      oe_gingivitis: true,
      advice: "Continue hygiene",
      medications: [{ medicine: "Chlorhexidine", dosage: "rinse", frequency: "BD", duration: "7 days" }],
    });
    const inv2 = app.billing.createInvoice(actor, {
      patientId: patient.id,
      visitId: v2.id,
      issuedAt: v2.visitedAt,
      issue: true,
      lines: [{ description: "Review polish", quantity: 1, unitPricePaisa: 80000, discountPaisa: 0 }],
    });
    expect(inv2.number).not.toBe(inv1.number);

    const tl = app.clinical.timeline(actor, patient.id, 1, 50);
    expect(tl.total).toBeGreaterThanOrEqual(6);
    const p360 = app.patients.get(actor, patient.id);
    expect(p360.code).toBe(patient.code);
    expect(p360.outstandingPaisa).toBe(150000 + 80000);
  });

  it("detects duplicate patients and does not auto-merge", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    app.patients.create(actor, { fullName: "Nadia Islam", phone: "01820000000", ignoreDuplicateWarning: true });
    expect(() =>
      app.patients.create(actor, { fullName: "Nadia Islam", phone: "01820000000" }),
    ).toThrow(/duplicate/i);
  });

  it("refuses receptionist refunds in the service layer", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const rec = await app.auth.createStaff(actor, {
      name: "Rina",
      role: "receptionist",
      username: "rina",
      password: "reception1",
    });
    const login = await app.auth.login({ username: "rina", password: "reception1" });
    const recActor = app.auth.touch(login.token).actor;
    const patient = app.patients.create(recActor, { fullName: "Test Patient", ignoreDuplicateWarning: true });
    const inv = app.billing.createInvoice(recActor, {
      patientId: patient.id,
      issuedAt: new Date().toISOString(),
      issue: true,
      lines: [{ description: "Exam", quantity: 1, unitPricePaisa: 50000, discountPaisa: 0 }],
    });
    app.billing.receivePayment(recActor, {
      invoiceId: inv.id,
      method: "cash",
      amountPaisa: 50000,
      paidAt: new Date().toISOString(),
    });
    expect(() =>
      app.billing.refund(recActor, {
        invoiceId: inv.id,
        amountPaisa: 1000,
        refundedAt: new Date().toISOString(),
        reason: "test",
      }),
    ).toThrow(/permission/i);
    void rec;
  });

  it("prevents overlapping dentist appointments", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const p = app.patients.create(actor, { fullName: "Slot Test", ignoreDuplicateWarning: true });
    const start = new Date("2026-05-01T10:00:00+06:00").toISOString();
    app.schedule.createAppointment(actor, {
      patientId: p.id,
      dentistId: actor.staffId,
      startsAt: start,
      durationMinutes: 30,
    });
    expect(() =>
      app.schedule.createAppointment(actor, {
        patientId: p.id,
        dentistId: actor.staffId,
        startsAt: new Date("2026-05-01T10:15:00+06:00").toISOString(),
        durationMinutes: 30,
      }),
    ).toThrow(/already has an appointment/i);
  });

  it("assigns race-safe queue serials", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const a = app.patients.create(actor, { fullName: "Q1", ignoreDuplicateWarning: true });
    const b = app.patients.create(actor, { fullName: "Q2", ignoreDuplicateWarning: true });
    const q1 = app.schedule.enqueue(actor, a.id);
    const q2 = app.schedule.enqueue(actor, b.id);
    expect(q2.serial).toBe(q1.serial + 1);
    const again = app.schedule.enqueue(actor, a.id);
    expect(again.id).toBe(q1.id);
  });

  it("blocks negative stock", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;
    const item = app.inventory.createItem(actor, { sku: "GLOVE-1", name: "Gloves" });
    expect(() => app.inventory.adjustStock(actor, { itemId: item.id, delta: -1, reason: "use", type: "use" })).toThrow(/negative/i);
  });
});
