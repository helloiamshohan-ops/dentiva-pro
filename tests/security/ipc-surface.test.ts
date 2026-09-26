import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bootApp, cleanup } from "../helpers.ts";
import { invokeIpc, listApiRoutes } from "../../src/server/http.ts";
import { PRELOAD_ALLOWED_CHANNELS, IPC_INVENTORY } from "../../src/main/ipc-inventory.ts";
import { resolveInside, sanitizeFilename, assertNoZipSlip } from "../../src/core/security/paths.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("IPC / path security", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("preload allow-list matches the forensic inventory and rejects unknown IPC routes", async () => {
    expect([...PRELOAD_ALLOWED_CHANNELS].sort()).toEqual(IPC_INVENTORY.map((c) => c.channel).sort());
    const ctx = await bootApp();
    apps.push(ctx);
    await expect(invokeIpc(ctx.app, ctx.token, "eval", { code: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invokeIpc(ctx.app, undefined, "GET /api/dashboard", {})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(listApiRoutes().every((r) => r.startsWith("GET ") || r.startsWith("POST ") || r.startsWith("PUT ") || r.startsWith("PATCH ") || r.startsWith("DELETE "))).toBe(true);
  });

  it("rejects path traversal, zip-slip, and disallowed attachment names", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    expect(() => assertNoZipSlip("../etc/passwd")).toThrow();
    expect(() => assertNoZipSlip("/absolute")).toThrow();
    expect(() => resolveInside(ctx.app.paths.attachmentsDir, "..", "secret")).toThrow();
    expect(() => sanitizeFilename("")).toThrow();
    expect(sanitizeFilename("photo.png")).toBe("photo.png");
    const patient = ctx.app.patients.create(ctx.actor, { fullName: "Att", ignoreDuplicateWarning: true });
    expect(() => ctx.app.attachments.add(ctx.actor, "patient", patient.id, "ok.exe", Buffer.from("MZ"), "application/x-msdownload")).toThrow();
    const ok = ctx.app.attachments.add(ctx.actor, "patient", patient.id, "photo.png", Buffer.from("png"), "image/png");
    const stored = ctx.app.attachments.absolutePath(ok.id);
    expect(stored.startsWith(path.resolve(ctx.app.paths.attachmentsDir))).toBe(true);
    expect(fs.existsSync(stored)).toBe(true);
  });
});
