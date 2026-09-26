import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { resolveInside, sanitizeFilename, ensureDir } from "../security/paths.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit } from "../db/helpers.ts";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export class AttachmentService {
  constructor(private readonly core: Core) {}

  list(actor: Actor, entityType: string, entityId: string) {
    requirePermission(actor, "patients.read");
    return this.core.db
      .prepare("SELECT id, filename, mime, size_bytes, created_at FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC")
      .all(entityType, entityId);
  }

  add(
    actor: Actor,
    entityType: string,
    entityId: string,
    filename: string,
    data: Buffer,
    mime?: string,
  ) {
    requirePermission(actor, "attachments.write");
    if (data.length > 25 * 1024 * 1024) {
      throw new AppError("VALIDATION", "Attachments larger than 25 MB cannot be stored.");
    }
    const safe = sanitizeFilename(filename);
    const stored = `${newId()}_${safe}`;
    const dir = resolveInside(this.core.paths.attachmentsDir, entityType, entityId);
    ensureDir(dir);
    const dest = resolveInside(dir, stored);
    fs.writeFileSync(dest, data);
    const id = newId();
    this.core.db
      .prepare(
        `INSERT INTO attachments (id, entity_type, entity_id, filename, stored_name, mime, size_bytes, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, entityType, entityId, safe, stored, mime ?? null, data.length, this.core.clock().toISOString(), actor.staffId);
    audit(this.core.db, actor, "attachment_add", "attachment", id, { entityType, entityId, filename: safe });
    return { id, filename: safe, sizeBytes: data.length };
  }

  read(actor: Actor, id: string): { filename: string; mime: string | null; data: Buffer } {
    requirePermission(actor, "patients.read");
    const row = this.core.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
      | { filename: string; stored_name: string; mime: string | null; entity_type: string; entity_id: string }
      | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Attachment was not found.");
    const dest = resolveInside(this.core.paths.attachmentsDir, row.entity_type, row.entity_id, row.stored_name);
    if (!fs.existsSync(dest)) throw new AppError("NOT_FOUND", "The attachment file is missing from disk.");
    return { filename: row.filename, mime: row.mime, data: fs.readFileSync(dest) };
  }

  absolutePath(id: string): string {
    const row = this.core.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
      | { stored_name: string; entity_type: string; entity_id: string }
      | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Attachment was not found.");
    return resolveInside(this.core.paths.attachmentsDir, row.entity_type, row.entity_id, row.stored_name);
  }
}

export { ALLOWED_MIME };
void path;
