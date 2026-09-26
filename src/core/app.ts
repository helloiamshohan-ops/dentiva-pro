import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_NAME, APP_VERSION } from "../shared/constants.ts";
import { closeDatabase, integrityCheck, openDatabase, type Sqlite } from "./db/connection.ts";
import { migrate } from "./db/migrate.ts";
import { seedDefaults } from "./db/seed.ts";
import type { Actor, AppPaths, Core } from "./context.ts";
import { AuthService } from "./services/auth.ts";
import { PatientService } from "./services/patients.ts";
import { ClinicalService } from "./services/clinical.ts";
import { BillingService } from "./services/billing.ts";
import { ScheduleService } from "./services/schedule.ts";
import { InventoryService } from "./services/inventory.ts";
import { ClinicService } from "./services/clinic.ts";
import { OpsService } from "./services/ops.ts";
import { BackupService, recoverIfNeeded } from "./services/backup.ts";
import { AttachmentService } from "./services/attachments.ts";
import { ImportExportService } from "./services/importexport.ts";
import { renderPrescriptionPdf } from "./documents/prescription.ts";
import { renderInvoicePdf } from "./documents/invoice.ts";
import { renderReceiptPdf } from "./documents/receipt.ts";
import { renderStatementPdf } from "./documents/statement.ts";
import type { PageKind } from "./documents/engine.ts";
import { ensureDir } from "./security/paths.ts";
import { AppError } from "./errors.ts";

export function defaultDataDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "DentivaPro");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "DentivaPro");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "DentivaPro");
}

export function buildPaths(dataDir: string): AppPaths {
  const dbPath = path.join(dataDir, "clinic.db");
  return {
    dataDir,
    dbPath,
    attachmentsDir: path.join(dataDir, "attachments"),
    backupDir: path.join(dataDir, "backups"),
    tempDir: path.join(dataDir, "tmp"),
    recoveryMarker: path.join(dataDir, "restore-in-progress.json"),
    crashMarker: path.join(dataDir, "unclean-shutdown.json"),
  };
}

export class DentivaApp {
  readonly paths: AppPaths;
  private readonly shared: Core;
  readonly auth: AuthService;
  readonly clinic: ClinicService;
  readonly patients: PatientService;
  readonly clinical: ClinicalService;
  readonly billing: BillingService;
  readonly schedule: ScheduleService;
  readonly inventory: InventoryService;
  readonly ops: OpsService;
  readonly backup: BackupService;
  readonly attachments: AttachmentService;
  readonly importexport: ImportExportService;

  constructor(dataDir: string, clock: () => Date = () => new Date()) {
    this.paths = buildPaths(dataDir);
    ensureDir(this.paths.dataDir);
    ensureDir(this.paths.attachmentsDir);
    ensureDir(this.paths.backupDir);
    ensureDir(this.paths.tempDir);
    recoverIfNeeded(this.paths);
    const db = openDatabase({ filePath: this.paths.dbPath });
    migrate(db);
    seedDefaults(db);
    if (fs.existsSync(this.paths.crashMarker)) {
      const integ = integrityCheck(db);
      if (!integ.ok) {
        closeDatabase(db);
        throw new AppError(
          "INTEGRITY",
          "The database failed integrity checks after an unclean shutdown. Restore a backup. No further writes were made.",
          { details: { detail: integ.detail } },
        );
      }
    }
    fs.writeFileSync(this.paths.crashMarker, JSON.stringify({ at: clock().toISOString(), pid: process.pid }, null, 2));
    this.shared = { db, paths: this.paths, clock };
    this.auth = new AuthService(this.shared);
    this.clinic = new ClinicService(this.shared);
    this.patients = new PatientService(this.shared);
    this.clinical = new ClinicalService(this.shared);
    this.billing = new BillingService(this.shared);
    this.schedule = new ScheduleService(this.shared);
    this.inventory = new InventoryService(this.shared);
    this.ops = new OpsService(this.shared);
    this.backup = new BackupService(this.shared);
    this.attachments = new AttachmentService(this.shared);
    this.importexport = new ImportExportService(this.shared, this.patients);
  }

  get db(): Sqlite {
    return this.shared.db;
  }

  get core(): Core {
    return this.shared;
  }

  reopen(): void {
    try {
      closeDatabase(this.shared.db);
    } catch {
      /* already closed */
    }
    this.shared.db = openDatabase({ filePath: this.paths.dbPath });
    migrate(this.shared.db);
  }

  close(): void {
    try {
      fs.rmSync(this.paths.crashMarker, { force: true });
    } catch {
      /* ignore */
    }
    closeDatabase(this.shared.db);
  }

  info() {
    return { name: APP_NAME, version: APP_VERSION, dataDir: this.paths.dataDir };
  }

  async pdfPrescription(actor: Actor, id: string, paper?: PageKind): Promise<Buffer> {
    const rx = this.clinical.getPrescription(actor, id);
    const patient = this.patients.get(actor, rx.patientId);
    const clinic = this.clinic.get();
    const dentist = rx.dentistId ? this.auth.getStaff(rx.dentistId) : undefined;
    return renderPrescriptionPdf({ clinic, patient, prescription: rx, dentistName: dentist?.name, paper });
  }

  async pdfInvoice(actor: Actor, id: string, paper?: PageKind): Promise<Buffer> {
    const invoice = this.billing.getInvoice(actor, id);
    const patient = this.patients.get(actor, invoice.patientId);
    return renderInvoicePdf({ clinic: this.clinic.get(), patient, invoice, paper });
  }

  async pdfReceipt(actor: Actor, id: string, paper?: PageKind): Promise<Buffer> {
    const receipt = this.billing.getReceipt(actor, id);
    const patient = this.patients.get(actor, receipt.patientId);
    return renderReceiptPdf({ clinic: this.clinic.get(), patient, receipt, paper });
  }

  async pdfStatement(actor: Actor, patientId: string, from?: string, to?: string, paper?: PageKind): Promise<Buffer> {
    const patient = this.patients.get(actor, patientId);
    const st = this.billing.statement(actor, patientId, from, to);
    return renderStatementPdf({
      clinic: this.clinic.get(),
      patient,
      from,
      to,
      openingPaisa: st.openingPaisa,
      closingPaisa: st.closingPaisa,
      totalBilled: st.totalBilled,
      totalPaid: st.totalPaid,
      lines: st.lines,
      paper,
    });
  }

  writePdfTemp(buf: Buffer, basename: string): string {
    const safe = basename.replace(/[^\w.-]+/g, "_");
    const dest = path.join(this.paths.tempDir, `${safe}-${Date.now()}.pdf`);
    fs.writeFileSync(dest, buf);
    return dest;
  }

  async restoreAndReopen(actor: Actor, archivePath: string): Promise<void> {
    await this.backup.restore(actor, archivePath);
    this.reopen();
    this.db
      .prepare(
        `INSERT INTO audit_log (id, at, actor_id, actor_name, action, entity_type, entity_id, metadata_json)
         VALUES (?, ?, ?, ?, 'backup_restore', 'backup', ?, ?)`,
      )
      .run(
        `${Date.now()}`,
        new Date().toISOString(),
        actor.staffId,
        actor.name,
        archivePath,
        JSON.stringify({ restored: true }),
      );
  }
}

export function assertApp(app: DentivaApp | null): DentivaApp {
  if (!app) throw new AppError("INTERNAL", "The application is not ready.");
  return app;
}
