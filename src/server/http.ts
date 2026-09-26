import http from "node:http";
import { URL } from "node:url";
import { toUserError, isAppError, AppError } from "../core/errors.ts";
import type { DentivaApp } from "../core/app.ts";
import type { Actor } from "../core/context.ts";

type Handler = (ctx: {
  app: DentivaApp;
  actor: Actor | null;
  body: unknown;
  query: URLSearchParams;
}) => unknown | Promise<unknown>;

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 32 * 1024 * 1024) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export function createApiServer(app: DentivaApp, host = "0.0.0.0", port = 4780): http.Server {
  const routes = buildRoutes();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/health") {
      json(res, 200, { ok: true, ...app.info() });
      return;
    }
    const key = `${req.method || "GET"} ${url.pathname}`;
    const handler = routes.get(key);
    if (!handler) {
      json(res, 404, { error: { code: "NOT_FOUND", message: "Unknown request." } });
      return;
    }
    try {
      const body = req.method === "GET" ? {} : await readBody(req);
      const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      let actor: Actor | null = null;
      const publicPath = url.pathname.startsWith("/api/auth/") || url.pathname === "/api/meta/setup";
      if (!publicPath) {
        actor = app.auth.resolve(auth);
      } else if (auth) {
        try {
          actor = app.auth.resolve(auth);
        } catch {
          actor = null;
        }
      }
      const result = await handler({ app, actor, body, query: url.searchParams });
      if (result && typeof result === "object" && (result as { $binary?: boolean }).$binary) {
        const bin = result as { $binary: boolean; data: Buffer; filename: string; mime: string };
        res.writeHead(200, {
          "Content-Type": bin.mime,
          "Content-Disposition": `attachment; filename="${bin.filename}"`,
          "Content-Length": bin.data.length,
        });
        res.end(bin.data);
        return;
      }
      json(res, 200, { data: result });
    } catch (err) {
      const u = toUserError(err);
      const status = isAppError(err) ? err.httpStatus : 500;
      json(res, status, { error: { code: u.code, message: u.message, details: isAppError(err) ? err.details : undefined } });
    }
  });
  server.listen(port, host);
  return server;
}

