import { describe, expect, it } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

function seedPatients(app: DentivaApp, count: number, start = 0): void {
  const insert = app.db.prepare(
    `INSERT INTO patients (id, code, full_name, phone, phone_normalized, tags_json, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', 0, ?, ?)`,
  );
  const now = new Date().toISOString();
  app.db.transaction(() => {
    for (let i = start; i < start + count; i++) {
      insert.run(`p-scale-${i}`, `P-${String(i + 100).padStart(6, "0")}`, `Scale Patient ${i}`, `0181${String(i).padStart(6, "0")}`, `0181${String(i).padStart(6, "0")}`, now, now);
    }
  })();
}

describe("scale", () => {
  it("searches 1,000 patients without full-table in-memory filtering", async () => {
    const { app, actor, dir } = await bootApp();
    seedPatients(app, 1000);
    const t1 = Date.now();
    const found = app.patients.list(actor, { search: "Scale Patient 42", page: 1, pageSize: 20 });
    const searchMs = Date.now() - t1;
    expect(found.total).toBeGreaterThan(0);
    expect(searchMs).toBeLessThan(500);
    const dashT = Date.now();
    const dash = app.ops.dashboard(actor);
    expect(dash.today).toBeTruthy();
    expect(Date.now() - dashT).toBeLessThan(1000);
    cleanup(app, dir);
  });

  it("keeps search and dashboard within budget at 10K, 25K, 50K and 100K patients", async () => {
    const { app, actor, dir } = await bootApp();
    const checkpoints = [10_000, 25_000, 50_000, 100_000];
    let seeded = 0;
    const before = process.memoryUsage().heapUsed;
    for (const n of checkpoints) {
      seedPatients(app, n - seeded, seeded);
      seeded = n;
      const t = Date.now();
      const found = app.patients.list(actor, { search: `Scale Patient ${n - 1}`, page: 1, pageSize: 20 });
      const ms = Date.now() - t;
      expect(found.total).toBeGreaterThan(0);
      expect(ms).toBeLessThan(n >= 50_000 ? 2000 : 800);
      const d0 = Date.now();
      expect(app.ops.dashboard(actor).today).toBeTruthy();
      expect(Date.now() - d0).toBeLessThan(n >= 50_000 ? 3000 : 1500);
    }
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(500 * 1024 * 1024);
    cleanup(app, dir);
  });

  it("pages a long Patient 360 visit history", async () => {
    const { app, actor, dir } = await bootApp();
    const patient = app.patients.create(actor, { fullName: "Long History", ignoreDuplicateWarning: true });
    const ins = app.db.prepare(
      `INSERT INTO visits (id, patient_id, visited_at, chief_complaint, findings, treatment_performed, created_at, updated_at)
       VALUES (?, ?, ?, 'cc', 'findings', 'tx', ?, ?)`,
    );
    const now = new Date().toISOString();
    app.db.transaction(() => {
      for (let i = 0; i < 220; i++) {
        ins.run(`v-hist-${i}`, patient.id, new Date(Date.UTC(2020, 0, 1 + i)).toISOString(), now, now);
      }
    })();
    const page1 = app.clinical.listVisits(actor, patient.id, 1, 50);
    expect(page1.total).toBe(220);
    expect(page1.items).toHaveLength(50);
    const page5 = app.clinical.listVisits(actor, patient.id, 5, 50);
    expect(page5.items.length).toBeGreaterThan(0);
    const tl = app.clinical.timeline(actor, patient.id, 1, 50);
    expect(tl.total).toBeGreaterThanOrEqual(220);
    cleanup(app, dir);
  });
});
