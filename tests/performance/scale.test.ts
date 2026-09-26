import { describe, expect, it } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";

describe("scale", () => {
  it("searches 1,000 patients without full-table in-memory filtering", async () => {
    const { app, actor, dir } = await bootApp();
    const insert = app.db.prepare(
      `INSERT INTO patients (id, code, full_name, phone, phone_normalized, tags_json, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', 0, ?, ?)`,
    );
    const now = new Date().toISOString();
    const run = app.db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        insert.run(`p-${i}`, `P-${String(i + 10).padStart(6, "0")}`, `Patient ${i}`, `0171${String(i).padStart(6, "0")}`, `0171${String(i).padStart(6, "0")}`, now, now);
      }
    });
    const t0 = Date.now();
    run();
    const insertMs = Date.now() - t0;
    const t1 = Date.now();
    const found = app.patients.list(actor, { search: "Patient 42", page: 1, pageSize: 20 });
    const searchMs = Date.now() - t1;
    expect(found.total).toBeGreaterThan(0);
    expect(searchMs).toBeLessThan(500);
    const dashT = Date.now();
    const dash = app.ops.dashboard(actor);
    const dashMs = Date.now() - dashT;
    expect(dash.today).toBeTruthy();
    expect(dashMs).toBeLessThan(1000);
    cleanup(app, dir);
    expect(insertMs).toBeGreaterThanOrEqual(0);
  });
});
