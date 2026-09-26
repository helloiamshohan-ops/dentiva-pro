import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import { integrityCheck } from "../../src/core/db/connection.ts";
import { currentSchemaVersion, loadMigrations } from "../../src/core/db/migrate.ts";
import { SCHEMA_VERSION } from "../../src/shared/constants.ts";
import type { DentivaApp } from "../../src/core/app.ts";

describe("database integrity", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("opens WAL with foreign keys, passes integrity_check, and applies all migrations", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const { app } = ctx;
    const journal = app.db.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
    const mode = String(journal.journal_mode || Object.values(journal)[0] || "").toLowerCase();
    expect(mode).toBe("wal");
    const fk = app.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number };
    const fkOn = Number(fk.foreign_keys ?? Object.values(fk)[0] ?? 0);
    expect(fkOn).toBe(1);
    const integ = integrityCheck(app.db);
    expect(integ.ok).toBe(true);
    const fkViol = app.db.prepare("PRAGMA foreign_key_check").all();
    expect(fkViol).toHaveLength(0);
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    expect(currentSchemaVersion(app.db)).toBe(migrations[migrations.length - 1]!.version);
    expect(SCHEMA_VERSION).toBe(migrations[migrations.length - 1]!.version);
  });

  it("rejects foreign-key violations", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    expect(() =>
      ctx.app.db.prepare("INSERT INTO visits (id, patient_id, visited_at, created_at, updated_at) VALUES ('v1','missing','2026-01-01','2026-01-01','2026-01-01')").run(),
    ).toThrow();
  });
});
