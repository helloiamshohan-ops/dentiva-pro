import { z } from "zod";
import type { ClinicSettings } from "../../shared/types.ts";
import { PAPER_SIZES } from "../../shared/constants.ts";
import { parse } from "../validation.ts";
import { jsonParse as jp, jsonString } from "../db/helpers.ts";
import { AppError } from "../errors.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit } from "../db/helpers.ts";
import { newId } from "../ids.ts";

const settingsSchema = z.object({
  clinicName: z.string().max(180).optional(),
  logoPath: z.string().max(500).nullable().optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(80).optional(),
  email: z.string().max(180).optional(),
  website: z.string().max(180).optional(),
  registrationInfo: z.string().max(500).optional(),
  dentistName: z.string().max(180).optional(),
  dentistQualifications: z.string().max(500).optional(),
  dentistRegistration: z.string().max(180).optional(),
  currency: z.string().max(8).optional(),
  timezone: z.string().max(64).optional(),
  invoicePrefix: z.string().max(8).optional(),
  receiptPrefix: z.string().max(8).optional(),
  patientPrefix: z.string().max(8).optional(),
  paperSize: z.enum(PAPER_SIZES).optional(),
  invoiceFooter: z.string().max(2000).optional(),
  receiptFooter: z.string().max(2000).optional(),
  prescriptionFooter: z.string().max(2000).optional(),
  taxRateBps: z.number().int().min(0).max(100000).optional(),
  appointmentSlotMinutes: z.number().int().min(5).max(240).optional(),
  inactivityTimeoutMinutes: z.number().int().min(0).max(240).optional(),
  backupDir: z.string().max(500).nullable().optional(),
  printSettings: z.record(z.unknown()).optional(),
  notificationSettings: z.record(z.unknown()).optional(),
  securitySettings: z.record(z.unknown()).optional(),
  prefs: z.record(z.unknown()).optional(),
});

export class ClinicService {
  constructor(private readonly core: Core) {}

  get(): ClinicSettings {
    const row = this.core.db.prepare("SELECT * FROM clinic_settings WHERE id = 1").get() as SettingsRow | undefined;
    if (!row) throw new AppError("INTERNAL", "Clinic settings are missing.");
    return toSettings(row);
  }

  update(actor: Actor, input: unknown): ClinicSettings {
    requirePermission(actor, "settings.manage");
    const data = parse(settingsSchema, input);
    const current = this.get();
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare(
        `UPDATE clinic_settings SET
          clinic_name=?, logo_path=?, address=?, phone=?, email=?, website=?, registration_info=?,
          dentist_name=?, dentist_qualifications=?, dentist_registration=?, currency=?, timezone=?,
          invoice_prefix=?, receipt_prefix=?, patient_prefix=?, paper_size=?, invoice_footer=?, receipt_footer=?,
          prescription_footer=?, tax_rate_bps=?, appointment_slot_minutes=?, inactivity_timeout_minutes=?,
          backup_dir=?, print_settings_json=?, notification_settings_json=?, security_settings_json=?, prefs_json=?, updated_at=?
         WHERE id = 1`,
      )
      .run(
        data.clinicName ?? current.clinicName,
        data.logoPath === undefined ? current.logoPath : data.logoPath,
        data.address ?? current.address,
        data.phone ?? current.phone,
        data.email ?? current.email,
        data.website ?? current.website,
        data.registrationInfo ?? current.registrationInfo,
        data.dentistName ?? current.dentistName,
        data.dentistQualifications ?? current.dentistQualifications,
        data.dentistRegistration ?? current.dentistRegistration,
        data.currency ?? current.currency,
        data.timezone ?? current.timezone,
        data.invoicePrefix ?? current.invoicePrefix,
        data.receiptPrefix ?? current.receiptPrefix,
        data.patientPrefix ?? current.patientPrefix,
        data.paperSize ?? current.paperSize,
        data.invoiceFooter ?? current.invoiceFooter,
        data.receiptFooter ?? current.receiptFooter,
        data.prescriptionFooter ?? current.prescriptionFooter,
        data.taxRateBps ?? current.taxRateBps,
        data.appointmentSlotMinutes ?? current.appointmentSlotMinutes,
        data.inactivityTimeoutMinutes ?? current.inactivityTimeoutMinutes,
        data.backupDir === undefined ? current.backupDir : data.backupDir,
        jsonString(data.printSettings ?? current.printSettings),
        jsonString(data.notificationSettings ?? current.notificationSettings),
        jsonString(data.securitySettings ?? current.securitySettings),
        jsonString(data.prefs ?? current.prefs),
        now,
      );
    audit(this.core.db, actor, "settings_update", "clinic", "1");
    return this.get();
  }

