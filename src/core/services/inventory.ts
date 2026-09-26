import { z } from "zod";
import type { PageResult } from "../../shared/types.ts";
import { AppError } from "../errors.ts";
import { newId, formatPurchaseNumber } from "../ids.ts";
import { assertPaisa, mulQty } from "../money.ts";
import { parse, nonEmpty, paginationSchema, pageOffset } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit, getClinicTimezone, nextSequence, notify, upsertSearch, immediate } from "../db/helpers.ts";
import { DateTime } from "luxon";

const itemSchema = z.object({
  sku: nonEmpty("SKU", 64),
  name: nonEmpty("item name", 180),
  category: z.string().max(80).optional(),
  supplierId: z.string().optional(),
  purchasePricePaisa: z.number().int().min(0).default(0),
  salePricePaisa: z.number().int().min(0).default(0),
  reorderLevel: z.number().int().min(0).default(0),
  unit: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

export class InventoryService {
  constructor(private readonly core: Core) {}

  listItems(actor: Actor, query: { search?: string; page?: number; pageSize?: number; lowStock?: boolean }): PageResult<Item> {
    requirePermission(actor, "inventory.read");
    const p = parse(paginationSchema, { page: query.page ?? 1, pageSize: query.pageSize ?? 50 });
    const { limit, offset } = pageOffset(p);
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (query.search) {
      clauses.push("(sku LIKE ? OR name LIKE ?)");
      const q = `%${query.search}%`;
      params.push(q, q);
    }
    if (query.lowStock) clauses.push("quantity <= reorder_level");
    const where = clauses.join(" AND ");
    const total = (this.core.db.prepare(`SELECT COUNT(*) AS c FROM inventory_items WHERE ${where}`).get(...params) as { c: number }).c;
    const items = this.core.db
      .prepare(`SELECT * FROM inventory_items WHERE ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ItemRow[];
    return { items: items.map(toItem), page: p.page, pageSize: p.pageSize, total };
  }

  getItem(actor: Actor, id: string): Item {
    requirePermission(actor, "inventory.read");
    const row = this.core.db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id) as ItemRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Inventory item was not found.");
    const batches = this.core.db.prepare("SELECT * FROM inventory_batches WHERE item_id = ? ORDER BY expiry_date").all(id);
    return { ...toItem(row), batches };
  }

  createItem(actor: Actor, input: unknown): Item {
    requirePermission(actor, "inventory.write");
    const data = parse(itemSchema, input);
    const id = newId();
    const now = this.core.clock().toISOString();
    try {
      this.core.db
        .prepare(
          `INSERT INTO inventory_items (
            id, sku, name, category, supplier_id, purchase_price_paisa, sale_price_paisa, quantity, reorder_level, unit, notes, active, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
        )
        .run(
          id,
          data.sku,
          data.name,
          data.category ?? "",
          data.supplierId ?? null,
          data.purchasePricePaisa,
          data.salePricePaisa,
          data.reorderLevel,
          data.unit ?? "",
          data.notes ?? "",
          data.active === false ? 0 : 1,
          now,
          now,
        );
    } catch (err) {
      throw new AppError("CONFLICT", "An item with that SKU already exists.", { cause: err });
    }
    upsertSearch(this.core.db, "inventory", id, `${data.sku} ${data.name}`, data.category ?? "", data.sku);
    audit(this.core.db, actor, "inventory_item_create", "inventory_item", id);
    return this.getItem(actor, id);
  }

  updateItem(actor: Actor, id: string, input: unknown): Item {
    requirePermission(actor, "inventory.write");
    const data = parse(itemSchema.partial(), input);
    const now = this.core.clock().toISOString();
    const existing = this.core.db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id) as ItemRow | undefined;
    if (!existing) throw new AppError("NOT_FOUND", "Inventory item was not found.");
    this.core.db
      .prepare(
        `UPDATE inventory_items SET sku=?, name=?, category=?, supplier_id=?, purchase_price_paisa=?, sale_price_paisa=?,
          reorder_level=?, unit=?, notes=?, active=?, updated_at=? WHERE id=?`,
      )
      .run(
        data.sku ?? existing.sku,
        data.name ?? existing.name,
        data.category ?? existing.category,
        data.supplierId ?? existing.supplier_id,
        data.purchasePricePaisa ?? existing.purchase_price_paisa,
        data.salePricePaisa ?? existing.sale_price_paisa,
        data.reorderLevel ?? existing.reorder_level,
        data.unit ?? existing.unit,
        data.notes ?? existing.notes,
        data.active === undefined ? existing.active : data.active ? 1 : 0,
        now,
        id,
      );
    audit(this.core.db, actor, "inventory_item_update", "inventory_item", id);
    return this.getItem(actor, id);
  }

  adjustStock(actor: Actor, input: unknown) {
    requirePermission(actor, "inventory.adjust");
    const schema = z.object({
      itemId: z.string().min(8),
      delta: z.number().int(),
      reason: nonEmpty("reason", 500),
      type: z.enum(["adjustment", "wastage", "use"]).default("adjustment"),
      batchId: z.string().optional(),
    });
    const data = parse(schema, input);
    if (data.delta === 0) throw new AppError("VALIDATION", "Quantity change cannot be zero.");
    const id = newId();
    immediate(this.core.db, () => {
      const item = this.core.db.prepare("SELECT quantity, name, reorder_level FROM inventory_items WHERE id = ?").get(data.itemId) as
        | { quantity: number; name: string; reorder_level: number }
        | undefined;
      if (!item) throw new AppError("NOT_FOUND", "Inventory item was not found.");
      const next = item.quantity + data.delta;
      if (next < 0) {
        throw new AppError("INVENTORY", "This change would make stock negative. No inventory changes were made.");
      }
      const now = this.core.clock().toISOString();
      this.core.db.prepare("UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?").run(next, now, data.itemId);
      if (data.batchId) {
        const batch = this.core.db.prepare("SELECT quantity FROM inventory_batches WHERE id = ?").get(data.batchId) as { quantity: number } | undefined;
        if (!batch) throw new AppError("NOT_FOUND", "Batch was not found.");
        const bnext = batch.quantity + data.delta;
        if (bnext < 0) throw new AppError("INVENTORY", "This change would make batch stock negative. No inventory changes were made.");
        this.core.db.prepare("UPDATE inventory_batches SET quantity = ? WHERE id = ?").run(bnext, data.batchId);
      }
      this.core.db
        .prepare(
          `INSERT INTO inventory_movements (id, item_id, batch_id, type, quantity_delta, unit_cost_paisa, reason, reference_type, reference_id, occurred_at, created_at, created_by)
           VALUES (?,?,?,?,?,NULL,?,?,NULL,?,?,?)`,
        )
        .run(id, data.itemId, data.batchId ?? null, data.type, data.delta, data.reason, "adjustment", id, now, now, actor.staffId);
      if (next <= item.reorder_level) {
        notify(this.core.db, "low_stock", "warning", "Low stock", `${item.name} is at ${next}`, "inventory_item", data.itemId);
      }
      audit(this.core.db, actor, "stock_adjust", "inventory_item", data.itemId, { delta: data.delta, reason: data.reason });
    });
    return this.core.db.prepare("SELECT * FROM inventory_movements WHERE id = ?").get(id);
  }

  listSuppliers(actor: Actor) {
    requirePermission(actor, "inventory.read");
    return this.core.db.prepare("SELECT * FROM suppliers ORDER BY name COLLATE NOCASE").all();
  }

  saveSupplier(actor: Actor, input: unknown) {
    requirePermission(actor, "inventory.write");
    const schema = z.object({
      id: z.string().optional(),
      name: nonEmpty("supplier name", 180),
      contact: z.string().max(120).optional(),
      phone: z.string().max(40).optional(),
      email: z.string().max(180).optional(),
      address: z.string().max(400).optional(),
      notes: z.string().max(2000).optional(),
    });
    const data = parse(schema, input);
    const now = this.core.clock().toISOString();
    const id = data.id ?? newId();
    if (data.id) {
      this.core.db
        .prepare("UPDATE suppliers SET name=?, contact=?, phone=?, email=?, address=?, notes=?, updated_at=? WHERE id=?")
        .run(data.name, data.contact ?? null, data.phone ?? null, data.email ?? null, data.address ?? null, data.notes ?? null, now, id);
    } else {
      this.core.db
        .prepare(
          `INSERT INTO suppliers (id, name, contact, phone, email, address, notes, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, data.name, data.contact ?? null, data.phone ?? null, data.email ?? null, data.address ?? null, data.notes ?? null, now, now);
    }
    audit(this.core.db, actor, "supplier_save", "supplier", id);
    return this.core.db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id);
  }

  createPurchase(actor: Actor, input: unknown) {
    requirePermission(actor, "inventory.write");
    const schema = z.object({
      supplierId: z.string().optional(),
      purchasedAt: z.string().min(10),
      notes: z.string().max(2000).optional(),
      lines: z
        .array(
          z.object({
            itemId: z.string().min(8),
            batchCode: z.string().max(80).optional(),
            expiryDate: z.string().optional(),
            quantity: z.number().int().min(1),
            unitCostPaisa: z.number().int().min(0),
          }),
        )
        .min(1),
    });
    const data = parse(schema, input);
    const id = newId();
    immediate(this.core.db, () => {
      let total = 0;
      for (const line of data.lines) total += mulQty(assertPaisa(line.unitCostPaisa, "unit cost"), line.quantity);
      const year = DateTime.fromISO(data.purchasedAt, { setZone: true }).setZone(getClinicTimezone(this.core.db)).year;
      const number = formatPurchaseNumber(year, nextSequence(this.core.db, `purchase-${year}`));
      const now = this.core.clock().toISOString();
      this.core.db
        .prepare(
          `INSERT INTO purchases (id, supplier_id, number, purchased_at, total_paisa, paid_paisa, status, notes, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, 0, 'unpaid', ?, ?, ?)`,
        )
        .run(id, data.supplierId ?? null, number, data.purchasedAt, total, data.notes ?? "", now, actor.staffId);
      for (const line of data.lines) {
        const lineTotal = mulQty(line.unitCostPaisa, line.quantity);
        this.core.db
          .prepare(
            `INSERT INTO purchase_lines (id, purchase_id, item_id, batch_code, expiry_date, quantity, unit_cost_paisa, line_total_paisa)
             VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(newId(), id, line.itemId, line.batchCode ?? null, line.expiryDate ?? null, line.quantity, line.unitCostPaisa, lineTotal);
        const item = this.core.db.prepare("SELECT quantity FROM inventory_items WHERE id = ?").get(line.itemId) as { quantity: number } | undefined;
        if (!item) throw new AppError("NOT_FOUND", "Inventory item was not found.");
        this.core.db
          .prepare("UPDATE inventory_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?")
          .run(line.quantity, now, line.itemId);
        let batchId: string | null = null;
        if (line.batchCode) {
          const existing = this.core.db
            .prepare("SELECT id FROM inventory_batches WHERE item_id = ? AND batch_code = ?")
            .get(line.itemId, line.batchCode) as { id: string } | undefined;
          if (existing) {
            batchId = existing.id;
            this.core.db.prepare("UPDATE inventory_batches SET quantity = quantity + ? WHERE id = ?").run(line.quantity, batchId);
          } else {
            batchId = newId();
            this.core.db
              .prepare(
                `INSERT INTO inventory_batches (id, item_id, batch_code, expiry_date, quantity, created_at)
                 VALUES (?,?,?,?,?,?)`,
              )
              .run(batchId, line.itemId, line.batchCode, line.expiryDate ?? null, line.quantity, now);
          }
          if (line.expiryDate) {
            notify(this.core.db, "expiry", "info", "Batch received", `Batch ${line.batchCode} expires ${line.expiryDate}`, "inventory_item", line.itemId);
          }
        }
        this.core.db
          .prepare(
            `INSERT INTO inventory_movements (id, item_id, batch_id, type, quantity_delta, unit_cost_paisa, reason, reference_type, reference_id, occurred_at, created_at, created_by)
             VALUES (?,?,?,'purchase',?,?, 'Purchase', 'purchase', ?, ?, ?, ?)`,
          )
          .run(newId(), line.itemId, batchId, line.quantity, line.unitCostPaisa, id, data.purchasedAt, now, actor.staffId);
      }
      audit(this.core.db, actor, "purchase_create", "purchase", id, { total });
    });
    return this.getPurchase(actor, id);
  }

  getPurchase(actor: Actor, id: string) {
    requirePermission(actor, "inventory.read");
    const purchase = this.core.db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
    if (!purchase) throw new AppError("NOT_FOUND", "Purchase was not found.");
    const lines = this.core.db.prepare("SELECT * FROM purchase_lines WHERE purchase_id = ?").all(id);
    return { ...(purchase as object), lines };
  }

  payPurchase(actor: Actor, input: unknown) {
    requirePermission(actor, "inventory.write");
    const data = parse(
      z.object({
        id: z.string().min(8),
        amountPaisa: z.number().int().positive("Enter a payment amount greater than zero."),
      }),
      input,
    );
    immediate(this.core.db, () => {
      const row = this.core.db.prepare("SELECT id, total_paisa, paid_paisa FROM purchases WHERE id = ?").get(data.id) as
        | { id: string; total_paisa: number; paid_paisa: number }
        | undefined;
      if (!row) throw new AppError("NOT_FOUND", "Purchase was not found.");
      const due = row.total_paisa - row.paid_paisa;
      if (data.amountPaisa > due) {
        throw new AppError("FINANCIAL", "Purchase payment is greater than the amount due. No financial changes were made.", {
          details: { due, amount: data.amountPaisa },
        });
      }
      const paid = row.paid_paisa + data.amountPaisa;
      const status = paid >= row.total_paisa ? "paid" : "partial";
      this.core.db.prepare("UPDATE purchases SET paid_paisa = ?, status = ? WHERE id = ?").run(paid, status, row.id);
      audit(this.core.db, actor, "purchase_pay", "purchase", row.id, { amount: data.amountPaisa, status });
    });
    return this.getPurchase(actor, data.id);
  }

  listPurchases(actor: Actor, page = 1, pageSize = 50) {
    requirePermission(actor, "inventory.read");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const total = (this.core.db.prepare("SELECT COUNT(*) AS c FROM purchases").get() as { c: number }).c;
    const items = this.core.db.prepare("SELECT * FROM purchases ORDER BY purchased_at DESC LIMIT ? OFFSET ?").all(limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  movements(actor: Actor, itemId: string, page = 1, pageSize = 50) {
    requirePermission(actor, "inventory.read");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const total = (this.core.db.prepare("SELECT COUNT(*) AS c FROM inventory_movements WHERE item_id = ?").get(itemId) as { c: number }).c;
    const items = this.core.db
      .prepare("SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY occurred_at DESC LIMIT ? OFFSET ?")
      .all(itemId, limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  expiring(actor: Actor, withinDays = 60) {
    requirePermission(actor, "inventory.read");
    const until = DateTime.fromJSDate(this.core.clock()).plus({ days: withinDays }).toISODate();
    return this.core.db
      .prepare(
        `SELECT b.*, i.name AS item_name, i.sku FROM inventory_batches b
         JOIN inventory_items i ON i.id = b.item_id
         WHERE b.expiry_date IS NOT NULL AND b.expiry_date <= ? AND b.quantity > 0
         ORDER BY b.expiry_date`,
      )
      .all(until);
  }
}

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  supplier_id: string | null;
  purchase_price_paisa: number;
  sale_price_paisa: number;
  quantity: number;
  reorder_level: number;
  unit: string;
  notes: string;
  active: number;
};

type Item = ReturnType<typeof toItem> & { batches?: unknown };

function toItem(row: ItemRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    supplierId: row.supplier_id,
    purchasePricePaisa: row.purchase_price_paisa,
    salePricePaisa: row.sale_price_paisa,
    quantity: row.quantity,
    reorderLevel: row.reorder_level,
    unit: row.unit,
    notes: row.notes,
    active: row.active === 1,
  };
}
