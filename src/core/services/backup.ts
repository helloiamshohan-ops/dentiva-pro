import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { APP_VERSION, SCHEMA_VERSION } from "../../shared/constants.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { assertNoZipSlip, ensureDir, resolveInside } from "../security/paths.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit } from "../db/helpers.ts";
import { backupToFile, closeDatabase, integrityCheck, openDatabase } from "../db/connection.ts";
import { assertCompatibleSchema, currentSchemaVersion } from "../db/migrate.ts";
import { parse, paginationSchema, pageOffset } from "../validation.ts";

export class BackupService {
  constructor(private readonly core: Core) {}

  async create(actor: Actor, notes = ""): Promise<{ id: string; path: string; checksum: string; sizeBytes: number }> {
    requirePermission(actor, "backup.create");
    const dir = this.core.paths.backupDir;
    ensureDir(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `dentiva-pro-${stamp}.dvbak`;
    const dest = resolveInside(dir, filename);
    const tmpDir = path.join(this.core.paths.tempDir, `bak-${newId()}`);
    ensureDir(tmpDir);
    const dbCopy = path.join(tmpDir, "clinic.db");
    await backupToFile(this.core.db, dbCopy);
    const zip = new JSZip();
    const dbBuf = fs.readFileSync(dbCopy);
    const checksum = sha256(dbBuf);
    const manifest = {
      app: "Dentiva Pro",
      appVersion: APP_VERSION,
      schemaVersion: currentSchemaVersion(this.core.db),
      createdAt: this.core.clock().toISOString(),
      checksum,
      files: ["clinic.db", "manifest.json"],
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("clinic.db", dbBuf);
    const attRoot = this.core.paths.attachmentsDir;
    if (fs.existsSync(attRoot)) {
      addDirToZip(zip, attRoot, "attachments");
    }
    const packed = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    fs.writeFileSync(dest, packed);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const id = newId();
    this.core.db
      .prepare(
        `INSERT INTO backup_history (id, path, created_at, app_version, schema_version, size_bytes, checksum, notes)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(id, dest, manifest.createdAt, APP_VERSION, manifest.schemaVersion, packed.length, checksum, notes);
    audit(this.core.db, actor, "backup_create", "backup", id, { path: dest, checksum });
    return { id, path: dest, checksum, sizeBytes: packed.length };
  }

  list(actor: Actor, page = 1, pageSize = 30) {
    requirePermission(actor, "backup.create");
    const p = parse(paginationSchema, { page, pageSize });
    const { limit, offset } = pageOffset(p);
    const total = (this.core.db.prepare("SELECT COUNT(*) AS c FROM backup_history").get() as { c: number }).c;
    const items = this.core.db
      .prepare("SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset);
    return { items, page: p.page, pageSize: p.pageSize, total };
  }

  async restore(actor: Actor, archivePath: string): Promise<{ ok: true }> {
    requirePermission(actor, "backup.restore");
    if (!fs.existsSync(archivePath)) {
      throw new AppError("RESTORE", "The backup file could not be found. Your current database has not been changed.");
    }
    let zip: JSZip;
    try {
      const buf = fs.readFileSync(archivePath);
      zip = await JSZip.loadAsync(buf);
    } catch {
      throw new AppError("RESTORE", "The backup archive could not be read. Your current database has not been changed.");
    }
    for (const name of Object.keys(zip.files)) {
      assertNoZipSlip(name);
    }
    const manifestFile = zip.file("manifest.json");
    const dbFile = zip.file("clinic.db");
    if (!manifestFile || !dbFile) {
      throw new AppError("RESTORE", "The backup is missing required files. Your current database has not been changed.");
    }
    let manifest: { schemaVersion?: number; checksum?: string; appVersion?: string };
    try {
      manifest = JSON.parse(await manifestFile.async("string")) as typeof manifest;
    } catch {
      throw new AppError("RESTORE", "The backup manifest is invalid. Your current database has not been changed.");
    }
    const dbBuf = await dbFile.async("nodebuffer");
    if (manifest.checksum) {
      const actual = sha256(dbBuf);
      if (actual !== manifest.checksum) {
        throw new AppError("RESTORE", "Backup integrity check failed. Your current database has not been changed.");
      }
    }

    const tmpRestore = path.join(this.core.paths.tempDir, `restore-${newId()}`);
    ensureDir(tmpRestore);
    const candidateDb = path.join(tmpRestore, "clinic.db");
    fs.writeFileSync(candidateDb, dbBuf);

    let probe;
    try {
      probe = openDatabase({ filePath: candidateDb, readonly: true });
      const integ = integrityCheck(probe);
      if (!integ.ok) {
        throw new AppError("RESTORE", "The backup database failed integrity checks. Your current database has not been changed.");
      }
      assertCompatibleSchema(probe, SCHEMA_VERSION);
    } catch (err) {
      try {
        probe?.close();
      } catch {
        /* ignore */
      }
      fs.rmSync(tmpRestore, { recursive: true, force: true });
      if (err instanceof AppError) throw err;
      throw new AppError("RESTORE", "The backup database could not be opened. Your current database has not been changed.", {
        cause: err,
      });
    }
    probe.close();

    const live = this.core.paths.dbPath;
    const safetyDir = path.join(this.core.paths.dataDir, "safety");
    ensureDir(safetyDir);
    const safety = path.join(safetyDir, `pre-restore-${Date.now()}.db`);
    fs.copyFileSync(live, safety);
    const wal = `${live}-wal`;
    const shm = `${live}-shm`;
    if (fs.existsSync(wal)) fs.copyFileSync(wal, `${safety}-wal`);
    if (fs.existsSync(shm)) fs.copyFileSync(shm, `${safety}-shm`);

    const marker = this.core.paths.recoveryMarker;
    fs.writeFileSync(
      marker,
      JSON.stringify({ at: new Date().toISOString(), safety, live, archivePath }, null, 2),
    );

    try {
      closeDatabase(this.core.db);
      fs.copyFileSync(candidateDb, live);
      if (fs.existsSync(`${live}-wal`)) fs.rmSync(`${live}-wal`);
      if (fs.existsSync(`${live}-shm`)) fs.rmSync(`${live}-shm`);

      const attDest = this.core.paths.attachmentsDir;
      const attEntries = Object.keys(zip.files).filter((n) => n.startsWith("attachments/") && !zip.files[n]!.dir);
      if (attEntries.length) {
        for (const name of attEntries) {
          const safe = assertNoZipSlip(name);
          const destPath = resolveInside(path.dirname(attDest), safe);
          ensureDir(path.dirname(destPath));
          const content = await zip.file(name)!.async("nodebuffer");
          fs.writeFileSync(destPath, content);
        }
      }

      const verify = openDatabase({ filePath: live });
      const integ = integrityCheck(verify);
      verify.close();
      if (!integ.ok) {
        fs.copyFileSync(safety, live);
        throw new AppError("RESTORE", "Restored database failed verification. The previous database has been put back.");
      }
      fs.rmSync(marker, { force: true });
      fs.rmSync(tmpRestore, { recursive: true, force: true });
    } catch (err) {
      try {
        if (fs.existsSync(safety)) fs.copyFileSync(safety, live);
      } catch {
        /* keep marker */
      }
      if (err instanceof AppError) throw err;
      throw new AppError(
        "RESTORE",
        "Restore did not complete. The previous database has been preserved where possible. Restart Dentiva Pro to recover.",
        { cause: err },
      );
    }

    return { ok: true };
  }
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function addDirToZip(zip: JSZip, dir: string, prefix: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) addDirToZip(zip, full, rel);
    else zip.file(rel, fs.readFileSync(full));
  }
}

export function recoverIfNeeded(paths: Core["paths"]): void {
  if (!fs.existsSync(paths.recoveryMarker)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(paths.recoveryMarker, "utf8")) as { safety: string; live: string };
    if (raw.safety && fs.existsSync(raw.safety) && raw.live) {
      fs.copyFileSync(raw.safety, raw.live);
      const wal = `${raw.safety}-wal`;
      const shm = `${raw.safety}-shm`;
      if (fs.existsSync(wal)) fs.copyFileSync(wal, `${raw.live}-wal`);
      else if (fs.existsSync(`${raw.live}-wal`)) fs.rmSync(`${raw.live}-wal`, { force: true });
      if (fs.existsSync(shm)) fs.copyFileSync(shm, `${raw.live}-shm`);
      else if (fs.existsSync(`${raw.live}-shm`)) fs.rmSync(`${raw.live}-shm`, { force: true });
    }
    fs.rmSync(paths.recoveryMarker, { force: true });
  } catch {
    /* leave marker for the next launch */
  }
}
