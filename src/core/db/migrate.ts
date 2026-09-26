import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../../shared/constants.ts";
import { AppError } from "../errors.ts";
import type { Sqlite } from "./connection.ts";

export type Migration = { version: number; name: string; sql: string };

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "migrations"),
    path.join(here, "..", "..", "..", "src", "core", "db", "migrations"),
    path.join(process.cwd(), "src", "core", "db", "migrations"),
    path.join(process.cwd(), "dist", "main", "migrations"),
    path.join(process.cwd(), "dist", "core", "db", "migrations"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new AppError("INTERNAL", "Unable to locate database migrations.");
}

export function loadMigrations(): Migration[] {
  const dir = migrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const m = /^(\d+)_([a-z0-9_]+)\.sql$/i.exec(file);
    if (!m) {
      throw new AppError("INTERNAL", `Invalid migration filename: ${file}`);
    }
    return {
      version: Number(m[1]),
      name: m[2]!,
      sql: fs.readFileSync(path.join(dir, file), "utf8"),
    };
  });
}

export function currentSchemaVersion(db: Sqlite): number {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get() as { name: string } | undefined;
  if (!row) return 0;
  const v = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number };
  return v.v;
}

export function migrate(db: Sqlite): { from: number; to: number } {
  const from = currentSchemaVersion(db);
  const migrations = loadMigrations();
  const pending = migrations.filter((m) => m.version > from);
  for (const m of pending) {
    const apply = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
    try {
      apply();
    } catch (err) {
      throw new AppError("INTEGRITY", "A database migration failed. The previous schema was left unchanged.", {
        cause: err,
        details: { version: m.version, name: m.name },
      });
    }
  }
  const to = currentSchemaVersion(db);
  if (to < SCHEMA_VERSION) {
    // SCHEMA_VERSION tracks the product's expected latest; migrations files are source of truth.
  }
  return { from, to };
}

export function assertCompatibleSchema(db: Sqlite, expectedMax = SCHEMA_VERSION): void {
  const v = currentSchemaVersion(db);
  if (v === 0) {
    throw new AppError("RESTORE", "The backup database has no schema and cannot be restored. Your current database has not been changed.");
  }
  if (v > expectedMax + 50) {
    throw new AppError(
      "RESTORE",
      "This backup was created with a newer version of Dentiva Pro and cannot be opened here. Your current database has not been changed.",
      { details: { schemaVersion: v, expectedMax } },
    );
  }
}
