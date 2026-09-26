import { z } from "zod";
import type { DuplicateCandidate, PageResult, Patient, PatientDental, PatientMedical } from "../../shared/types.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { formatPatientCode } from "../ids.ts";
import { ageYears } from "../clock.ts";
import { parse, nonEmpty, paginationSchema, pageOffset, normalizePhone } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit, getClinicPrefixes, getClinicTimezone, jsonParse, jsonString, nextSequence, upsertSearch, immediate } from "../db/helpers.ts";

const patientSchema = z.object({
  title: z.string().max(20).optional(),
  fullName: nonEmpty("full name", 180),
  gender: z.string().max(30).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter date of birth as YYYY-MM-DD.").optional().or(z.literal("")),
  phone: z.string().max(32).optional(),
  alternatePhone: z.string().max(32).optional(),
  email: z.string().max(180).optional(),
  address: z.string().max(500).optional(),
  emergencyContactName: z.string().max(180).optional(),
  emergencyContactPhone: z.string().max(32).optional(),
  occupation: z.string().max(120).optional(),
  referralSource: z.string().max(180).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  notes: z.string().max(4000).optional(),
  medical: z
    .object({
      history: z.string().max(8000).optional(),
      allergies: z.string().max(4000).optional(),
      allergyAlert: z.boolean().optional(),
      medications: z.string().max(4000).optional(),
      chronicConditions: z.string().max(4000).optional(),
      importantNotes: z.string().max(4000).optional(),
    })
    .optional(),
  dental: z
    .object({
      history: z.string().max(8000).optional(),
      previousTreatment: z.string().max(4000).optional(),
      oralHygiene: z.string().max(2000).optional(),
      notes: z.string().max(4000).optional(),
    })
    .optional(),
  customFields: z.record(z.string()).optional(),
  ignoreDuplicateWarning: z.boolean().optional(),
});

type PatientRow = {
  id: string;
  code: string;
  title: string | null;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  phone_normalized: string | null;
  alternate_phone: string | null;
  email: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  occupation: string | null;
  referral_source: string | null;
  tags_json: string;
  notes: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
  outstanding: number | null;
  allergy_alert: number | null;
};

export class PatientService {
  constructor(private readonly core: Core) {}

