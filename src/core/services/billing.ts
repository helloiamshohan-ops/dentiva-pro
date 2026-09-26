import { z } from "zod";
import { DateTime } from "luxon";
import type { Invoice, InvoiceLine, PageResult, Payment, Receipt, StatementLine } from "../../shared/types.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "../../shared/constants.ts";
import { AppError } from "../errors.ts";
import { newId, formatInvoiceNumber, formatReceiptNumber } from "../ids.ts";
import { assertPaisa, invoiceTotals, outstandingBalance, assertInvariant, type LineInput } from "../money.ts";
import { parse, nonEmpty, paginationSchema, pageOffset, paymentMethodSchema } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit, getClinicPrefixes, getClinicTimezone, nextSequence, upsertSearch, immediate, notify } from "../db/helpers.ts";

const lineSchema = z.object({
  treatmentId: z.string().optional(),
  visitId: z.string().optional(),
  description: nonEmpty("description", 240),
  tooth: z.string().max(12).optional(),
  quantity: z.number().int().min(1).max(9999),
  unitPricePaisa: z.number().int().min(0),
  discountPaisa: z.number().int().min(0).default(0),
});

const invoiceSchema = z.object({
  patientId: z.string().min(8),
  visitId: z.string().optional(),
  issuedAt: z.string().min(10),
  discountPaisa: z.number().int().min(0).default(0),
  taxPaisa: z.number().int().min(0).optional(),
  notes: z.string().max(4000).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one invoice line."),
  issue: z.boolean().optional(),
});

export class BillingService {
  constructor(private readonly core: Core) {}