function buildRoutes(): Map<string, Handler> {
  const r = new Map<string, Handler>();
  const add = (method: string, path: string, fn: Handler) => r.set(`${method} ${path}`, fn);

  add("GET", "/api/meta/setup", ({ app }) => ({ needsSetup: app.auth.needsSetup(), info: app.info() }));
  add("POST", "/api/auth/bootstrap", async ({ app, body }) => app.auth.bootstrap(body));
  add("POST", "/api/auth/login", async ({ app, body }) => app.auth.login(body));
  add("POST", "/api/auth/logout", ({ app, body }) => {
    const token = (body as { token?: string }).token;
    if (token) app.auth.logout(token);
    return { ok: true };
  });
  add("GET", "/api/auth/session", ({ app, query }) => {
    const token = query.get("token") || "";
    return app.auth.touch(token).session;
  });
  add("POST", "/api/auth/lock", ({ app, body }) => app.auth.lock((body as { token: string }).token));
  add("POST", "/api/auth/unlock", async ({ app, body }) => {
    const b = body as { token: string; password: string };
    return app.auth.unlock(b.token, b.password);
  });
  add("POST", "/api/auth/password", async ({ app, actor, body }) => {
    const b = body as { current: string; next: string };
    await app.auth.updateOwnPassword(must(actor), b.current, b.next);
    return { ok: true };
  });

  add("GET", "/api/clinic", ({ app }) => app.clinic.get());
  add("PUT", "/api/clinic", ({ app, actor, body }) => app.clinic.update(must(actor), body));
  add("GET", "/api/treatments", ({ app }) => app.clinic.listTreatments(false));
  add("POST", "/api/treatments", ({ app, actor, body }) => app.clinic.saveTreatment(must(actor), body));

  add("GET", "/api/staff", ({ app, actor }) => app.auth.listStaff(must(actor)));
  add("POST", "/api/staff", async ({ app, actor, body }) => app.auth.createStaff(must(actor), body));
  add("PATCH", "/api/staff", ({ app, actor, body }) => {
    const b = body as { id: string; name?: string; role?: import("../shared/constants.ts").Role; contact?: string; active?: boolean };
    return app.auth.updateStaff(must(actor), b.id, b);
  });
  add("POST", "/api/staff/password", async ({ app, actor, body }) => {
    const b = body as { id: string; password: string };
    await app.auth.resetStaffPassword(must(actor), b.id, b.password);
    return { ok: true };
  });
  add("GET", "/api/dentists", ({ app }) => app.auth.listDentists());

  add("POST", "/api/patients/list", ({ app, actor, body }) => app.patients.list(must(actor), body as never));
  add("GET", "/api/patients/get", ({ app, actor, query }) => app.patients.get(must(actor), query.get("id") || ""));
  add("GET", "/api/patients/resolve", ({ app, actor, query }) => app.patients.resolve(must(actor), query.get("q") || ""));
  add("POST", "/api/patients", ({ app, actor, body }) => app.patients.create(must(actor), body));
  add("PUT", "/api/patients", ({ app, actor, body }) => {
    const b = body as { id: string };
    return app.patients.update(must(actor), b.id, body);
  });
  add("POST", "/api/patients/duplicates", ({ app, body }) => app.patients.findDuplicates(body as never));
  add("GET", "/api/patients/medical", ({ app, actor, query }) => app.patients.medical(must(actor), query.get("id") || ""));
  add("GET", "/api/patients/dental", ({ app, actor, query }) => app.patients.dental(must(actor), query.get("id") || ""));
  add("POST", "/api/patients/archive", ({ app, actor, body }) => {
    const b = body as { id: string; archived: boolean };
    return app.patients.archive(must(actor), b.id, b.archived);
  });

  add("POST", "/api/visits/list", ({ app, actor, body }) => {
    const b = body as { patientId: string; page?: number; pageSize?: number };
    return app.clinical.listVisits(must(actor), b.patientId, b.page, b.pageSize);
  });
  add("GET", "/api/visits/get", ({ app, actor, query }) => app.clinical.getVisit(must(actor), query.get("id") || ""));
  add("POST", "/api/visits", ({ app, actor, body }) => app.clinical.createVisit(must(actor), body));
  add("PUT", "/api/visits", ({ app, actor, body }) => {
    const b = body as { id: string };
    return app.clinical.updateVisit(must(actor), b.id, body);
  });

  add("GET", "/api/chart", ({ app, actor, query }) => app.clinical.getChart(must(actor), query.get("patientId") || ""));
  add("POST", "/api/chart", ({ app, actor, body }) => {
    const b = body as { patientId: string; toothFdi: string; state: string; notes?: string; visitId?: string };
    app.clinical.setTooth(must(actor), b.patientId, b.toothFdi, b.state, b.notes, b.visitId);
    return { ok: true };
  });

  add("POST", "/api/prescriptions/list", ({ app, actor, body }) => {
    const b = body as { patientId: string; page?: number };
    return app.clinical.listPrescriptions(must(actor), b.patientId, b.page);
  });
  add("GET", "/api/prescriptions/get", ({ app, actor, query }) => app.clinical.getPrescription(must(actor), query.get("id") || ""));
  add("POST", "/api/prescriptions", ({ app, actor, body }) => app.clinical.createPrescription(must(actor), body));
  add("PUT", "/api/prescriptions", ({ app, actor, body }) => {
    const b = body as { id: string };
    return app.clinical.updatePrescription(must(actor), b.id, body);
  });

  add("POST", "/api/plans", ({ app, actor, body }) => app.clinical.createPlan(must(actor), body));
  add("GET", "/api/plans/list", ({ app, actor, query }) => app.clinical.listPlans(must(actor), query.get("patientId") || ""));
  add("POST", "/api/plans/status", ({ app, actor, body }) => {
    const b = body as { id: string; status: string };
    return app.clinical.setPlanStatus(must(actor), b.id, b.status);
  });
  add("POST", "/api/referrals", ({ app, actor, body }) => app.clinical.createReferral(must(actor), body));
  add("GET", "/api/referrals", ({ app, actor, query }) => app.clinical.listReferrals(must(actor), query.get("patientId") || ""));
  add("POST", "/api/followups", ({ app, actor, body }) => app.clinical.createFollowup(must(actor), body));
  add("POST", "/api/followups/list", ({ app, actor, body }) => app.clinical.listFollowups(must(actor), body as never));
  add("POST", "/api/followups/complete", ({ app, actor, body }) => {
    const b = body as { id: string; notes?: string };
    app.clinical.completeFollowup(must(actor), b.id, b.notes);
    return { ok: true };
  });
  add("GET", "/api/timeline", ({ app, actor, query }) =>
    app.clinical.timeline(must(actor), query.get("patientId") || "", Number(query.get("page") || 1), Number(query.get("pageSize") || 50)),
  );

  add("POST", "/api/appointments/list", ({ app, actor, body }) => app.schedule.listAppointments(must(actor), body as never));
  add("POST", "/api/appointments", ({ app, actor, body }) => {
    const b = body as { patientId: string } & Record<string, unknown>;
    const patient = app.patients.resolve(must(actor), b.patientId);
    return app.schedule.createAppointment(must(actor), { ...b, patientId: patient.id });
  });
  add("PUT", "/api/appointments", ({ app, actor, body }) => {
    const b = body as { id: string };
    return app.schedule.updateAppointment(must(actor), b.id, body);
  });
  add("POST", "/api/appointments/status", ({ app, actor, body }) => {
    const b = body as { id: string; status: string };
    return app.schedule.setAppointmentStatus(must(actor), b.id, b.status);
  });
  add("GET", "/api/chairs", ({ app }) => app.schedule.listChairs());
  add("GET", "/api/rooms", ({ app }) => app.schedule.listRooms());

  add("GET", "/api/queue", ({ app, actor, query }) => app.schedule.listQueue(must(actor), query.get("date") || undefined));
  add("POST", "/api/queue", ({ app, actor, body }) => {
    const b = body as { patientId: string; appointmentId?: string; notes?: string };
    const patient = app.patients.resolve(must(actor), b.patientId);
    return app.schedule.enqueue(must(actor), patient.id, b.appointmentId, b.notes);
  });
  add("POST", "/api/queue/status", ({ app, actor, body }) => {
    const b = body as { id: string; status: string };
    return app.schedule.setQueueStatus(must(actor), b.id, b.status);
  });

  add("POST", "/api/invoices/list", ({ app, actor, body }) => app.billing.listInvoices(must(actor), body as never));
  add("GET", "/api/invoices/get", ({ app, actor, query }) => app.billing.getInvoice(must(actor), query.get("id") || ""));
  add("POST", "/api/invoices", ({ app, actor, body }) => {
    const b = body as { patientId: string } & Record<string, unknown>;
    const patient = app.patients.resolve(must(actor), b.patientId);
    return app.billing.createInvoice(must(actor), { ...b, patientId: patient.id });
  });
  add("PUT", "/api/invoices", ({ app, actor, body }) => {
    const b = body as { id: string };
    return app.billing.updateInvoice(must(actor), b.id, body);
  });
  add("POST", "/api/invoices/issue", ({ app, actor, body }) => app.billing.issueInvoice(must(actor), (body as { id: string }).id));
  add("POST", "/api/invoices/void", ({ app, actor, body }) => {
    const b = body as { id: string; reason: string };
    return app.billing.voidInvoice(must(actor), b.id, b.reason);
  });
  add("POST", "/api/payments", ({ app, actor, body }) => app.billing.receivePayment(must(actor), body));
  add("POST", "/api/payments/list", ({ app, actor, body }) => app.billing.listPayments(must(actor), body as never));
  add("POST", "/api/refunds", ({ app, actor, body }) => app.billing.refund(must(actor), body));
  add("POST", "/api/adjustments", ({ app, actor, body }) => app.billing.adjust(must(actor), body));
  add("GET", "/api/receipts/get", ({ app, actor, query }) => app.billing.getReceipt(must(actor), query.get("id") || ""));
  add("GET", "/api/statement", ({ app, actor, query }) =>
    app.billing.statement(must(actor), query.get("patientId") || "", query.get("from") || undefined, query.get("to") || undefined),
  );

  add("POST", "/api/inventory/list", ({ app, actor, body }) => app.inventory.listItems(must(actor), body as never));
  add("GET", "/api/inventory/get", ({ app, actor, query }) => app.inventory.getItem(must(actor), query.get("id") || ""));
  add("POST", "/api/inventory", ({ app, actor, body }) => app.inventory.createItem(must(actor), body));
  add("PUT", "/api/inventory", ({ app, actor, body }) => {
    const b = body as { id: string };
    return app.inventory.updateItem(must(actor), b.id, body);
  });
  add("POST", "/api/inventory/adjust", ({ app, actor, body }) => app.inventory.adjustStock(must(actor), body));
  add("GET", "/api/suppliers", ({ app, actor }) => app.inventory.listSuppliers(must(actor)));
  add("POST", "/api/suppliers", ({ app, actor, body }) => app.inventory.saveSupplier(must(actor), body));
  add("POST", "/api/purchases", ({ app, actor, body }) => app.inventory.createPurchase(must(actor), body));
  add("GET", "/api/purchases/get", ({ app, actor, query }) => app.inventory.getPurchase(must(actor), query.get("id") || ""));
  add("POST", "/api/purchases/list", ({ app, actor, body }) => {
    const b = body as { page?: number; pageSize?: number };
    return app.inventory.listPurchases(must(actor), b.page, b.pageSize);
  });
  add("GET", "/api/inventory/expiring", ({ app, actor }) => app.inventory.expiring(must(actor)));

  add("GET", "/api/search", ({ app, actor, query }) => app.ops.search(must(actor), query.get("q") || ""));
  add("GET", "/api/dashboard", ({ app, actor }) => app.ops.dashboard(must(actor)));
  add("POST", "/api/reports", ({ app, actor, body }) => {
    const b = body as { kind: string; from: string; to: string };
    return app.ops.reports(must(actor), b.kind, b.from, b.to);
  });
  add("GET", "/api/notifications", ({ app, actor, query }) =>
    app.ops.listNotifications(must(actor), Number(query.get("page") || 1), 30, query.get("unread") === "1"),
  );
  add("POST", "/api/notifications/read", ({ app, actor, body }) => {
    app.ops.markNotificationRead(must(actor), (body as { id: string }).id);
    return { ok: true };
  });
  add("GET", "/api/audit", ({ app, actor, query }) =>
    app.ops.listAudit(must(actor), Number(query.get("page") || 1), 50, query.get("entityType") || undefined, query.get("entityId") || undefined),
  );
  add("GET", "/api/diagnostics", ({ app }) => app.ops.diagnostics());
  add("GET", "/api/accounting", ({ app, actor, query }) =>
    app.ops.accountingList(must(actor), query.get("from") || "1970-01-01", query.get("to") || "2999-01-01", Number(query.get("page") || 1)),
  );
  add("POST", "/api/accounting/expense", ({ app, actor, body }) => app.ops.addExpense(must(actor), body as never));
  add("GET", "/api/accounting/categories", ({ app, actor }) => app.ops.categories(must(actor)));
  add("GET", "/api/saved-views", ({ app, actor, query }) => app.ops.savedViews(must(actor), query.get("entity") || undefined));
  add("POST", "/api/saved-views", ({ app, actor, body }) => {
    const b = body as { name: string; entity: string; filters: unknown };
    return app.ops.saveView(must(actor), b.name, b.entity, b.filters);
  });

  add("POST", "/api/backup", async ({ app, actor, body }) => app.backup.create(must(actor), (body as { notes?: string }).notes));
  add("GET", "/api/backup/list", ({ app, actor, query }) => app.backup.list(must(actor), Number(query.get("page") || 1)));
  add("POST", "/api/restore", async ({ app, actor, body }) => {
    await app.restoreAndReopen(must(actor), (body as { path: string }).path);
    return { ok: true };
  });

  add("POST", "/api/import/preview", ({ app, body }) => app.importexport.previewCsv((body as { csv: string }).csv));
  add("POST", "/api/import/patients", ({ app, actor, body }) => {
    const b = body as { csv: string; mapping: Record<string, string>; ignoreDuplicates?: boolean };
    return app.importexport.importPatients(must(actor), b.csv, b.mapping, b.ignoreDuplicates);
  });
  add("GET", "/api/export/patients", ({ app, actor }) => ({ csv: app.importexport.exportPatientsCsv(must(actor)) }));

  add("GET", "/api/attachments", ({ app, actor, query }) =>
    app.attachments.list(must(actor), query.get("entityType") || "patient", query.get("entityId") || ""),
  );
  add("POST", "/api/attachments", ({ app, actor, body }) => {
    const b = body as { entityType: string; entityId: string; filename: string; mime?: string; dataBase64: string };
    const data = Buffer.from(b.dataBase64 || "", "base64");
    return app.attachments.add(must(actor), b.entityType, b.entityId, b.filename, data, b.mime);
  });
  add("GET", "/api/attachments/file", ({ app, actor, query }) => {
    const file = app.attachments.read(must(actor), query.get("id") || "");
    return { $binary: true, data: file.data, filename: file.filename, mime: file.mime || "application/octet-stream" };
  });

  add("POST", "/api/pdf/prescription", async ({ app, actor, body }) => {
    const b = body as { id: string; paper?: PageKind };
    const data = await app.pdfPrescription(must(actor), b.id, b.paper);
    return { $binary: true, data, filename: "prescription.pdf", mime: "application/pdf" };
  });
  add("POST", "/api/pdf/invoice", async ({ app, actor, body }) => {
    const b = body as { id: string; paper?: PageKind };
    const data = await app.pdfInvoice(must(actor), b.id, b.paper);
    return { $binary: true, data, filename: "invoice.pdf", mime: "application/pdf" };
  });
  add("POST", "/api/pdf/receipt", async ({ app, actor, body }) => {
    const b = body as { id: string; paper?: PageKind };
    const data = await app.pdfReceipt(must(actor), b.id, b.paper);
    return { $binary: true, data, filename: "receipt.pdf", mime: "application/pdf" };
  });
  add("POST", "/api/pdf/statement", async ({ app, actor, body }) => {
    const b = body as { patientId: string; from?: string; to?: string; paper?: PageKind };
    const data = await app.pdfStatement(must(actor), b.patientId, b.from, b.to, b.paper);
    return { $binary: true, data, filename: "statement.pdf", mime: "application/pdf" };
  });

  return r;
}

function must(actor: Actor | null): Actor {
  if (!actor) {
    throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  }
  return actor;
}

type PageKind = "A4" | "A5" | "Letter" | "80mm";
