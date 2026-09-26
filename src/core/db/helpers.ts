import type { Sqlite } from "./connection.ts";
import { newId } from "../ids.ts";
import { AppError } from "../errors.ts";
import type { Actor } from "../context.ts";

export function nextSequence(db: Sqlite, name: string): number {
  const row = db.prepare("SELECT next_value FROM id_sequences WHERE name = ?").get(name) as
    | { next_value: number }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO id_sequences (name, next_value) VALUES (?, 2)").run(name);
    return 1;
  }
  db.prepare("UPDATE id_sequences SET next_value = next_value + 1 WHERE name = ?").run(name);
  return row.next_value;
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function audit(
  db: Sqlite,
  actor: Actor | null | undefined,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO audit_log (id, at, actor_id, actor_name, action, entity_type, entity_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    new Date().toISOString(),
    actor?.staffId ?? null,
    actor?.name ?? null,
    action,
    entityType ?? null,
    entityId ?? null,
    metadata ? JSON.stringify(stripSecrets(metadata)) : null,
  );
}

function stripSecrets(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const key = k.toLowerCase();
    if (key.includes("password") || key.includes("pin") || key.includes("secret") || key.includes("hash") || key.includes("token")) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function upsertSearch(
  db: Sqlite,
  entityType: string,
  entityId: string,
  title: string,
  body: string,
  code?: string | null,
): void {
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT id FROM search_index WHERE entity_type = ? AND entity_id = ?")
    .get(entityType, entityId) as { id: string } | undefined;
  const id = existing?.id ?? newId();
  if (existing) {
    db.prepare(
      "UPDATE search_index SET title = ?, body = ?, code = ?, updated_at = ? WHERE id = ?",
    ).run(title, body, code ?? null, now, id);
    db.prepare("DELETE FROM search_fts WHERE entity_id = ? AND entity_type = ?").run(entityId, entityType);
  } else {
    db.prepare(
      "INSERT INTO search_index (id, entity_type, entity_id, title, body, code, updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(id, entityType, entityId, title, body, code ?? null, now);
  }
  db.prepare(
    "INSERT INTO search_fts (entity_type, entity_id, title, body, code) VALUES (?,?,?,?,?)",
  ).run(entityType, entityId, title, body, code ?? "");
}

export function removeSearch(db: Sqlite, entityType: string, entityId: string): void {
  db.prepare("DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?").run(entityType, entityId);
  db.prepare("DELETE FROM search_fts WHERE entity_id = ? AND entity_type = ?").run(entityId, entityType);
}

export function notify(
  db: Sqlite,
  type: string,
  severity: "info" | "warning" | "error",
  title: string,
  body: string,
  entityType?: string,
  entityId?: string,
): void {
  db.prepare(
    `INSERT INTO notifications (id, type, severity, title, body, entity_type, entity_id, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(newId(), type, severity, title, body, entityType ?? null, entityId ?? null, new Date().toISOString());
}

export function getClinicTimezone(db: Sqlite): string {
  const row = db.prepare("SELECT timezone FROM clinic_settings WHERE id = 1").get() as { timezone: string } | undefined;
  return row?.timezone || "Asia/Dhaka";
}

export function getClinicPrefixes(db: Sqlite): { patient: string; invoice: string; receipt: string } {
  const row = db.prepare("SELECT patient_prefix, invoice_prefix, receipt_prefix FROM clinic_settings WHERE id = 1").get() as
    | { patient_prefix: string; invoice_prefix: string; receipt_prefix: string }
    | undefined;
  return {
    patient: row?.patient_prefix || "P",
    invoice: row?.invoice_prefix || "INV",
    receipt: row?.receipt_prefix || "RCT",
  };
}

export function mustFind<T>(row: T | undefined, message: string): T {
  if (!row) throw new AppError("NOT_FOUND", message);
  return row;
}

export function immediate<T>(db: Sqlite, fn: () => T): T {
  return db.transaction(fn).immediate();
}