  listInvoices(
    actor: Actor,
    query: { patientId?: string; status?: string; search?: string; page?: number; pageSize?: number; from?: string; to?: string },
  ): PageResult<Invoice> {
    requirePermission(actor, "billing.read");
    const p = parse(paginationSchema, { page: query.page ?? 1, pageSize: query.pageSize ?? 50 });
    const { limit, offset } = pageOffset(p);
    const clauses: string[] = ["1=1"];
    const params: unknown[] = [];
    if (query.patientId) {
      clauses.push("i.patient_id = ?");
      params.push(query.patientId);
    }
    if (query.status) {
      clauses.push("i.status = ?");
      params.push(query.status);
    }
    if (query.search) {
      clauses.push("(i.number LIKE ? OR p.full_name LIKE ? OR p.code LIKE ?)");
      const q = `%${query.search}%`;
      params.push(q, q, q);
    }
    if (query.from) {
      clauses.push("i.issued_at >= ?");
      params.push(query.from);
    }
    if (query.to) {
      clauses.push("i.issued_at <= ?");
      params.push(query.to);
    }
    const where = clauses.join(" AND ");
    const total = (
      this.core.db
        .prepare(`SELECT COUNT(*) AS c FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${where}`)
        .get(...params) as { c: number }
    ).c;
    const rows = this.core.db
      .prepare(
        `SELECT i.*, p.code AS patient_code, p.full_name AS patient_name
         FROM invoices i JOIN patients p ON p.id = i.patient_id
         WHERE ${where} ORDER BY i.issued_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as InvRow[];
    const items = rows.map((r) => this.hydrate(r, false));
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  getInvoice(actor: Actor, id: string): Invoice {
    requirePermission(actor, "billing.read");
    return this.mustInvoice(id);
  }

  createInvoice(actor: Actor, input: unknown): Invoice {
    requirePermission(actor, "billing.write");
    const data = parse(invoiceSchema, input);
    this.assertPatient(data.patientId);
    const id = newId();
    immediate(this.core.db, () => {
      this.writeInvoice(actor, id, data, true);
    });
    return this.mustInvoice(id);
  }

  updateInvoice(actor: Actor, id: string, input: unknown): Invoice {
    requirePermission(actor, "billing.write");
    const existing = this.mustInvoice(id);
    if (existing.status !== "draft") {
      throw new AppError(
        "FINANCIAL",
        "Issued invoices cannot be rewritten. Use a refund or adjustment to correct the account. No financial changes were made.",
      );
    }
    const data = parse(invoiceSchema, input);
    immediate(this.core.db, () => {
      this.core.db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(id);
      this.writeInvoice(actor, id, { ...data, patientId: existing.patientId }, false, existing.number);
    });
    return this.mustInvoice(id);
  }

  issueInvoice(actor: Actor, id: string): Invoice {
    requirePermission(actor, "billing.write");
    const inv = this.mustInvoice(id);
    if (inv.status !== "draft") return inv;
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE invoices SET status = 'issued', updated_at = ? WHERE id = ?").run(now, id);
    audit(this.core.db, actor, "invoice_issue", "invoice", id, { number: inv.number });
    notify(this.core.db, "invoice", "info", "Invoice issued", `${inv.number} for ${inv.patientName}`, "invoice", id);
    return this.mustInvoice(id);
  }

  voidInvoice(actor: Actor, id: string, reason: string): Invoice {
    requirePermission(actor, "billing.refund");
    const inv = this.mustInvoice(id);
    if (inv.paidPaisa > 0) {
      throw new AppError(
        "FINANCIAL",
        "This invoice has payments. Refund those payments before voiding. No financial changes were made.",
      );
    }
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare("UPDATE invoices SET status = 'void', due_paisa = 0, notes = ?, updated_at = ? WHERE id = ?")
      .run(`${inv.notes}\nVoid: ${reason}`.trim(), now, id);
    audit(this.core.db, actor, "invoice_void", "invoice", id, { reason });
    return this.mustInvoice(id);
  }

  receivePayment(actor: Actor, input: unknown): { payment: Payment; receipt: Receipt; invoice: Invoice } {
    requirePermission(actor, "billing.write");
    const schema = z.object({
      invoiceId: z.string().min(8),
      method: paymentMethodSchema,
      amountPaisa: z.number().int().positive("Enter a payment amount greater than zero."),
      paidAt: z.string().min(10),
      reference: z.string().max(120).optional(),
      notes: z.string().max(1000).optional(),
      idempotencyKey: z.string().max(80).optional(),
    });
    const data = parse(schema, input);
    let paymentId = "";
    let receiptId = "";
    immediate(this.core.db, () => {
      if (data.idempotencyKey) {
        const existing = this.core.db
          .prepare("SELECT id FROM payments WHERE idempotency_key = ?")
          .get(data.idempotencyKey) as { id: string } | undefined;
        if (existing) {
          paymentId = existing.id;
          const rec = this.core.db.prepare("SELECT id FROM receipts WHERE payment_id = ?").get(existing.id) as { id: string } | undefined;
          receiptId = rec?.id ?? "";
          return;
        }
      }
      const inv = this.core.db.prepare("SELECT * FROM invoices WHERE id = ?").get(data.invoiceId) as RawInv | undefined;
      if (!inv) throw new AppError("NOT_FOUND", "Invoice was not found.");
      if (inv.status === "draft") {
        throw new AppError("FINANCIAL", "Issue the invoice before recording a payment. No financial changes were made.");
      }
      if (inv.status === "void") {
        throw new AppError("FINANCIAL", "Cannot take payment on a void invoice. No financial changes were made.");
      }
      const amount = assertPaisa(data.amountPaisa, "payment");
      const sums = this.sums(inv.id);
      const due = outstandingBalance({
        total: inv.total_paisa,
        payments: sums.payments,
        refunds: sums.refunds,
        adjustments: sums.adjustments,
      });
      if (amount > due) {
        throw new AppError(
          "FINANCIAL",
          "Payment is greater than the amount due. No financial changes were made.",
          { details: { due, amount } },
        );
      }
      paymentId = newId();
      const now = this.core.clock().toISOString();
      try {
        this.core.db
          .prepare(
            `INSERT INTO payments (id, invoice_id, patient_id, method, amount_paisa, paid_at, reference, notes, created_at, created_by, idempotency_key)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            paymentId,
            inv.id,
            inv.patient_id,
            data.method,
            amount,
            data.paidAt,
            data.reference ?? null,
            data.notes ?? null,
            now,
            actor.staffId,
            data.idempotencyKey ?? null,
          );
      } catch (err) {
        throw new AppError("CONFLICT", "This payment was already recorded. No duplicate was created.", { cause: err });
      }
      const prefixes = getClinicPrefixes(this.core.db);
      const year = DateTime.fromISO(data.paidAt, { setZone: true }).setZone(getClinicTimezone(this.core.db)).year;
      const seqName = `receipt-${year}`;
      const seq = nextSequence(this.core.db, seqName);
      const number = formatReceiptNumber(year, seq, prefixes.receipt);
      receiptId = newId();
      this.core.db
        .prepare(
          `INSERT INTO receipts (id, number, payment_id, patient_id, issued_at, amount_paisa, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .run(receiptId, number, paymentId, inv.patient_id, data.paidAt, amount, now);
      this.recomputeInvoice(inv.id);
      this.postAccounting("income", amount, data.paidAt, `Payment ${number}`, "payment", paymentId, actor.staffId);
      audit(this.core.db, actor, "payment_create", "payment", paymentId, { invoiceId: inv.id, amount, method: data.method });
      upsertSearch(this.core.db, "payment", paymentId, number, `${data.method} ${amount}`, number);
    });
    const payment = this.getPayment(actor, paymentId);
    const receipt = this.getReceiptByPayment(actor, paymentId);
    const invoice = this.mustInvoice(payment.invoiceId);
    return { payment, receipt, invoice };
  }

  refund(actor: Actor, input: unknown) {
    requirePermission(actor, "billing.refund");
    const schema = z.object({
      invoiceId: z.string().min(8),
      paymentId: z.string().optional(),
      amountPaisa: z.number().int().positive(),
      refundedAt: z.string().min(10),
      method: paymentMethodSchema.optional(),
      reason: nonEmpty("reason", 500),
    });
    const data = parse(schema, input);
    const id = newId();
    immediate(this.core.db, () => {
      const inv = this.core.db.prepare("SELECT * FROM invoices WHERE id = ?").get(data.invoiceId) as RawInv | undefined;
      if (!inv) throw new AppError("NOT_FOUND", "Invoice was not found.");
      const sums = this.sums(inv.id);
      if (data.amountPaisa > sums.payments - sums.refunds) {
        throw new AppError("FINANCIAL", "Refund exceeds payments received. No financial changes were made.");
      }
      const now = this.core.clock().toISOString();
      this.core.db
        .prepare(
          `INSERT INTO refunds (id, payment_id, invoice_id, patient_id, amount_paisa, refunded_at, method, reason, created_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, data.paymentId ?? null, inv.id, inv.patient_id, data.amountPaisa, data.refundedAt, data.method ?? null, data.reason, now, actor.staffId);
      this.recomputeInvoice(inv.id);
      this.postAccounting("expense", data.amountPaisa, data.refundedAt, `Refund ${data.reason}`, "refund", id, actor.staffId);
      audit(this.core.db, actor, "refund_create", "refund", id, { amount: data.amountPaisa, reason: data.reason });
    });
    return this.core.db.prepare("SELECT * FROM refunds WHERE id = ?").get(id);
  }

  adjust(actor: Actor, input: unknown) {
    requirePermission(actor, "billing.refund");
    const schema = z.object({
      invoiceId: z.string().optional(),
      patientId: z.string().min(8),
      amountPaisa: z.number().int(),
      adjustedAt: z.string().min(10),
      reason: nonEmpty("reason", 500),
    });
    const data = parse(schema, input);
    if (data.amountPaisa === 0) throw new AppError("VALIDATION", "Adjustment amount cannot be zero.");
    const id = newId();
    const now = this.core.clock().toISOString();
    immediate(this.core.db, () => {
      this.core.db
        .prepare(
          `INSERT INTO adjustments (id, invoice_id, patient_id, amount_paisa, reason, adjusted_at, created_at, created_by)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(id, data.invoiceId ?? null, data.patientId, data.amountPaisa, data.reason, data.adjustedAt, now, actor.staffId);
      if (data.invoiceId) this.recomputeInvoice(data.invoiceId);
      audit(this.core.db, actor, "adjustment_create", "adjustment", id, { amount: data.amountPaisa });
    });
    return this.core.db.prepare("SELECT * FROM adjustments WHERE id = ?").get(id);
  }

  listPayments(actor: Actor, query: { patientId?: string; invoiceId?: string; page?: number; pageSize?: number }): PageResult<Payment> {
    requirePermission(actor, "billing.read");
    const p = parse(paginationSchema, { page: query.page ?? 1, pageSize: query.pageSize ?? 50 });
    const { limit, offset } = pageOffset(p);
    const clauses: string[] = ["1=1"];
    const params: unknown[] = [];
    if (query.patientId) {
      clauses.push("p.patient_id = ?");
      params.push(query.patientId);
    }
    if (query.invoiceId) {
      clauses.push("p.invoice_id = ?");
      params.push(query.invoiceId);
    }
    const where = clauses.join(" AND ");
    const total = (this.core.db.prepare(`SELECT COUNT(*) AS c FROM payments p WHERE ${where}`).get(...params) as { c: number }).c;
    const rows = this.core.db
      .prepare(
        `SELECT p.*, r.id AS receipt_id, r.number AS receipt_number
         FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
         WHERE ${where} ORDER BY p.paid_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as PayRow[];
    return { items: rows.map(toPayment), page: p.page, pageSize: p.pageSize, total };
  }

  getPayment(actor: Actor, id: string): Payment {
    requirePermission(actor, "billing.read");
    const row = this.core.db
      .prepare(
        `SELECT p.*, r.id AS receipt_id, r.number AS receipt_number
         FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id WHERE p.id = ?`,
      )
      .get(id) as PayRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Payment was not found.");
    return toPayment(row);
  }

  getReceipt(actor: Actor, id: string): Receipt {
    requirePermission(actor, "billing.read");
    const row = this.receiptRow("r.id = ?", id);
    if (!row) throw new AppError("NOT_FOUND", "Receipt was not found.");
    return row;
  }

  getReceiptByPayment(actor: Actor, paymentId: string): Receipt {
    requirePermission(actor, "billing.read");
    const row = this.receiptRow("r.payment_id = ?", paymentId);
    if (!row) throw new AppError("NOT_FOUND", "Receipt was not found.");
    return row;
  }

  statement(
    actor: Actor,
    patientId: string,
    from?: string,
    to?: string,
  ): {
    lines: StatementLine[];
    openingPaisa: number;
    totalBilled: number;
    totalPaid: number;
    totalRefunds: number;
    totalAdjustments: number;
    closingPaisa: number;
  } {
    requirePermission(actor, "billing.read");
    this.assertPatient(patientId);
    const invoices = this.core.db
      .prepare(
        `SELECT id, number, issued_at, total_paisa FROM invoices WHERE patient_id = ? AND status != 'void' AND status != 'draft' ORDER BY issued_at`,
      )
      .all(patientId) as Array<{ id: string; number: string; issued_at: string; total_paisa: number }>;
    const payments = this.core.db
      .prepare(`SELECT id, amount_paisa, paid_at, invoice_id FROM payments WHERE patient_id = ? ORDER BY paid_at`)
      .all(patientId) as Array<{ id: string; amount_paisa: number; paid_at: string; invoice_id: string }>;
    const refunds = this.core.db
      .prepare(`SELECT id, amount_paisa, refunded_at, invoice_id FROM refunds WHERE patient_id = ? ORDER BY refunded_at`)
      .all(patientId) as Array<{ id: string; amount_paisa: number; refunded_at: string; invoice_id: string }>;
    const adjustments = this.core.db
      .prepare(`SELECT id, amount_paisa, adjusted_at, reason FROM adjustments WHERE patient_id = ? ORDER BY adjusted_at`)
      .all(patientId) as Array<{ id: string; amount_paisa: number; adjusted_at: string; reason: string }>;

    type Ev = { at: string; kind: StatementLine["kind"]; description: string; reference: string; debit: number; credit: number };
    const events: Ev[] = [];
    for (const i of invoices) events.push({ at: i.issued_at, kind: "invoice", description: `Invoice ${i.number}`, reference: i.number, debit: i.total_paisa, credit: 0 });
    for (const p of payments) events.push({ at: p.paid_at, kind: "payment", description: "Payment received", reference: p.id, debit: 0, credit: p.amount_paisa });
    for (const r of refunds) events.push({ at: r.refunded_at, kind: "refund", description: "Refund", reference: r.id, debit: r.amount_paisa, credit: 0 });
    for (const a of adjustments) {
      if (a.amount_paisa >= 0) events.push({ at: a.adjusted_at, kind: "adjustment", description: a.reason, reference: a.id, debit: a.amount_paisa, credit: 0 });
      else events.push({ at: a.adjusted_at, kind: "adjustment", description: a.reason, reference: a.id, debit: 0, credit: -a.amount_paisa });
    }
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    let running = 0;
    let opening = 0;
    const lines: StatementLine[] = [];
    let totalBilled = 0;
    let totalPaid = 0;
    let totalRefunds = 0;
    let totalAdjustments = 0;
    for (const e of events) {
      const before = running;
      running += e.debit - e.credit;
      const inRange = (!from || e.at >= from) && (!to || e.at <= to);
      if (from && e.at < from) opening = running;
      if (inRange) {
        if (e.kind === "invoice") totalBilled += e.debit;
        if (e.kind === "payment") totalPaid += e.credit;
        if (e.kind === "refund") totalRefunds += e.debit;
        if (e.kind === "adjustment") totalAdjustments += e.debit - e.credit;
        lines.push({
          at: e.at,
          kind: e.kind,
          description: e.description,
          reference: e.reference,
          debitPaisa: e.debit,
          creditPaisa: e.credit,
          runningPaisa: running,
        });
      }
      void before;
    }
    return {
      lines,
      openingPaisa: from ? opening : 0,
      totalBilled,
      totalPaid,
      totalRefunds,
      totalAdjustments,
      closingPaisa: running,
    };
  }

  patientBalance(patientId: string): number {
    const row = this.core.db
      .prepare(
        `SELECT IFNULL(SUM(due_paisa), 0) AS d FROM invoices WHERE patient_id = ? AND status IN ('issued','partial')`,
      )
      .get(patientId) as { d: number };
    return row.d;
  }

  private writeInvoice(
    actor: Actor,
    id: string,
    data: z.infer<typeof invoiceSchema>,
    isNew: boolean,
    existingNumber?: string,
  ): void {
    const lines: LineInput[] = data.lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPricePaisa,
      discount: l.discountPaisa,
    }));
    let tax = data.taxPaisa;
    const settings = this.core.db.prepare("SELECT tax_rate_bps FROM clinic_settings WHERE id = 1").get() as { tax_rate_bps: number };
    const totalsBase = invoiceTotals(lines, data.discountPaisa, 0);
    if (tax === undefined) {
      tax = Math.trunc((totalsBase.subtotal - data.discountPaisa) * settings.tax_rate_bps / 10_000);
    }
    const totals = invoiceTotals(lines, data.discountPaisa, tax);
    assertInvariant(totals);
    const now = this.core.clock().toISOString();
    const prefixes = getClinicPrefixes(this.core.db);
    const year = DateTime.fromISO(data.issuedAt, { setZone: true }).setZone(getClinicTimezone(this.core.db)).year;
    const number = existingNumber ?? formatInvoiceNumber(year, nextSequence(this.core.db, `invoice-${year}`), prefixes.invoice);
    const status = data.issue ? "issued" : "draft";
    const due = status === "draft" ? 0 : totals.total;
    if (isNew) {
      this.core.db
        .prepare(
          `INSERT INTO invoices (
            id, number, patient_id, visit_id, issued_at, subtotal_paisa, discount_paisa, tax_paisa, total_paisa,
            paid_paisa, due_paisa, status, notes, created_at, updated_at, created_by
          ) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
        )
        .run(
          id,
          number,
          data.patientId,
          data.visitId ?? null,
          data.issuedAt,
          totals.subtotal,
          totals.discount,
          totals.tax,
          totals.total,
          due,
          status,
          data.notes ?? "",
          now,
          now,
          actor.staffId,
        );
    } else {
      this.core.db
        .prepare(
          `UPDATE invoices SET visit_id=?, issued_at=?, subtotal_paisa=?, discount_paisa=?, tax_paisa=?, total_paisa=?,
            paid_paisa=0, due_paisa=?, status=?, notes=?, updated_at=? WHERE id=?`,
        )
        .run(data.visitId ?? null, data.issuedAt, totals.subtotal, totals.discount, totals.tax, totals.total, due, status, data.notes ?? "", now, id);
    }
    data.lines.forEach((line, idx) => {
      const lt = invoiceTotals([{ quantity: line.quantity, unitPrice: line.unitPricePaisa, discount: line.discountPaisa }], 0, 0);
      this.core.db
        .prepare(
          `INSERT INTO invoice_lines (id, invoice_id, sequence, treatment_id, visit_id, description, tooth, quantity, unit_price_paisa, discount_paisa, line_total_paisa)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          newId(),
          id,
          idx + 1,
          line.treatmentId ?? null,
          line.visitId ?? null,
          line.description,
          line.tooth ?? null,
          line.quantity,
          line.unitPricePaisa,
          line.discountPaisa,
          lt.subtotal,
        );
    });
    const patient = this.core.db.prepare("SELECT code, full_name FROM patients WHERE id = ?").get(data.patientId) as {
      code: string;
      full_name: string;
    };
    upsertSearch(this.core.db, "invoice", id, number, `${patient.code} ${patient.full_name}`, number);
    audit(this.core.db, actor, isNew ? "invoice_create" : "invoice_update", "invoice", id, { number, total: totals.total });
  }

  private recomputeInvoice(id: string): void {
    const inv = this.core.db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as RawInv;
    const sums = this.sums(id);
    const due = outstandingBalance({
      total: inv.total_paisa,
      payments: sums.payments,
      refunds: sums.refunds,
      adjustments: sums.adjustments,
    });
    let status = inv.status;
    if (status !== "void" && status !== "draft") {
      if (due <= 0) status = "paid";
      else if (sums.payments > 0) status = "partial";
      else status = "issued";
    }
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare("UPDATE invoices SET paid_paisa = ?, due_paisa = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(sums.payments - sums.refunds, due, status, now, id);
  }

  private sums(invoiceId: string): { payments: number; refunds: number; adjustments: number } {
    const p = this.core.db.prepare("SELECT IFNULL(SUM(amount_paisa),0) AS s FROM payments WHERE invoice_id = ?").get(invoiceId) as { s: number };
    const r = this.core.db.prepare("SELECT IFNULL(SUM(amount_paisa),0) AS s FROM refunds WHERE invoice_id = ?").get(invoiceId) as { s: number };
    const a = this.core.db.prepare("SELECT IFNULL(SUM(amount_paisa),0) AS s FROM adjustments WHERE invoice_id = ?").get(invoiceId) as { s: number };
    return { payments: p.s, refunds: r.s, adjustments: a.s };
  }

  private postAccounting(
    type: "income" | "expense",
    amount: number,
    at: string,
    description: string,
    refType: string,
    refId: string,
    staffId: string,
  ) {
    const cat = this.core.db
      .prepare("SELECT id FROM accounting_categories WHERE type = ? AND active = 1 ORDER BY name LIMIT 1")
      .get(type) as { id: string } | undefined;
    this.core.db
      .prepare(
        `INSERT INTO accounting_transactions (id, category_id, type, amount_paisa, occurred_at, description, reference_type, reference_id, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(newId(), cat?.id ?? null, type, amount, at, description, refType, refId, this.core.clock().toISOString(), staffId);
  }

  private mustInvoice(id: string): Invoice {
    const row = this.core.db
      .prepare(
        `SELECT i.*, p.code AS patient_code, p.full_name AS patient_name
         FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`,
      )
      .get(id) as InvRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Invoice was not found.");
    return this.hydrate(row, true);
  }

  private hydrate(row: InvRow, withLines: boolean): Invoice {
    const lines: InvoiceLine[] = withLines
      ? (
          this.core.db
            .prepare("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sequence")
            .all(row.id) as Array<{
            id: string;
            sequence: number;
            treatment_id: string | null;
            visit_id: string | null;
            description: string;
            tooth: string | null;
            quantity: number;
            unit_price_paisa: number;
            discount_paisa: number;
            line_total_paisa: number;
          }>
        ).map((l) => ({
          id: l.id,
          sequence: l.sequence,
          treatmentId: l.treatment_id,
          visitId: l.visit_id,
          description: l.description,
          tooth: l.tooth,
          quantity: l.quantity,
          unitPricePaisa: l.unit_price_paisa,
          discountPaisa: l.discount_paisa,
          lineTotalPaisa: l.line_total_paisa,
        }))
      : [];
    return {
      id: row.id,
      number: row.number,
      patientId: row.patient_id,
      patientCode: row.patient_code,
      patientName: row.patient_name,
      visitId: row.visit_id,
      issuedAt: row.issued_at,
      subtotalPaisa: row.subtotal_paisa,
      discountPaisa: row.discount_paisa,
      taxPaisa: row.tax_paisa,
      totalPaisa: row.total_paisa,
      paidPaisa: row.paid_paisa,
      duePaisa: row.due_paisa,
      status: row.status,
      notes: row.notes,
      lines,
    };
  }

  private receiptRow(where: string, arg: string): Receipt | undefined {
    const row = this.core.db
      .prepare(
        `SELECT r.*, p.method, p.reference, p.invoice_id, i.number AS invoice_number, i.due_paisa,
                pt.code AS patient_code, pt.full_name AS patient_name
         FROM receipts r
         JOIN payments p ON p.id = r.payment_id
         JOIN invoices i ON i.id = p.invoice_id
         JOIN patients pt ON pt.id = r.patient_id
         WHERE ${where}`,
      )
      .get(arg) as
      | {
          id: string;
          number: string;
          payment_id: string;
          patient_id: string;
          patient_code: string;
          patient_name: string;
          issued_at: string;
          amount_paisa: number;
          method: PaymentMethod;
          invoice_number: string;
          due_paisa: number;
          reference: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      number: row.number,
      paymentId: row.payment_id,
      patientId: row.patient_id,
      patientCode: row.patient_code,
      patientName: row.patient_name,
      issuedAt: row.issued_at,
      amountPaisa: row.amount_paisa,
      method: row.method,
      invoiceNumber: row.invoice_number,
      remainingPaisa: row.due_paisa,
      reference: row.reference,
    };
  }

  private assertPatient(id: string) {
    const row = this.core.db.prepare("SELECT id FROM patients WHERE id = ?").get(id);
    if (!row) throw new AppError("NOT_FOUND", "Patient was not found.");
  }
}

type RawInv = {
  id: string;
  number: string;
  patient_id: string;
  total_paisa: number;
  status: string;
  paid_paisa: number;
};

type InvRow = {
  id: string;
  number: string;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  visit_id: string | null;
  issued_at: string;
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
  status: Invoice["status"];
  notes: string;
};

type PayRow = {
  id: string;
  invoice_id: string;
  patient_id: string;
  receipt_id: string | null;
  receipt_number: string | null;
  method: PaymentMethod;
  amount_paisa: number;
  paid_at: string;
  reference: string | null;
  notes: string | null;
};

function toPayment(row: PayRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,
    method: row.method,
    amountPaisa: row.amount_paisa,
    paidAt: row.paid_at,
    reference: row.reference,
    notes: row.notes,
  };
}

void PAYMENT_METHODS;
