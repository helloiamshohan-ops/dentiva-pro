import { z } from "zod";
import { ADULT_FDI, PRIMARY_FDI, TOOTH_STATES } from "../../shared/constants.ts";
import type { PageResult, Prescription, PrescriptionMed, TimelineEvent, ToothChartEntry, Visit } from "../../shared/types.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { parse, nonEmpty, paginationSchema, pageOffset } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit, jsonParse, jsonString, immediate } from "../db/helpers.ts";

const visitSchema = z.object({
  patientId: z.string().min(8),
  dentistId: z.string().optional(),
  visitedAt: z.string().min(10),
  chiefComplaint: z.string().max(4000).optional(),
  reason: z.string().max(2000).optional(),
  symptoms: z.string().max(4000).optional(),
  findings: z.string().max(8000).optional(),
  diagnosis: z.string().max(4000).optional(),
  treatmentPlanNotes: z.string().max(8000).optional(),
  treatmentPerformed: z.string().max(8000).optional(),
  toothNumbers: z.array(z.string().max(8)).optional(),
  anesthesia: z.string().max(500).optional(),
  medicationsNotes: z.string().max(4000).optional(),
  notes: z.string().max(8000).optional(),
  followUpNotes: z.string().max(2000).optional(),
  referralNotes: z.string().max(2000).optional(),
  status: z.enum(["open", "completed"]).optional(),
  procedures: z
    .array(
      z.object({
        treatmentId: z.string().optional(),
        tooth: z.string().optional(),
        name: nonEmpty("procedure name", 200),
        notes: z.string().max(2000).optional(),
      }),
    )
    .optional(),
});

const rxMedSchema = z.object({
  medicine: nonEmpty("medicine", 180),
  strength: z.string().max(80).optional(),
  dosage: z.string().max(80).optional(),
  route: z.string().max(80).optional(),
  frequency: z.string().max(80).optional(),
  duration: z.string().max(80).optional(),
  timing: z.string().max(80).optional(),
  instructions: z.string().max(500).optional(),
});

const rxSchema = z.object({
  patientId: z.string().min(8),
  visitId: z.string().optional(),
  dentistId: z.string().optional(),
  prescribedAt: z.string().min(10),
  cc_pain_on: z.boolean().optional(),
  cc_g_carries: z.boolean().optional(),
  cc_swelling: z.boolean().optional(),
  cc_gum_bleeding: z.boolean().optional(),
  cc_bad_breath: z.boolean().optional(),
  cc_sensitivity: z.boolean().optional(),
  cc_notes: z.string().max(2000).optional(),
  oe_carries: z.boolean().optional(),
  oe_g_carries: z.boolean().optional(),
  oe_bdr: z.boolean().optional(),
  oe_bdc: z.boolean().optional(),
  oe_gingivitis: z.boolean().optional(),
  oe_parodental_pocket: z.boolean().optional(),
  oe_periodontitis: z.boolean().optional(),
  oe_impacted_teeth: z.boolean().optional(),
  oe_dry_socket: z.boolean().optional(),
  oe_attrition: z.boolean().optional(),
  oe_erosion: z.boolean().optional(),
  oe_notes: z.string().max(2000).optional(),
  re_notes: z.string().max(4000).optional(),
  advice: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  medications: z.array(rxMedSchema).default([]),
});

export class ClinicalService {
  constructor(private readonly core: Core) {}

  listVisits(actor: Actor, patientId: string, page = 1, pageSize = 50): PageResult<Visit> {
    requirePermission(actor, "clinical.read");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const total = (this.core.db.prepare("SELECT COUNT(*) AS c FROM visits WHERE patient_id = ?").get(patientId) as { c: number }).c;
    const rows = this.core.db
      .prepare(
        `SELECT v.*, p.code AS patient_code FROM visits v
         JOIN patients p ON p.id = v.patient_id
         WHERE v.patient_id = ? ORDER BY v.visited_at DESC LIMIT ? OFFSET ?`,
      )
      .all(patientId, limit, offset) as VisitRow[];
    return { items: rows.map(toVisit), page: p.page, pageSize: p.pageSize, total };
  }