  list(
    actor: Actor,
    query: { search?: string; page?: number; pageSize?: number; archived?: boolean; tag?: string },
  ): PageResult<Patient> {
    requirePermission(actor, "patients.read");
    const page = parse(paginationSchema, { page: query.page ?? 1, pageSize: query.pageSize ?? 50 });
    const { limit, offset } = pageOffset(page);
    const archived = query.archived ? 1 : 0;
    const params: unknown[] = [archived];
    let where = "p.archived = ?";
    if (query.search && query.search.trim()) {
      const q = `%${query.search.trim()}%`;
      where += ` AND (p.code LIKE ? OR p.full_name LIKE ? OR p.phone LIKE ? OR p.phone_normalized LIKE ? OR IFNULL(p.email,'') LIKE ?)`;
      params.push(q, q, q, q, q);
    }
    if (query.tag) {
      where += ` AND p.tags_json LIKE ?`;
      params.push(`%${query.tag}%`);
    }
    const total = (
      this.core.db.prepare(`SELECT COUNT(*) AS c FROM patients p WHERE ${where}`).get(...params) as { c: number }
    ).c;
    const rows = this.core.db
      .prepare(
        `SELECT p.*,
            IFNULL(m.allergy_alert, 0) AS allergy_alert,
            IFNULL((
              SELECT SUM(i.due_paisa) FROM invoices i
              WHERE i.patient_id = p.id AND i.status IN ('issued','partial')
            ), 0) AS outstanding
         FROM patients p
         LEFT JOIN patient_medical m ON m.patient_id = p.id
         WHERE ${where}
         ORDER BY p.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as PatientRow[];
    return { items: rows.map((r) => this.toPatient(r)), page: page.page, pageSize: page.pageSize, total };
  }

  get(actor: Actor, id: string): Patient {
    requirePermission(actor, "patients.read");
    const row = this.core.db
      .prepare(
        `SELECT p.*, IFNULL(m.allergy_alert, 0) AS allergy_alert,
            IFNULL((SELECT SUM(i.due_paisa) FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('issued','partial')), 0) AS outstanding
         FROM patients p LEFT JOIN patient_medical m ON m.patient_id = p.id WHERE p.id = ?`,
      )
      .get(id) as PatientRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Patient was not found.");
    return this.toPatient(row);
  }

  getByCode(actor: Actor, code: string): Patient {
    requirePermission(actor, "patients.read");
    const row = this.core.db.prepare("SELECT id FROM patients WHERE code = ?").get(code) as { id: string } | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Patient was not found.");
    return this.get(actor, row.id);
  }

  medical(actor: Actor, patientId: string): PatientMedical {
    requirePermission(actor, "patients.read");
    this.assertPatient(patientId);
    const row = this.core.db.prepare("SELECT * FROM patient_medical WHERE patient_id = ?").get(patientId) as
      | {
          history: string;
          allergies: string;
          allergy_alert: number;
          medications: string;
          chronic_conditions: string;
          important_notes: string;
        }
      | undefined;
    return {
      history: row?.history ?? "",
      allergies: row?.allergies ?? "",
      allergyAlert: row?.allergy_alert === 1,
      medications: row?.medications ?? "",
      chronicConditions: row?.chronic_conditions ?? "",
      importantNotes: row?.important_notes ?? "",
    };
  }

  dental(actor: Actor, patientId: string): PatientDental {
    requirePermission(actor, "patients.read");
    this.assertPatient(patientId);
    const row = this.core.db.prepare("SELECT * FROM patient_dental WHERE patient_id = ?").get(patientId) as
      | { history: string; previous_treatment: string; oral_hygiene: string; notes: string }
      | undefined;
    return {
      history: row?.history ?? "",
      previousTreatment: row?.previous_treatment ?? "",
      oralHygiene: row?.oral_hygiene ?? "",
      notes: row?.notes ?? "",
    };
  }

  findDuplicates(input: { fullName: string; phone?: string; email?: string; dateOfBirth?: string; excludeId?: string }): DuplicateCandidate[] {
    const phoneN = normalizePhone(input.phone);
    const name = input.fullName.trim();
    const email = input.email?.trim().toLowerCase() || null;
    const rows = this.core.db
      .prepare(
        `SELECT id, code, full_name, phone, email, date_of_birth, phone_normalized
         FROM patients
         WHERE archived = 0
           AND (? IS NULL OR id != ?)
           AND (
             (? IS NOT NULL AND phone_normalized = ?)
             OR (? IS NOT NULL AND lower(email) = ?)
             OR (lower(full_name) = lower(?) AND ? IS NOT NULL AND date_of_birth = ?)
             OR (lower(full_name) = lower(?) AND ? IS NOT NULL AND phone_normalized = ?)
           )`,
      )
      .all(
        input.excludeId ?? null,
        input.excludeId ?? "",
        phoneN,
        phoneN,
        email,
        email,
        name,
        input.dateOfBirth ?? null,
        input.dateOfBirth ?? null,
        name,
        phoneN,
        phoneN,
      ) as Array<{
      id: string;
      code: string;
      full_name: string;
      phone: string | null;
      email: string | null;
      date_of_birth: string | null;
      phone_normalized: string | null;
    }>;
    const out: DuplicateCandidate[] = [];
    for (const r of rows) {
      const reasons: string[] = [];
      if (phoneN && r.phone_normalized && r.phone_normalized === phoneN) reasons.push("Same phone number");
      if (input.email && r.email && r.email.toLowerCase() === input.email.toLowerCase()) reasons.push("Same email");
      const nameMatch = r.full_name.trim().toLowerCase() === name.toLowerCase();
      if (nameMatch && input.dateOfBirth && r.date_of_birth === input.dateOfBirth) reasons.push("Same name and date of birth");
      if (nameMatch && phoneN && r.phone_normalized === phoneN) reasons.push("Same name and phone");
      if (reasons.length) {
        out.push({
          id: r.id,
          code: r.code,
          fullName: r.full_name,
          phone: r.phone,
          email: r.email,
          dateOfBirth: r.date_of_birth,
          reasons,
        });
      }
    }
    return out;
  }

  create(actor: Actor, input: unknown): Patient {
    requirePermission(actor, "patients.write");
    const data = parse(patientSchema, input);
    if (!data.ignoreDuplicateWarning) {
      const dupes = this.findDuplicates({
        fullName: data.fullName,
        phone: data.phone,
        email: data.email,
        dateOfBirth: data.dateOfBirth || undefined,
      });
      if (dupes.length) {
        throw new AppError(
          "CONFLICT",
          "A possible duplicate patient already exists. Review the matches before creating a new record.",
          { details: { duplicates: dupes }, httpStatus: 409 },
        );
      }
    }
    const id = newId();
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      const prefixes = getClinicPrefixes(this.core.db);
      const seq = nextSequence(this.core.db, "patient");
      const code = formatPatientCode(seq, prefixes.patient);
      this.core.db
        .prepare(
          `INSERT INTO patients (
            id, code, title, full_name, gender, date_of_birth, phone, phone_normalized, alternate_phone, email, address,
            emergency_contact_name, emergency_contact_phone, occupation, referral_source, tags_json, notes, archived,
            created_at, updated_at, created_by
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
        )
        .run(
          id,
          code,
          emptyToNull(data.title),
          data.fullName,
          emptyToNull(data.gender),
          emptyToNull(data.dateOfBirth),
          emptyToNull(data.phone),
          normalizePhone(data.phone),
          emptyToNull(data.alternatePhone),
          emptyToNull(data.email),
          emptyToNull(data.address),
          emptyToNull(data.emergencyContactName),
          emptyToNull(data.emergencyContactPhone),
          emptyToNull(data.occupation),
          emptyToNull(data.referralSource),
          jsonString(data.tags ?? []),
          emptyToNull(data.notes),
          now,
          now,
          actor.staffId,
        );
      this.writeMedical(id, data.medical, now);
      this.writeDental(id, data.dental, now);
      this.writeCustom(id, data.customFields);
      upsertSearch(
        this.core.db,
        "patient",
        id,
        `${code} ${data.fullName}`,
        [data.phone, data.email, data.address].filter(Boolean).join(" "),
        code,
      );
      audit(this.core.db, actor, "patient_create", "patient", id, { code });
    });
    return this.get(actor, id);
  }

  update(actor: Actor, id: string, input: unknown): Patient {
    requirePermission(actor, "patients.write");
    const existing = this.assertPatient(id);
    const data = parse(patientSchema.partial().required({ fullName: true }).or(patientSchema), input);
    const merged = { ...data, fullName: data.fullName ?? existing.full_name };
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      this.core.db
        .prepare(
          `UPDATE patients SET
            title=?, full_name=?, gender=?, date_of_birth=?, phone=?, phone_normalized=?, alternate_phone=?, email=?,
            address=?, emergency_contact_name=?, emergency_contact_phone=?, occupation=?, referral_source=?,
            tags_json=?, notes=?, updated_at=?
           WHERE id=?`,
        )
        .run(
          emptyToNull(merged.title) ?? existing.title,
          merged.fullName,
          emptyToNull(merged.gender) ?? existing.gender,
          emptyToNull(merged.dateOfBirth) ?? existing.date_of_birth,
          emptyToNull(merged.phone) ?? existing.phone,
          normalizePhone(merged.phone ?? existing.phone ?? undefined),
          emptyToNull(merged.alternatePhone) ?? existing.alternate_phone,
          emptyToNull(merged.email) ?? existing.email,
          emptyToNull(merged.address) ?? existing.address,
          emptyToNull(merged.emergencyContactName) ?? existing.emergency_contact_name,
          emptyToNull(merged.emergencyContactPhone) ?? existing.emergency_contact_phone,
          emptyToNull(merged.occupation) ?? existing.occupation,
          emptyToNull(merged.referralSource) ?? existing.referral_source,
          jsonString(merged.tags ?? jsonParse(existing.tags_json, [])),
          emptyToNull(merged.notes) ?? existing.notes,
          now,
          id,
        );
      if (merged.medical) this.writeMedical(id, merged.medical, now);
      if (merged.dental) this.writeDental(id, merged.dental, now);
      if (merged.customFields) this.writeCustom(id, merged.customFields);
      const code = existing.code;
      upsertSearch(
        this.core.db,
        "patient",
        id,
        `${code} ${merged.fullName}`,
        [merged.phone ?? existing.phone, merged.email ?? existing.email].filter(Boolean).join(" "),
        code,
      );
      audit(this.core.db, actor, "patient_update", "patient", id, { code });
    });
    return this.get(actor, id);
  }

  archive(actor: Actor, id: string, archived: boolean): Patient {
    requirePermission(actor, "patients.write");
    this.assertPatient(id);
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE patients SET archived = ?, updated_at = ? WHERE id = ?").run(archived ? 1 : 0, now, id);
    audit(this.core.db, actor, archived ? "patient_archive" : "patient_restore", "patient", id);
    return this.get(actor, id);
  }

  customFields(actor: Actor, patientId: string): Array<{ key: string; name: string; type: string; value: string }> {
    requirePermission(actor, "patients.read");
    this.assertPatient(patientId);
    const defs = this.core.db
      .prepare("SELECT * FROM custom_field_defs WHERE entity = 'patient' AND active = 1 ORDER BY name")
      .all() as Array<{ id: string; name: string; field_key: string; field_type: string }>;
    const vals = this.core.db
      .prepare("SELECT field_id, value FROM custom_field_values WHERE entity_id = ?")
      .all(patientId) as Array<{ field_id: string; value: string | null }>;
    const map = new Map(vals.map((v) => [v.field_id, v.value ?? ""]));
    return defs.map((d) => ({ key: d.field_key, name: d.name, type: d.field_type, value: map.get(d.id) ?? "" }));
  }

  defineCustomField(actor: Actor, name: string, key: string, fieldType: string): void {
    requirePermission(actor, "settings.manage");
    const id = newId();
    this.core.db
      .prepare(
        "INSERT INTO custom_field_defs (id, entity, name, field_key, field_type, options_json, active) VALUES (?, 'patient', ?, ?, ?, NULL, 1)",
      )
      .run(id, name, key, fieldType);
  }

  private writeMedical(
    patientId: string,
    medical: z.infer<typeof patientSchema>["medical"],
    now: string,
  ): void {
    const m = medical ?? {};
    this.core.db
      .prepare(
        `INSERT INTO patient_medical (patient_id, history, allergies, allergy_alert, medications, chronic_conditions, important_notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(patient_id) DO UPDATE SET
           history=excluded.history, allergies=excluded.allergies, allergy_alert=excluded.allergy_alert,
           medications=excluded.medications, chronic_conditions=excluded.chronic_conditions,
           important_notes=excluded.important_notes, updated_at=excluded.updated_at`,
      )
      .run(
        patientId,
        m.history ?? "",
        m.allergies ?? "",
        m.allergyAlert ? 1 : 0,
        m.medications ?? "",
        m.chronicConditions ?? "",
        m.importantNotes ?? "",
        now,
      );
  }

  private writeDental(patientId: string, dental: z.infer<typeof patientSchema>["dental"], now: string): void {
    const d = dental ?? {};
    this.core.db
      .prepare(
        `INSERT INTO patient_dental (patient_id, history, previous_treatment, oral_hygiene, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(patient_id) DO UPDATE SET
           history=excluded.history, previous_treatment=excluded.previous_treatment,
           oral_hygiene=excluded.oral_hygiene, notes=excluded.notes, updated_at=excluded.updated_at`,
      )
      .run(patientId, d.history ?? "", d.previousTreatment ?? "", d.oralHygiene ?? "", d.notes ?? "", now);
  }

  private writeCustom(patientId: string, fields?: Record<string, string>): void {
    if (!fields) return;
    const defs = this.core.db
      .prepare("SELECT id, field_key FROM custom_field_defs WHERE entity = 'patient'")
      .all() as Array<{ id: string; field_key: string }>;
    const byKey = new Map(defs.map((d) => [d.field_key, d.id]));
    const ins = this.core.db.prepare(
      `INSERT INTO custom_field_values (id, field_id, entity_id, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(field_id, entity_id) DO UPDATE SET value = excluded.value`,
    );
    for (const [k, v] of Object.entries(fields)) {
      const fid = byKey.get(k);
      if (!fid) continue;
      ins.run(newId(), fid, patientId, v);
    }
  }

  private assertPatient(id: string) {
    const row = this.core.db.prepare("SELECT * FROM patients WHERE id = ?").get(id) as PatientRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Patient was not found.");
    return row;
  }

  private toPatient(row: PatientRow): Patient {
    const tz = getClinicTimezone(this.core.db);
    let age: number | null = null;
    if (row.date_of_birth) {
      try {
        age = ageYears(row.date_of_birth, tz, this.core.clock);
      } catch {
        age = null;
      }
    }
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      fullName: row.full_name,
      gender: row.gender,
      dateOfBirth: row.date_of_birth,
      age,
      phone: row.phone,
      alternatePhone: row.alternate_phone,
      email: row.email,
      address: row.address,
      emergencyContactName: row.emergency_contact_name,
      emergencyContactPhone: row.emergency_contact_phone,
      occupation: row.occupation,
      referralSource: row.referral_source,
      tags: jsonParse(row.tags_json, []),
      notes: row.notes,
      archived: row.archived === 1,
      outstandingPaisa: row.outstanding ?? 0,
      allergyAlert: row.allergy_alert === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function emptyToNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t ? t : null;
}
