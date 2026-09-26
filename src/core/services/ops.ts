import { DateTime } from "luxon";
import type { PageResult, SearchHit } from "../../shared/types.ts";
import { parse, paginationSchema, pageOffset } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission, requireAny } from "../context.ts";
import { getClinicTimezone as tzOf } from "../db/helpers.ts";
import { newId } from "../ids.ts";
import { AppError } from "../errors.ts";

export class OpsService {
  constructor(private readonly core: Core) {}

  search(actor: Actor, q: string, limit = 25): SearchHit[] {
    requireAny(actor, ["patients.read", "billing.read", "clinical.read", "inventory.read", "appointments.read"]);
    const query = q.trim();
    if (!query) return [];
    const capped = Math.min(Math.max(limit, 1), 50);
    const like = `%${query.replace(/%/g, "")}%`;
    const hits: SearchHit[] = [];

    const patients = this.core.db
      .prepare(
        `SELECT id, code, full_name, phone FROM patients
         WHERE archived = 0 AND (code LIKE ? OR full_name LIKE ? OR IFNULL(phone,'') LIKE ? OR IFNULL(email,'') LIKE ?)
         ORDER BY full_name LIMIT ?`,
      )
      .all(like, like, like, like, capped) as Array<{ id: string; code: string; full_name: string; phone: string | null }>;
    for (const p of patients) {
      hits.push({ entityType: "patient", entityId: p.id, title: p.full_name, subtitle: p.phone ?? "", code: p.code });
    }

    const invoices = this.core.db
      .prepare(
        `SELECT i.id, i.number, p.full_name, p.code FROM invoices i JOIN patients p ON p.id = i.patient_id
         WHERE i.number LIKE ? OR p.code LIKE ? ORDER BY i.issued_at DESC LIMIT ?`,
      )
      .all(like, like, capped) as Array<{ id: string; number: string; full_name: string; code: string }>;
    for (const i of invoices) {
      hits.push({ entityType: "invoice", entityId: i.id, title: i.number, subtitle: i.full_name, code: i.code });
    }

    const rx = this.core.db
      .prepare(
        `SELECT r.id, p.full_name, p.code, r.prescribed_at FROM prescriptions r JOIN patients p ON p.id = r.patient_id
         WHERE p.full_name LIKE ? OR p.code LIKE ? ORDER BY r.prescribed_at DESC LIMIT ?`,
      )
      .all(like, like, capped) as Array<{ id: string; full_name: string; code: string; prescribed_at: string }>;
    for (const r of rx) {
      hits.push({ entityType: "prescription", entityId: r.id, title: `Prescription · ${r.full_name}`, subtitle: r.prescribed_at, code: r.code });
    }

    const items = this.core.db
      .prepare(`SELECT id, sku, name FROM inventory_items WHERE sku LIKE ? OR name LIKE ? LIMIT ?`)
      .all(like, like, capped) as Array<{ id: string; sku: string; name: string }>;
    for (const i of items) {
      hits.push({ entityType: "inventory", entityId: i.id, title: i.name, subtitle: i.sku, code: i.sku });
    }

    const staff = this.core.db
      .prepare(`SELECT id, name, username FROM staff WHERE name LIKE ? OR username LIKE ? LIMIT ?`)
      .all(like, like, capped) as Array<{ id: string; name: string; username: string }>;
    for (const s of staff) {
      hits.push({ entityType: "staff", entityId: s.id, title: s.name, subtitle: s.username });
    }

    try {
      const fts = this.core.db
        .prepare(
          `SELECT entity_type, entity_id, title, body, code FROM search_fts WHERE search_fts MATCH ? LIMIT ?`,
        )
        .all(query.replace(/["']/g, " ").trim() || query, capped) as Array<{
        entity_type: string;
        entity_id: string;
        title: string;
        body: string;
        code: string;
      }>;
      for (const f of fts) {
        if (!hits.some((h) => h.entityId === f.entity_id && h.entityType === f.entity_type)) {
          hits.push({ entityType: f.entity_type, entityId: f.entity_id, title: f.title, subtitle: f.body, code: f.code });
        }
      }
    } catch {
      /* FTS parse errors are non-fatal */
    }
    return hits.slice(0, capped);
  }

  dashboard(actor: Actor) {
    requirePermission(actor, "reports.view");
    const tz = tzOf(this.core.db);
    const start = DateTime.fromJSDate(this.core.clock()).setZone(tz).startOf("day").toUTC().toISO()!;
    const end = DateTime.fromJSDate(this.core.clock()).setZone(tz).endOf("day").toUTC().toISO()!;
    const today = DateTime.fromJSDate(this.core.clock()).setZone(tz).toFormat("yyyy-MM-dd");

    const appointments = (
      this.core.db
        .prepare(
          `SELECT COUNT(*) AS c FROM appointments WHERE starts_at >= ? AND starts_at <= ? AND status NOT IN ('cancelled')`,
        )
        .get(start, end) as { c: number }
    ).c;
    const visits = (
      this.core.db.prepare(`SELECT COUNT(*) AS c FROM visits WHERE visited_at >= ? AND visited_at <= ?`).get(start, end) as { c: number }
    ).c;
    const queueWaiting = (
      this.core.db.prepare(`SELECT COUNT(*) AS c FROM queue WHERE queue_date = ? AND status = 'waiting'`).get(today) as { c: number }
    ).c;
    const completedVisits = (
      this.core.db
        .prepare(`SELECT COUNT(*) AS c FROM visits WHERE visited_at >= ? AND visited_at <= ? AND status = 'completed'`)
        .get(start, end) as { c: number }
    ).c;
    const revenue = (
      this.core.db
        .prepare(
          `SELECT IFNULL(SUM(total_paisa),0) AS s FROM invoices WHERE issued_at >= ? AND issued_at <= ? AND status NOT IN ('void','draft')`,
        )
        .get(start, end) as { s: number }
    ).s;
    const collected = (
      this.core.db.prepare(`SELECT IFNULL(SUM(amount_paisa),0) AS s FROM payments WHERE paid_at >= ? AND paid_at <= ?`).get(start, end) as {
        s: number;
      }
    ).s;
    const outstanding = (
      this.core.db.prepare(`SELECT IFNULL(SUM(due_paisa),0) AS s FROM invoices WHERE status IN ('issued','partial')`).get() as { s: number }
    ).s;
    const upcoming = this.core.db
      .prepare(
        `SELECT a.id, a.starts_at, a.status, p.full_name, p.code, s.name AS dentist
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         LEFT JOIN staff s ON s.id = a.dentist_id
         WHERE a.starts_at >= ? AND a.status IN ('scheduled','confirmed')
         ORDER BY a.starts_at LIMIT 10`,
      )
      .all(this.core.clock().toISOString());
    const waiting = this.core.db
      .prepare(
        `SELECT q.id, q.serial, p.full_name, p.code FROM queue q JOIN patients p ON p.id = q.patient_id
         WHERE q.queue_date = ? AND q.status = 'waiting' ORDER BY q.serial LIMIT 20`,
      )
      .all(today);
    const followups = this.core.db
      .prepare(
        `SELECT f.id, f.due_at, f.reason, p.full_name, p.code FROM followups f JOIN patients p ON p.id = f.patient_id
         WHERE f.status = 'pending' AND f.due_at <= ? ORDER BY f.due_at LIMIT 10`,
      )
      .all(end);
    const lowStock = this.core.db
      .prepare(`SELECT id, sku, name, quantity, reorder_level FROM inventory_items WHERE active = 1 AND quantity <= reorder_level ORDER BY quantity LIMIT 10`)
      .all();
    const expiry = this.core.db
      .prepare(
        `SELECT b.id, b.batch_code, b.expiry_date, b.quantity, i.name FROM inventory_batches b
         JOIN inventory_items i ON i.id = b.item_id
         WHERE b.expiry_date IS NOT NULL AND b.expiry_date <= ? AND b.quantity > 0
         ORDER BY b.expiry_date LIMIT 10`,
      )
      .all(DateTime.fromJSDate(this.core.clock()).plus({ days: 30 }).toISODate());
    const unpaid = this.core.db
      .prepare(
        `SELECT i.id, i.number, i.due_paisa, p.full_name, p.code FROM invoices i JOIN patients p ON p.id = i.patient_id
         WHERE i.status IN ('issued','partial') ORDER BY i.issued_at LIMIT 10`,
      )
      .all();

    return {
      today: { appointments, patientsSeen: visits, queueWaiting, completedVisits, revenue, collected, outstanding },
      upcoming,
      waiting,
      followups,
      lowStock,
      expiry,
      unpaid,
    };
  }

  reports(
    actor: Actor,
    kind: string,
    from: string,
    to: string,
  ): { title: string; rows: Record<string, unknown>[]; totals?: Record<string, number> } {
    requirePermission(actor, "reports.view");
    switch (kind) {
      case "revenue": {
        const rows = this.core.db
          .prepare(
            `SELECT date(issued_at) AS day, COUNT(*) AS invoices, SUM(total_paisa) AS billed, SUM(paid_paisa) AS collected, SUM(due_paisa) AS outstanding
             FROM invoices WHERE issued_at >= ? AND issued_at <= ? AND status NOT IN ('void','draft')
             GROUP BY date(issued_at) ORDER BY day`,
          )
          .all(from, to) as Array<{ day: string; invoices: number; billed: number; collected: number; outstanding: number }>;
        const totals = rows.reduce(
          (a, r) => ({
            invoices: a.invoices + r.invoices,
            billed: a.billed + r.billed,
            collected: a.collected + r.collected,
            outstanding: a.outstanding + r.outstanding,
          }),
          { invoices: 0, billed: 0, collected: 0, outstanding: 0 },
        );
        return { title: "Revenue", rows, totals };
      }
      case "collections": {
        const rows = this.core.db
          .prepare(
            `SELECT method, COUNT(*) AS n, SUM(amount_paisa) AS amount FROM payments
             WHERE paid_at >= ? AND paid_at <= ? GROUP BY method ORDER BY amount DESC`,
          )
          .all(from, to);
        return { title: "Collections by method", rows: rows as Record<string, unknown>[] };
      }
      case "outstanding": {
        const rows = this.core.db
          .prepare(
            `SELECT p.code, p.full_name, i.number, i.due_paisa, i.issued_at
             FROM invoices i JOIN patients p ON p.id = i.patient_id
             WHERE i.status IN ('issued','partial') ORDER BY i.due_paisa DESC`,
          )
          .all();
        return { title: "Outstanding balances", rows: rows as Record<string, unknown>[] };
      }
      case "visits": {
        const rows = this.core.db
          .prepare(
            `SELECT date(visited_at) AS day, COUNT(*) AS visits FROM visits
             WHERE visited_at >= ? AND visited_at <= ? GROUP BY date(visited_at) ORDER BY day`,
          )
          .all(from, to);
        return { title: "Visits", rows: rows as Record<string, unknown>[] };
      }
      case "treatments": {
        const rows = this.core.db
          .prepare(
            `SELECT name, COUNT(*) AS n FROM visit_procedures vp
             JOIN visits v ON v.id = vp.visit_id
             WHERE v.visited_at >= ? AND v.visited_at <= ?
             GROUP BY name ORDER BY n DESC`,
          )
          .all(from, to);
        return { title: "Treatments performed", rows: rows as Record<string, unknown>[] };
      }
      case "appointments": {
        const rows = this.core.db
          .prepare(
            `SELECT status, COUNT(*) AS n FROM appointments
             WHERE starts_at >= ? AND starts_at <= ? GROUP BY status`,
          )
          .all(from, to);
        return { title: "Appointments", rows: rows as Record<string, unknown>[] };
      }
      case "inventory": {
        const rows = this.core.db
          .prepare(`SELECT sku, name, quantity, reorder_level FROM inventory_items WHERE active = 1 ORDER BY name`)
          .all();
        return { title: "Stock on hand", rows: rows as Record<string, unknown>[] };
      }
      case "patients": {
        const rows = this.core.db
          .prepare(
            `SELECT date(created_at) AS day, COUNT(*) AS n FROM patients
             WHERE created_at >= ? AND created_at <= ? GROUP BY date(created_at) ORDER BY day`,
          )
          .all(from, to);
        return { title: "Patient growth", rows: rows as Record<string, unknown>[] };
      }
      case "expenses": {
        const rows = this.core.db
          .prepare(
            `SELECT c.name AS category, SUM(t.amount_paisa) AS amount
             FROM accounting_transactions t LEFT JOIN accounting_categories c ON c.id = t.category_id
             WHERE t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at <= ?
             GROUP BY c.name ORDER BY amount DESC`,
          )
          .all(from, to);
        return { title: "Expenses", rows: rows as Record<string, unknown>[] };
      }
      default:
        throw new AppError("VALIDATION", "Unknown report.");
    }
  }

  listNotifications(actor: Actor, page = 1, pageSize = 30, unreadOnly = false): PageResult<unknown> {
    requireActor(actor);
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const where = unreadOnly ? "WHERE read_at IS NULL" : "";
    const total = (this.core.db.prepare(`SELECT COUNT(*) AS c FROM notifications ${where}`).get() as { c: number }).c;
    const items = this.core.db
      .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  markNotificationRead(actor: Actor, id: string): void {
    requireActor(actor);
    this.core.db.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").run(this.core.clock().toISOString(), id);
  }

  listAudit(actor: Actor, page = 1, pageSize = 50, entityType?: string, entityId?: string) {
    requirePermission(actor, "audit.view");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (entityType) {
      clauses.push("entity_type = ?");
      params.push(entityType);
    }
    if (entityId) {
      clauses.push("entity_id = ?");
      params.push(entityId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.core.db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${where}`).get(...params) as { c: number }).c;
    const items = this.core.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  savedViews(actor: Actor, entity?: string) {
    requireActor(actor);
    if (entity) {
      return this.core.db
        .prepare("SELECT * FROM saved_views WHERE (staff_id = ? OR staff_id IS NULL) AND entity = ? ORDER BY name")
        .all(actor.staffId, entity);
    }
    return this.core.db.prepare("SELECT * FROM saved_views WHERE staff_id = ? OR staff_id IS NULL ORDER BY name").all(actor.staffId);
  }

  saveView(actor: Actor, name: string, entity: string, filters: unknown) {
    requireActor(actor);
    const id = newId();
    this.core.db
      .prepare("INSERT INTO saved_views (id, staff_id, name, entity, filters_json, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, actor.staffId, name, entity, JSON.stringify(filters ?? {}), this.core.clock().toISOString());
    return this.core.db.prepare("SELECT * FROM saved_views WHERE id = ?").get(id);
  }

  deleteView(actor: Actor, id: string) {
    requireActor(actor);
    this.core.db.prepare("DELETE FROM saved_views WHERE id = ? AND staff_id = ?").run(id, actor.staffId);
  }

  diagnostics() {
    const integrity = this.core.db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const fk = this.core.db.pragma("foreign_key_check") as unknown[];
    const pageCount = this.core.db.pragma("page_count") as Array<{ page_count: number }>;
    const pageSize = this.core.db.pragma("page_size") as Array<{ page_size: number }>;
    const patients = (this.core.db.prepare("SELECT COUNT(*) AS c FROM patients").get() as { c: number }).c;
    const invoices = (this.core.db.prepare("SELECT COUNT(*) AS c FROM invoices").get() as { c: number }).c;
    return {
      integrity: integrity[0]?.integrity_check === "ok",
      integrityDetail: integrity[0]?.integrity_check,
      foreignKeyViolations: fk.length,
      pageCount: pageCount[0]?.page_count,
      pageSize: pageSize[0]?.page_size,
      patients,
      invoices,
      schema: (this.core.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v,
    };
  }

  accountingList(actor: Actor, from: string, to: string, page = 1, pageSize = 50) {
    requirePermission(actor, "accounting.read");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const total = (
      this.core.db
        .prepare(`SELECT COUNT(*) AS c FROM accounting_transactions WHERE occurred_at >= ? AND occurred_at <= ?`)
        .get(from, to) as { c: number }
    ).c;
    const items = this.core.db
      .prepare(
        `SELECT t.*, c.name AS category_name FROM accounting_transactions t
         LEFT JOIN accounting_categories c ON c.id = t.category_id
         WHERE t.occurred_at >= ? AND t.occurred_at <= ?
         ORDER BY t.occurred_at DESC LIMIT ? OFFSET ?`,
      )
      .all(from, to, limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  addExpense(actor: Actor, input: { amountPaisa: number; occurredAt: string; description: string; categoryId?: string }) {
    requirePermission(actor, "accounting.write");
    if (!input.amountPaisa || input.amountPaisa <= 0) throw new AppError("VALIDATION", "Enter an expense amount.");
    const id = newId();
    this.core.db
      .prepare(
        `INSERT INTO accounting_transactions (id, category_id, type, amount_paisa, occurred_at, description, reference_type, reference_id, created_at, created_by)
         VALUES (?, ?, 'expense', ?, ?, ?, 'manual', NULL, ?, ?)`,
      )
      .run(id, input.categoryId ?? null, input.amountPaisa, input.occurredAt, input.description, this.core.clock().toISOString(), actor.staffId);
    return this.core.db.prepare("SELECT * FROM accounting_transactions WHERE id = ?").get(id);
  }

  categories(actor: Actor) {
    requirePermission(actor, "accounting.read");
    return this.core.db.prepare("SELECT * FROM accounting_categories WHERE active = 1 ORDER BY type, name").all();
  }
}

function requireActor(actor: Actor) {
  if (!actor) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  return actor;
}
