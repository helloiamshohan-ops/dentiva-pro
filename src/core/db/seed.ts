import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, DEFAULT_TREATMENTS } from "../../shared/constants.ts";
import { newId } from "../ids.ts";
import type { Sqlite } from "./connection.ts";

export function seedDefaults(db: Sqlite): void {
  const now = new Date().toISOString();
  const clinic = db.prepare("SELECT id FROM clinic_settings WHERE id = 1").get();
  if (!clinic) {
    db.prepare(
      `INSERT INTO clinic_settings (
        id, clinic_name, currency, timezone, invoice_prefix, receipt_prefix, patient_prefix,
        paper_size, tax_rate_bps, appointment_slot_minutes, inactivity_timeout_minutes,
        print_settings_json, notification_settings_json, security_settings_json, prefs_json, updated_at
      ) VALUES (1, '', ?, ?, 'INV', 'RCT', 'P', 'A4', 0, 30, 15, '{}', '{}', '{}', '{}', ?)`,
    ).run(DEFAULT_CURRENCY, DEFAULT_TIMEZONE, now);
  }

  const seqs = ["patient", "invoice", "receipt", "purchase", "queue"];
  for (const name of seqs) {
    db.prepare("INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES (?, 1)").run(name);
  }

  const chairCount = (db.prepare("SELECT COUNT(*) AS c FROM chairs").get() as { c: number }).c;
  if (chairCount === 0) {
    db.prepare("INSERT INTO chairs (id, name, active) VALUES (?, 'Chair 1', 1)").run(newId());
    db.prepare("INSERT INTO chairs (id, name, active) VALUES (?, 'Chair 2', 1)").run(newId());
  }
  const roomCount = (db.prepare("SELECT COUNT(*) AS c FROM rooms").get() as { c: number }).c;
  if (roomCount === 0) {
    db.prepare("INSERT INTO rooms (id, name, active) VALUES (?, 'Room 1', 1)").run(newId());
  }

  const catCount = (db.prepare("SELECT COUNT(*) AS c FROM accounting_categories").get() as { c: number }).c;
  if (catCount === 0) {
    const cats: Array<[string, "income" | "expense"]> = [
      ["Clinical fees", "income"],
      ["Other income", "income"],
      ["Supplies", "expense"],
      ["Laboratory", "expense"],
      ["Staff", "expense"],
      ["Utilities", "expense"],
      ["Rent", "expense"],
      ["Other expense", "expense"],
    ];
    const ins = db.prepare("INSERT INTO accounting_categories (id, name, type, active) VALUES (?, ?, ?, 1)");
    for (const [name, type] of cats) ins.run(newId(), name, type);
  }

  const tCount = (db.prepare("SELECT COUNT(*) AS c FROM treatments").get() as { c: number }).c;
  if (tCount === 0) {
    const ins = db.prepare(
      `INSERT INTO treatments (id, name, category, description, default_duration_minutes, default_price_paisa, clinical_notes, active, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, '', 1, ?, ?)`,
    );
    for (const t of DEFAULT_TREATMENTS) {
      ins.run(newId(), t.name, t.category, t.duration, t.pricePaisa, now, now);
    }
  }

  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('initialized_at', ?)").run(now);
}