  getVisit(actor: Actor, id: string): Visit & { procedures: Array<{ id: string; name: string; tooth: string | null; notes: string }> } {
    requirePermission(actor, "clinical.read");
    const row = this.core.db
      .prepare(
        `SELECT v.*, p.code AS patient_code FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`,
      )
      .get(id) as VisitRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Visit was not found.");
    const procedures = this.core.db
      .prepare("SELECT id, name, tooth, notes FROM visit_procedures WHERE visit_id = ? ORDER BY created_at")
      .all(id) as Array<{ id: string; name: string; tooth: string | null; notes: string }>;
    return { ...toVisit(row), procedures };
  }

  createVisit(actor: Actor, input: unknown): Visit {
    requirePermission(actor, "clinical.write");
    const data = parse(visitSchema, input);
    this.assertPatient(data.patientId);
    const id = newId();
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      this.core.db
        .prepare(
          `INSERT INTO visits (
            id, patient_id, dentist_id, visited_at, chief_complaint, reason, symptoms, findings, diagnosis,
            treatment_plan_notes, treatment_performed, tooth_numbers_json, anesthesia, medications_notes, notes,
            follow_up_notes, referral_notes, status, created_at, updated_at, created_by
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          data.patientId,
          data.dentistId ?? actor.staffId,
          data.visitedAt,
          data.chiefComplaint ?? "",
          data.reason ?? "",
          data.symptoms ?? "",
          data.findings ?? "",
          data.diagnosis ?? "",
          data.treatmentPlanNotes ?? "",
          data.treatmentPerformed ?? "",
          jsonString(data.toothNumbers ?? []),
          data.anesthesia ?? "",
          data.medicationsNotes ?? "",
          data.notes ?? "",
          data.followUpNotes ?? "",
          data.referralNotes ?? "",
          data.status ?? "open",
          now,
          now,
          actor.staffId,
        );
      this.replaceProcedures(id, data.procedures);
      audit(this.core.db, actor, "visit_create", "visit", id, { patientId: data.patientId });
    });
    return this.getVisit(actor, id);
  }

  updateVisit(actor: Actor, id: string, input: unknown): Visit {
    requirePermission(actor, "clinical.write");
    const existing = this.core.db.prepare("SELECT * FROM visits WHERE id = ?").get(id) as VisitRow | undefined;
    if (!existing) throw new AppError("NOT_FOUND", "Visit was not found.");
    const data = parse(visitSchema.partial(), input);
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      this.core.db
        .prepare(
          `UPDATE visits SET
            dentist_id=?, visited_at=?, chief_complaint=?, reason=?, symptoms=?, findings=?, diagnosis=?,
            treatment_plan_notes=?, treatment_performed=?, tooth_numbers_json=?, anesthesia=?, medications_notes=?,
            notes=?, follow_up_notes=?, referral_notes=?, status=?, updated_at=?
           WHERE id=?`,
        )
        .run(
          data.dentistId ?? existing.dentist_id,
          data.visitedAt ?? existing.visited_at,
          data.chiefComplaint ?? existing.chief_complaint,
          data.reason ?? existing.reason,
          data.symptoms ?? existing.symptoms,
          data.findings ?? existing.findings,
          data.diagnosis ?? existing.diagnosis,
          data.treatmentPlanNotes ?? existing.treatment_plan_notes,
          data.treatmentPerformed ?? existing.treatment_performed,
          jsonString(data.toothNumbers ?? jsonParse(existing.tooth_numbers_json, [])),
          data.anesthesia ?? existing.anesthesia,
          data.medicationsNotes ?? existing.medications_notes,
          data.notes ?? existing.notes,
          data.followUpNotes ?? existing.follow_up_notes,
          data.referralNotes ?? existing.referral_notes,
          data.status ?? existing.status,
          now,
          id,
        );
      if (data.procedures) this.replaceProcedures(id, data.procedures);
      audit(this.core.db, actor, "visit_update", "visit", id);
    });
    return this.getVisit(actor, id);
  }

  getChart(actor: Actor, patientId: string): ToothChartEntry[] {
    requirePermission(actor, "clinical.read");
    this.assertPatient(patientId);
    const rows = this.core.db
      .prepare("SELECT tooth_fdi, dentition, state, notes FROM dental_chart WHERE patient_id = ?")
      .all(patientId) as Array<{ tooth_fdi: string; dentition: "adult" | "primary"; state: ToothChartEntry["state"]; notes: string }>;
    const map = new Map(rows.map((r) => [r.tooth_fdi, r]));
    const all: ToothChartEntry[] = [];
    for (const t of ADULT_FDI) {
      const r = map.get(t);
      all.push({ toothFdi: t, dentition: "adult", state: r?.state ?? "healthy", notes: r?.notes ?? "" });
    }
    for (const t of PRIMARY_FDI) {
      const r = map.get(t);
      all.push({ toothFdi: t, dentition: "primary", state: r?.state ?? "healthy", notes: r?.notes ?? "" });
    }
    return all;
  }

  setTooth(
    actor: Actor,
    patientId: string,
    toothFdi: string,
    state: string,
    notes = "",
    visitId?: string,
  ): void {
    requirePermission(actor, "clinical.write");
    if (![...ADULT_FDI, ...PRIMARY_FDI].includes(toothFdi as never)) {
      throw new AppError("VALIDATION", "Unknown tooth number.");
    }
    if (!(TOOTH_STATES as readonly string[]).includes(state)) {
      throw new AppError("VALIDATION", "Unknown tooth state.");
    }
    const dentition = (ADULT_FDI as readonly string[]).includes(toothFdi) ? "adult" : "primary";
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      const existing = this.core.db
        .prepare("SELECT id, state FROM dental_chart WHERE patient_id = ? AND tooth_fdi = ?")
        .get(patientId, toothFdi) as { id: string; state: string } | undefined;
      const chartId = existing?.id ?? newId();
      if (existing) {
        this.core.db
          .prepare("UPDATE dental_chart SET state = ?, notes = ?, updated_at = ? WHERE id = ?")
          .run(state, notes, now, chartId);
      } else {
        this.core.db
          .prepare(
            "INSERT INTO dental_chart (id, patient_id, tooth_fdi, dentition, state, notes, updated_at) VALUES (?,?,?,?,?,?,?)",
          )
          .run(chartId, patientId, toothFdi, dentition, state, notes, now);
      }
      this.core.db
        .prepare(
          `INSERT INTO dental_chart_history (id, chart_id, patient_id, tooth_fdi, previous_state, new_state, visit_id, at, by_staff)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(newId(), chartId, patientId, toothFdi, existing?.state ?? "healthy", state, visitId ?? null, now, actor.staffId);
      audit(this.core.db, actor, "chart_update", "dental_chart", chartId, { toothFdi, state });
    });
  }

  listPrescriptions(actor: Actor, patientId: string, page = 1, pageSize = 50): PageResult<Prescription> {
    requirePermission(actor, "clinical.read");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const total = (this.core.db.prepare("SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ?").get(patientId) as { c: number }).c;
    const ids = this.core.db
      .prepare("SELECT id FROM prescriptions WHERE patient_id = ? ORDER BY prescribed_at DESC LIMIT ? OFFSET ?")
      .all(patientId, limit, offset) as Array<{ id: string }>;
    const items = ids.map((r) => this.getPrescription(actor, r.id));
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  getPrescription(actor: Actor, id: string): Prescription {
    requirePermission(actor, "clinical.read");
    const row = this.core.db.prepare("SELECT * FROM prescriptions WHERE id = ?").get(id) as RxRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Prescription was not found.");
    const meds = this.core.db
      .prepare("SELECT * FROM prescription_medications WHERE prescription_id = ? ORDER BY sequence")
      .all(id) as MedRow[];
    return toPrescription(row, meds);
  }

  createPrescription(actor: Actor, input: unknown): Prescription {
    requirePermission(actor, "prescriptions.write");
    const data = parse(rxSchema, input);
    this.assertPatient(data.patientId);
    const id = newId();
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      this.insertRx(id, data, now, actor.staffId);
      audit(this.core.db, actor, "prescription_create", "prescription", id, { patientId: data.patientId });
    });
    return this.getPrescription(actor, id);
  }

  updatePrescription(actor: Actor, id: string, input: unknown): Prescription {
    requirePermission(actor, "prescriptions.write");
    const existing = this.core.db.prepare("SELECT id FROM prescriptions WHERE id = ?").get(id);
    if (!existing) throw new AppError("NOT_FOUND", "Prescription was not found.");
    const data = parse(rxSchema, input);
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      this.core.db.prepare("DELETE FROM prescription_medications WHERE prescription_id = ?").run(id);
      this.core.db.prepare("DELETE FROM prescriptions WHERE id = ?").run(id);
      this.insertRx(id, data, now, actor.staffId);
      audit(this.core.db, actor, "prescription_update", "prescription", id);
    });
    return this.getPrescription(actor, id);
  }

  listPlans(actor: Actor, patientId: string) {
    requirePermission(actor, "clinical.read");
    return this.core.db
      .prepare("SELECT * FROM treatment_plans WHERE patient_id = ? ORDER BY created_at DESC")
      .all(patientId);
  }

  createPlan(actor: Actor, input: unknown) {
    requirePermission(actor, "clinical.write");
    const schema = z.object({
      patientId: z.string().min(8),
      title: z.string().max(180).optional(),
      notes: z.string().max(4000).optional(),
      items: z.array(
        z.object({
          treatmentId: z.string().optional(),
          tooth: z.string().optional(),
          name: nonEmpty("item name", 200),
          notes: z.string().max(1000).optional(),
          estimatedPaisa: z.number().int().min(0),
        }),
      ),
    });
    const data = parse(schema, input);
    const id = newId();
    const now = this.core.clock().toISOString();
    const total = data.items.reduce((s, i) => s + i.estimatedPaisa, 0);
    immediate(this.core.db, () => {
      this.core.db
        .prepare(
          `INSERT INTO treatment_plans (id, patient_id, title, status, estimated_total_paisa, notes, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
        )
        .run(id, data.patientId, data.title ?? "Treatment plan", total, data.notes ?? "", now, now);
      data.items.forEach((item, idx) => {
        this.core.db
          .prepare(
            `INSERT INTO treatment_plan_items (id, plan_id, treatment_id, tooth, sequence, name, notes, estimated_paisa, status)
             VALUES (?,?,?,?,?,?,?,?, 'planned')`,
          )
          .run(newId(), id, item.treatmentId ?? null, item.tooth ?? null, idx + 1, item.name, item.notes ?? "", item.estimatedPaisa);
      });
      audit(this.core.db, actor, "plan_create", "treatment_plan", id);
    });
    return this.getPlan(actor, id);
  }

  getPlan(actor: Actor, id: string) {
    requirePermission(actor, "clinical.read");
    const plan = this.core.db.prepare("SELECT * FROM treatment_plans WHERE id = ?").get(id);
    if (!plan) throw new AppError("NOT_FOUND", "Treatment plan was not found.");
    const items = this.core.db
      .prepare("SELECT * FROM treatment_plan_items WHERE plan_id = ? ORDER BY sequence")
      .all(id);
    return { ...(plan as object), items };
  }

  setPlanStatus(actor: Actor, id: string, status: string) {
    requirePermission(actor, "clinical.write");
    const allowed = ["draft", "presented", "accepted", "rejected", "converted", "cancelled"];
    if (!allowed.includes(status)) throw new AppError("VALIDATION", "Unknown plan status.");
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE treatment_plans SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    audit(this.core.db, actor, "plan_status", "treatment_plan", id, { status });
    return this.getPlan(actor, id);
  }

  createReferral(actor: Actor, input: unknown) {
    requirePermission(actor, "clinical.write");
    const schema = z.object({
      patientId: z.string().min(8),
      visitId: z.string().optional(),
      source: z.string().max(180).optional(),
      referredTo: z.string().max(180).optional(),
      reason: z.string().max(2000).optional(),
      referredAt: z.string().min(10),
      notes: z.string().max(2000).optional(),
    });
    const data = parse(schema, input);
    const id = newId();
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare(
        `INSERT INTO referrals (id, patient_id, visit_id, source, referred_to, reason, referred_at, notes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, data.patientId, data.visitId ?? null, data.source ?? "", data.referredTo ?? "", data.reason ?? "", data.referredAt, data.notes ?? "", now);
    audit(this.core.db, actor, "referral_create", "referral", id);
    return this.core.db.prepare("SELECT * FROM referrals WHERE id = ?").get(id);
  }

  listReferrals(actor: Actor, patientId: string) {
    requirePermission(actor, "clinical.read");
    return this.core.db.prepare("SELECT * FROM referrals WHERE patient_id = ? ORDER BY referred_at DESC").all(patientId);
  }

  createFollowup(actor: Actor, input: unknown) {
    requirePermission(actor, "clinical.write");
    const schema = z.object({
      patientId: z.string().min(8),
      visitId: z.string().optional(),
      dueAt: z.string().min(10),
      reason: z.string().max(500).optional(),
      instruction: z.string().max(2000).optional(),
      notes: z.string().max(2000).optional(),
    });
    const data = parse(schema, input);
    const id = newId();
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare(
        `INSERT INTO followups (id, patient_id, visit_id, due_at, reason, instruction, status, notes, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?)`,
      )
      .run(id, data.patientId, data.visitId ?? null, data.dueAt, data.reason ?? "", data.instruction ?? "", data.notes ?? "", now);
    audit(this.core.db, actor, "followup_create", "followup", id);
    return this.core.db.prepare("SELECT * FROM followups WHERE id = ?").get(id);
  }

  completeFollowup(actor: Actor, id: string, notes?: string) {
    requirePermission(actor, "clinical.write");
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare("UPDATE followups SET status = 'completed', completed_at = ?, notes = COALESCE(?, notes) WHERE id = ?")
      .run(now, notes ?? null, id);
    audit(this.core.db, actor, "followup_complete", "followup", id);
  }

  listFollowups(actor: Actor, filter: { patientId?: string; status?: string; page?: number; pageSize?: number }) {
    requirePermission(actor, "clinical.read");
    const p = parse(paginationSchema, { page: filter.page ?? 1, pageSize: filter.pageSize ?? 50 });
    const { limit, offset } = pageOffset(p);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.patientId) {
      clauses.push("patient_id = ?");
      params.push(filter.patientId);
    }
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.core.db.prepare(`SELECT COUNT(*) AS c FROM followups ${where}`).get(...params) as { c: number }).c;
    const items = this.core.db
      .prepare(`SELECT * FROM followups ${where} ORDER BY due_at LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  timeline(actor: Actor, patientId: string, page = 1, pageSize = 50): PageResult<TimelineEvent> {
    requirePermission(actor, "patients.read");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const sql = `
      SELECT id, at, kind, title, body, entity_type, entity_id FROM (
        SELECT id, visited_at AS at, 'visit' AS kind, 'Visit' AS title, IFNULL(chief_complaint, '') AS body, 'visit' AS entity_type, id AS entity_id FROM visits WHERE patient_id = ?
        UNION ALL
        SELECT id, prescribed_at, 'prescription', 'Prescription', IFNULL(advice, ''), 'prescription', id FROM prescriptions WHERE patient_id = ?
        UNION ALL
        SELECT id, issued_at, 'invoice', 'Invoice ' || number, '', 'invoice', id FROM invoices WHERE patient_id = ? AND status != 'void'
        UNION ALL
        SELECT id, paid_at, 'payment', 'Payment', '', 'payment', id FROM payments WHERE patient_id = ?
        UNION ALL
        SELECT id, starts_at, 'appointment', 'Appointment', IFNULL(notes, ''), 'appointment', id FROM appointments WHERE patient_id = ?
        UNION ALL
        SELECT id, referred_at, 'referral', 'Referral', IFNULL(reason, ''), 'referral', id FROM referrals WHERE patient_id = ?
        UNION ALL
        SELECT id, due_at, 'followup', 'Follow-up', IFNULL(reason, ''), 'followup', id FROM followups WHERE patient_id = ?
        UNION ALL
        SELECT id, created_at, 'attachment', filename, '', 'attachment', id FROM attachments WHERE entity_type = 'patient' AND entity_id = ?
      ) e
      ORDER BY at DESC
      LIMIT ? OFFSET ?`;
    const params = [patientId, patientId, patientId, patientId, patientId, patientId, patientId, patientId, limit, offset];
    const items = this.core.db.prepare(sql).all(...params) as TimelineEvent[];
    const countSql = `
      SELECT (
        (SELECT COUNT(*) FROM visits WHERE patient_id = ?) +
        (SELECT COUNT(*) FROM prescriptions WHERE patient_id = ?) +
        (SELECT COUNT(*) FROM invoices WHERE patient_id = ? AND status != 'void') +
        (SELECT COUNT(*) FROM payments WHERE patient_id = ?) +
        (SELECT COUNT(*) FROM appointments WHERE patient_id = ?) +
        (SELECT COUNT(*) FROM referrals WHERE patient_id = ?) +
        (SELECT COUNT(*) FROM followups WHERE patient_id = ?) +
        (SELECT COUNT(*) FROM attachments WHERE entity_type = 'patient' AND entity_id = ?)
      ) AS c`;
    const total = (this.core.db.prepare(countSql).get(patientId, patientId, patientId, patientId, patientId, patientId, patientId, patientId) as { c: number }).c;
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  private insertRx(id: string, data: z.infer<typeof rxSchema>, now: string, staffId: string): void {
    this.core.db
      .prepare(
        `INSERT INTO prescriptions (
          id, patient_id, visit_id, dentist_id, prescribed_at,
          cc_pain_on, cc_g_carries, cc_swelling, cc_gum_bleeding, cc_bad_breath, cc_sensitivity, cc_notes,
          oe_carries, oe_g_carries, oe_bdr, oe_bdc, oe_gingivitis, oe_parodental_pocket, oe_periodontitis,
          oe_impacted_teeth, oe_dry_socket, oe_attrition, oe_erosion, oe_notes, re_notes, advice, notes,
          created_at, updated_at, created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        data.patientId,
        data.visitId ?? null,
        data.dentistId ?? staffId,
        data.prescribedAt,
        data.cc_pain_on ? 1 : 0,
        data.cc_g_carries ? 1 : 0,
        data.cc_swelling ? 1 : 0,
        data.cc_gum_bleeding ? 1 : 0,
        data.cc_bad_breath ? 1 : 0,
        data.cc_sensitivity ? 1 : 0,
        data.cc_notes ?? "",
        data.oe_carries ? 1 : 0,
        data.oe_g_carries ? 1 : 0,
        data.oe_bdr ? 1 : 0,
        data.oe_bdc ? 1 : 0,
        data.oe_gingivitis ? 1 : 0,
        data.oe_parodental_pocket ? 1 : 0,
        data.oe_periodontitis ? 1 : 0,
        data.oe_impacted_teeth ? 1 : 0,
        data.oe_dry_socket ? 1 : 0,
        data.oe_attrition ? 1 : 0,
        data.oe_erosion ? 1 : 0,
        data.oe_notes ?? "",
        data.re_notes ?? "",
        data.advice ?? "",
        data.notes ?? "",
        now,
        now,
        staffId,
      );
    data.medications.forEach((m, i) => {
      this.core.db
        .prepare(
          `INSERT INTO prescription_medications (id, prescription_id, sequence, medicine, strength, dosage, route, frequency, duration, timing, instructions)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(newId(), id, i + 1, m.medicine, m.strength ?? "", m.dosage ?? "", m.route ?? "", m.frequency ?? "", m.duration ?? "", m.timing ?? "", m.instructions ?? "");
    });
  }

  private replaceProcedures(
    visitId: string,
    procedures?: Array<{ treatmentId?: string; tooth?: string; name: string; notes?: string }>,
  ) {
    this.core.db.prepare("DELETE FROM visit_procedures WHERE visit_id = ?").run(visitId);
    if (!procedures) return;
    const now = this.core.clock().toISOString();
    for (const p of procedures) {
      this.core.db
        .prepare(
          "INSERT INTO visit_procedures (id, visit_id, treatment_id, tooth, name, notes, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(newId(), visitId, p.treatmentId ?? null, p.tooth ?? null, p.name, p.notes ?? "", now);
    }
  }

  private assertPatient(id: string) {
    const row = this.core.db.prepare("SELECT id FROM patients WHERE id = ?").get(id);
    if (!row) throw new AppError("NOT_FOUND", "Patient was not found.");
  }
}

type VisitRow = {
  id: string;
  patient_id: string;
  patient_code: string;
  dentist_id: string | null;
  visited_at: string;
  chief_complaint: string;
  reason: string;
  symptoms: string;
  findings: string;
  diagnosis: string;
  treatment_plan_notes: string;
  treatment_performed: string;
  tooth_numbers_json: string;
  anesthesia: string;
  medications_notes: string;
  notes: string;
  follow_up_notes: string;
  referral_notes: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientCode: row.patient_code,
    dentistId: row.dentist_id,
    visitedAt: row.visited_at,
    chiefComplaint: row.chief_complaint,
    reason: row.reason,
    symptoms: row.symptoms,
    findings: row.findings,
    diagnosis: row.diagnosis,
    treatmentPlanNotes: row.treatment_plan_notes,
    treatmentPerformed: row.treatment_performed,
    toothNumbers: jsonParse(row.tooth_numbers_json, []),
    anesthesia: row.anesthesia,
    medicationsNotes: row.medications_notes,
    notes: row.notes,
    followUpNotes: row.follow_up_notes,
    referralNotes: row.referral_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type RxRow = Record<string, unknown> & {
  id: string;
  patient_id: string;
  visit_id: string | null;
  dentist_id: string | null;
  prescribed_at: string;
  cc_notes: string;
  oe_notes: string;
  re_notes: string;
  advice: string;
  notes: string;
};

type MedRow = {
  id: string;
  sequence: number;
  medicine: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  timing: string;
  instructions: string;
};

function toPrescription(row: RxRow, meds: MedRow[]): Prescription {
  const bool = (k: string) => row[k] === 1;
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    dentistId: row.dentist_id,
    prescribedAt: row.prescribed_at,
    cc: {
      cc_pain_on: bool("cc_pain_on"),
      cc_g_carries: bool("cc_g_carries"),
      cc_swelling: bool("cc_swelling"),
      cc_gum_bleeding: bool("cc_gum_bleeding"),
      cc_bad_breath: bool("cc_bad_breath"),
      cc_sensitivity: bool("cc_sensitivity"),
      notes: row.cc_notes,
    },
    oe: {
      oe_carries: bool("oe_carries"),
      oe_g_carries: bool("oe_g_carries"),
      oe_bdr: bool("oe_bdr"),
      oe_bdc: bool("oe_bdc"),
      oe_gingivitis: bool("oe_gingivitis"),
      oe_parodental_pocket: bool("oe_parodental_pocket"),
      oe_periodontitis: bool("oe_periodontitis"),
      oe_impacted_teeth: bool("oe_impacted_teeth"),
      oe_dry_socket: bool("oe_dry_socket"),
      oe_attrition: bool("oe_attrition"),
      oe_erosion: bool("oe_erosion"),
      notes: row.oe_notes,
    },
    reNotes: row.re_notes,
    advice: row.advice,
    notes: row.notes,
    medications: meds.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      medicine: m.medicine,
      strength: m.strength,
      dosage: m.dosage,
      route: m.route,
      frequency: m.frequency,
      duration: m.duration,
      timing: m.timing,
      instructions: m.instructions,
    })) as PrescriptionMed[],
  };
}
