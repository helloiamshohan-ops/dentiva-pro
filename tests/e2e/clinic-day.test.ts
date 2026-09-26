import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("real clinic end-to-end day", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("runs setup → patient 360 → visit 1 → chart → Rx → plan → booking → queue → invoice → payments → visit 2 isolated → documents → backup", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, actor } = ctx;

    await app.clinic.update(actor, {
      clinicName: "Banani Dental Studio",
      address: "Banani, Dhaka",
      phone: "01700000000",
      dentistName: "Dr. Rahman",
      dentistQualifications: "BDS",
      paperSize: "A4",
      taxRateBps: 0,
    });

    const patient = app.patients.create(actor, {
      fullName: "Nusrat Jahan",
      phone: "01719998888",
      dateOfBirth: "1992-06-15",
      gender: "Female",
      ignoreDuplicateWarning: true,
      medical: { allergies: "None", allergyAlert: false },
    });
    expect(patient.code).toMatch(/^P-\d{6}$/);

    app.clinical.setTooth(actor, patient.id, "46", "caries", "Occlusal");
    const chart = app.clinical.getChart(actor, patient.id);
    expect(chart.some((t) => t.toothFdi === "46" && t.state === "caries")).toBe(true);

    const v1 = app.clinical.createVisit(actor, {
      patientId: patient.id,
      visitedAt: new Date("2026-09-01T09:00:00+06:00").toISOString(),
      chiefComplaint: "Pain On lower right",
      findings: "Caries 46",
      diagnosis: "Deep caries 46",
      treatmentPerformed: "Excavation",
      procedures: [{ name: "Composite Filling (Posterior)", tooth: "46" }],
    });
    expect(app.clinical.getVisit(actor, v1.id).procedures).toHaveLength(1);

    const rx = app.clinical.createPrescription(actor, {
      patientId: patient.id,
      visitId: v1.id,
      prescribedAt: v1.visitedAt,
      cc_pain_on: true,
      cc_g_carries: true,
      cc_swelling: false,
      cc_gum_bleeding: false,
      cc_bad_breath: false,
      cc_sensitivity: true,
      cc_notes: "Pain On chewing",
      oe_carries: true,
      oe_g_carries: false,
      oe_bdr: false,
      oe_bdc: false,
      oe_gingivitis: true,
      oe_parodental_pocket: false,
      oe_periodontitis: false,
      oe_impacted_teeth: false,
      oe_dry_socket: false,
      oe_attrition: false,
      oe_erosion: false,
      oe_notes: "46 occlusal",
      re_notes: "Vital",
      advice: "Avoid hard food",
      medications: [
        {
          medicine: "Ibuprofen",
          strength: "400mg",
          dosage: "1 tab",
          route: "PO",
          frequency: "TDS",
          duration: "3 days",
          timing: "After food",
          instructions: "With water",
        },
      ],
    });
    expect(rx.cc.cc_pain_on).toBe(true);
    expect(rx.oe.oe_carries).toBe(true);
    expect(rx.medications[0]?.route).toBe("PO");

    const plan = app.clinical.createPlan(actor, {
      patientId: patient.id,
      title: "46 restoration",
      items: [{ name: "Composite Filling (Posterior)", estimatedPaisa: 250000, tooth: "46" }],
    }) as unknown as { id: string };
    app.clinical.setPlanStatus(actor, plan.id, "presented");

    const dentists = app.auth.listDentists();
    const chairs = app.schedule.listChairs() as Array<{ id: string }>;
    const rooms = app.schedule.listRooms() as Array<{ id: string }>;
    const appt = app.schedule.createAppointment(actor, {
      patientId: patient.id,
      dentistId: dentists[0]?.id,
      chairId: chairs[0]?.id,
      roomId: rooms[0]?.id,
      startsAt: new Date("2026-09-01T10:00:00+06:00").toISOString(),
      durationMinutes: 30,
      appointmentType: "Treatment",
    });
    expect(appt.status).toBe("scheduled");

    const q = app.schedule.enqueue(actor, patient.id, appt.id, "Arrived");
    expect(q.serial).toBeGreaterThan(0);
    expect(String(q.serial)).not.toBe(patient.code);

    const inv = app.billing.createInvoice(actor, {
      patientId: patient.id,
      visitId: v1.id,
      issuedAt: v1.visitedAt,
      issue: true,
      lines: [
        { description: "Composite Filling (Posterior)", tooth: "46", quantity: 1, unitPricePaisa: 250000, discountPaisa: 0 },
        { description: "X-Ray (Periapical)", quantity: 1, unitPricePaisa: 40000, discountPaisa: 0 },
      ],
    });
    expect(inv.subtotalPaisa - inv.discountPaisa + inv.taxPaisa).toBe(inv.totalPaisa);
    expect(inv.totalPaisa).toBe(290000);

    const pay1 = app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "bkash",
      amountPaisa: 100000,
      paidAt: new Date("2026-09-01T11:00:00+06:00").toISOString(),
      idempotencyKey: "day-pay-1",
    });
    const pay2 = app.billing.receivePayment(actor, {
      invoiceId: inv.id,
      method: "cash",
      amountPaisa: 190000,
      paidAt: new Date("2026-09-01T11:05:00+06:00").toISOString(),
    });
    expect(pay1.invoice.duePaisa).toBe(190000);
    expect(pay2.invoice.duePaisa).toBe(0);
    expect(pay2.invoice.status).toBe("paid");

    const v2 = app.clinical.createVisit(actor, {
      patientId: patient.id,
      visitedAt: new Date("2026-09-15T09:00:00+06:00").toISOString(),
      chiefComplaint: "Review",
      findings: "Healing",
      treatmentPerformed: "Polish",
    });
    const stillV1 = app.clinical.getVisit(actor, v1.id);
    expect(stillV1.findings).toBe("Caries 46");
    expect(stillV1.treatmentPerformed).toBe("Excavation");
    expect(v2.findings).toBe("Healing");

    app.clinical.createFollowup(actor, {
      patientId: patient.id,
      visitId: v2.id,
      dueAt: new Date("2026-10-15T09:00:00+06:00").toISOString(),
      reason: "Review filling",
    });
    app.clinical.createReferral(actor, {
      patientId: patient.id,
      referredTo: "Oral surgery",
      reason: "Impacted 38 watch",
      referredAt: v2.visitedAt,
    });

    const att = app.attachments.add(actor, "patient", patient.id, "note.txt", Buffer.from("x-ray notes"), "text/plain");
    expect(att.filename).toBe("note.txt");

    const [rxPdf, invPdf, rctA4, rct80, stPdf, a5, letter] = await Promise.all([
      app.pdfPrescription(actor, rx.id, "A4"),
      app.pdfInvoice(actor, inv.id, "A4"),
      app.pdfReceipt(actor, pay1.receipt.id, "A4"),
      app.pdfReceipt(actor, pay1.receipt.id, "80mm"),
      app.pdfStatement(actor, patient.id, undefined, undefined, "A4"),
      app.pdfInvoice(actor, inv.id, "A5"),
      app.pdfInvoice(actor, inv.id, "Letter"),
    ]);
    for (const buf of [rxPdf, invPdf, rctA4, rct80, stPdf, a5, letter]) {
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(200);
    }

    const bak = await app.backup.create(actor, "end of clinic day");
    expect(bak.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(bak.path.endsWith(".dvbak")).toBe(true);

    const dash = app.ops.dashboard(actor);
    expect(dash.today).toBeTruthy();
    const hits = app.ops.search(actor, patient.code);
    expect(hits.some((h) => h.entityType === "patient" && h.entityId === patient.id)).toBe(true);
  });
});