  listTreatments(activeOnly = true) {
    const sql = activeOnly
      ? "SELECT * FROM treatments WHERE active = 1 ORDER BY category, name"
      : "SELECT * FROM treatments ORDER BY category, name";
    return this.core.db.prepare(sql).all();
  }

  saveTreatment(actor: Actor, input: unknown) {
    requirePermission(actor, "settings.manage");
    const schema = z.object({
      id: z.string().optional(),
      name: z.string().min(1).max(180),
      category: z.string().max(80).optional(),
      description: z.string().max(2000).optional(),
      defaultDurationMinutes: z.number().int().min(1).optional(),
      defaultPricePaisa: z.number().int().min(0).default(0),
      clinicalNotes: z.string().max(2000).optional(),
      active: z.boolean().optional(),
    });
    const data = parse(schema, input);
    const now = this.core.clock().toISOString();
    const id = data.id ?? newId();
    if (data.id) {
      this.core.db
        .prepare(
          `UPDATE treatments SET name=?, category=?, description=?, default_duration_minutes=?, default_price_paisa=?, clinical_notes=?, active=?, updated_at=? WHERE id=?`,
        )
        .run(
          data.name,
          data.category ?? "",
          data.description ?? "",
          data.defaultDurationMinutes ?? null,
          data.defaultPricePaisa,
          data.clinicalNotes ?? "",
          data.active === false ? 0 : 1,
          now,
          id,
        );
    } else {
      this.core.db
        .prepare(
          `INSERT INTO treatments (id, name, category, description, default_duration_minutes, default_price_paisa, clinical_notes, active, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?)`,
        )
        .run(id, data.name, data.category ?? "", data.description ?? "", data.defaultDurationMinutes ?? null, data.defaultPricePaisa, data.clinicalNotes ?? "", now, now);
    }
    audit(this.core.db, actor, "treatment_save", "treatment", id);
    return this.core.db.prepare("SELECT * FROM treatments WHERE id = ?").get(id);
  }
}

type SettingsRow = {
  clinic_name: string;
  logo_path: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  registration_info: string;
  dentist_name: string;
  dentist_qualifications: string;
  dentist_registration: string;
  currency: string;
  timezone: string;
  invoice_prefix: string;
  receipt_prefix: string;
  patient_prefix: string;
  paper_size: ClinicSettings["paperSize"];
  invoice_footer: string;
  receipt_footer: string;
  prescription_footer: string;
  tax_rate_bps: number;
  appointment_slot_minutes: number;
  inactivity_timeout_minutes: number;
  backup_dir: string | null;
  print_settings_json: string;
  notification_settings_json: string;
  security_settings_json: string;
  prefs_json: string;
  updated_at: string;
};

function toSettings(row: SettingsRow): ClinicSettings {
  return {
    clinicName: row.clinic_name,
    logoPath: row.logo_path,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    registrationInfo: row.registration_info,
    dentistName: row.dentist_name,
    dentistQualifications: row.dentist_qualifications,
    dentistRegistration: row.dentist_registration,
    currency: row.currency,
    timezone: row.timezone,
    invoicePrefix: row.invoice_prefix,
    receiptPrefix: row.receipt_prefix,
    patientPrefix: row.patient_prefix,
    paperSize: row.paper_size,
    invoiceFooter: row.invoice_footer,
    receiptFooter: row.receipt_footer,
    prescriptionFooter: row.prescription_footer,
    taxRateBps: row.tax_rate_bps,
    appointmentSlotMinutes: row.appointment_slot_minutes,
    inactivityTimeoutMinutes: row.inactivity_timeout_minutes,
    backupDir: row.backup_dir,
    printSettings: jp(row.print_settings_json, {}),
    notificationSettings: jp(row.notification_settings_json, {}),
    securitySettings: jp(row.security_settings_json, {}),
    prefs: jp(row.prefs_json, {}),
    updatedAt: row.updated_at,
  };
}
