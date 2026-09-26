import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { ensureDir } from "../security/paths.ts";

export type Sqlite = SqliteDb;

export type DbOptions = {
  filePath: string;
  readonly?: boolean;
};

type Statement = {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
};

export class SqliteDb {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(filePath: string, options?: { readonly?: boolean }) {
    this.raw = new DatabaseSync(filePath, {
      readOnly: options?.readonly ?? false,
    });
    if (!options?.readonly) {
      this.exec("PRAGMA journal_mode = WAL");
      this.exec("PRAGMA foreign_keys = ON");
      this.exec("PRAGMA busy_timeout = 5000");
      this.exec("PRAGMA synchronous = NORMAL");
      this.exec("PRAGMA temp_store = MEMORY");
      this.exec("PRAGMA recursive_triggers = ON");
    } else {
      this.exec("PRAGMA foreign_keys = ON");
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string): Statement {
    const stmt = this.raw.prepare(sql);
    const placeholders = (sql.match(/\?/g) || []).length;
    const take = (params: unknown[]) => params.slice(0, placeholders) as never[];
    return {
      get: (...params: unknown[]) => stmt.get(...take(params)) as unknown,
      all: (...params: unknown[]) => stmt.all(...take(params)) as unknown[],
      run: (...params: unknown[]) => {
        const info = stmt.run(...take(params));
        return { changes: Number(info.changes), lastInsertRowid: info.lastInsertRowid };
      },
    };
  }

  pragma(expr: string): unknown {
    const sql = expr.trim().toLowerCase().startsWith("pragma") ? expr : `PRAGMA ${expr}`;
    if (sql.includes("=") && !sql.toLowerCase().includes("integrity_check")) {
      this.exec(sql);
      return [];
    }
    return this.prepare(sql).all();
  }

  transaction<T>(fn: () => T): { (): T; immediate: () => T } {
    const run = (mode: "DEFERRED" | "IMMEDIATE"): T => {
      if (this.depth === 0) this.exec(`BEGIN ${mode}`);
      else this.exec(`SAVEPOINT sp_${this.depth}`);
      this.depth += 1;
      try {
        const result = fn();
        this.depth -= 1;
        if (this.depth === 0) this.exec("COMMIT");
        else this.exec(`RELEASE SAVEPOINT sp_${this.depth}`);
        return result;
      } catch (err) {
        this.depth -= 1;
        if (this.depth === 0) this.exec("ROLLBACK");
        else this.exec(`ROLLBACK TO SAVEPOINT sp_${this.depth}`);
        throw err;
      }
    };
    const wrapped = (() => run("DEFERRED")) as { (): T; immediate: () => T };
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  }

  close(): void {
    this.raw.close();
  }
}

export function openDatabase(options: DbOptions): Sqlite {
  ensureDir(path.dirname(options.filePath));
  return new SqliteDb(options.filePath, { readonly: options.readonly });
}

export function integrityCheck(db: Sqlite): { ok: boolean; detail: string } {
  const row = db.pragma("integrity_check") as Array<Record<string, string>>;
  const detail = row.map((r) => Object.values(r)[0] || "").join("; ");
  return { ok: detail === "ok", detail };
}

export function checkpointWal(db: Sqlite): void {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

export async function backupToFile(db: Sqlite, destPath: string): Promise<void> {
  ensureDir(path.dirname(destPath));
  await Promise.resolve(sqliteBackup(db.raw, destPath));
}

export function closeDatabase(db: Sqlite): void {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    /* ignore */
  }
  db.close();
}

export function databaseFileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
