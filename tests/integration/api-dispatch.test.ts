import { describe, expect, it, afterEach } from "vitest";
import { AppError } from "../../src/core/errors.ts";
import { invokeApi, invokeIpc, listApiRoutes } from "../../src/server/http.ts";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("API / IPC dispatch", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("exposes clinical and finance routes used by the UI", () => {
    const routes = listApiRoutes();
    expect(routes).toContain("POST /api/visits");
    expect(routes).toContain("POST /api/plans/status");
    expect(routes).toContain("POST /api/notifications/read");
    expect(routes).toContain("POST /api/adjustments");
    expect(routes).toContain("GET /api/audit");
  });

  it("invokes HTTP-style routes over IPC including named aliases", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, token } = ctx;
    const clinic = (await invokeIpc(app, token, "clinic.get", {})) as { clinicName: string };
    expect(clinic.clinicName).toBe("Banani Dental Studio");
    const viaHttp = (await invokeIpc(app, token, "GET /api/clinic", { query: {} })) as { clinicName: string };
    expect(viaHttp.clinicName).toBe("Banani Dental Studio");
    const dash = (await invokeIpc(app, token, "GET /api/dashboard", { body: {}, query: {} })) as Record<string, unknown>;
    expect(dash).toBeTruthy();
  });

  it("rejects unknown routes and unauthenticated protected calls", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app } = ctx;
    await expect(invokeIpc(app, "tok", "not-a-route", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invokeApi(app, { method: "GET", pathname: "/api/dashboard" })).rejects.toBeInstanceOf(AppError);
  });

  it("creates a visit with procedures through dispatch without billing", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app, token, actor } = ctx;
    const patient = app.patients.create(actor, { fullName: "IPC Visit", ignoreDuplicateWarning: true });
    const visit = (await invokeIpc(app, token, "POST /api/visits", {
      body: {
        patientId: patient.id,
        visitedAt: new Date("2026-08-02T09:00:00+06:00").toISOString(),
        chiefComplaint: "Sensitivity",
        procedures: [{ name: "Fluoride varnish", tooth: "11" }],
      },
      query: {},
    })) as { id: string };
    const loaded = app.clinical.getVisit(actor, visit.id);
    expect(loaded.procedures.some((x) => x.name.includes("Fluoride") && x.tooth === "11")).toBe(true);
    const invoices = (await invokeIpc(app, token, "POST /api/invoices/list", {
      body: { patientId: patient.id },
      query: {},
    })) as { total: number };
    expect(invoices.total).toBe(0);
  });
});
