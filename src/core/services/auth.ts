import { z } from "zod";
import { DateTime } from "luxon";
import type { Role } from "../../shared/constants.ts";
import { ROLE_LABELS } from "../../shared/constants.ts";
import type { SessionInfo, Staff } from "../../shared/types.ts";
import { AppError } from "../errors.ts";
import { newId, newToken } from "../ids.ts";
import { hashSecret, verifySecret } from "../security/passwords.ts";
import { permissionsFor, type Permission } from "../rbac.ts";
import { parse, roleSchema, nonEmpty } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit, jsonParse } from "../db/helpers.ts";

const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 5;
const SESSION_HOURS = 12;

const bootstrapSchema = z.object({
  clinicName: nonEmpty("clinic name", 180),
  adminName: nonEmpty("administrator name", 120),
  username: nonEmpty("username", 64).regex(/^[a-zA-Z0-9._-]+$/, "Username may contain letters, numbers, dots, underscores and hyphens."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
});

const loginSchema = z.object({
  username: nonEmpty("username", 64),
  password: z.string().min(1, "Enter your password."),
});

type StaffRow = {
  id: string;
  name: string;
  role: Role;
  contact: string | null;
  username: string;
  password_hash: string;
  active: number;
  permissions_json: string | null;
  created_at: string;
  updated_at: string;
};

export class AuthService {
  constructor(private readonly core: Core) {}

  needsSetup(): boolean {
    const row = this.core.db.prepare("SELECT COUNT(*) AS c FROM staff").get() as { c: number };
    return row.c === 0;
  }

  async bootstrap(input: unknown): Promise<{ staffId: string }> {
    if (!this.needsSetup()) {
      throw new AppError("CONFLICT", "Clinic setup is already complete. Sign in to continue.");
    }
    const data = parse(bootstrapSchema, input);
    const hash = await hashSecret(data.password);
    const id = newId();
    const now = this.core.clock().toISOString();
    const run = this.core.db.transaction(() => {
      this.core.db
        .prepare(
          "UPDATE clinic_settings SET clinic_name = ?, updated_at = ? WHERE id = 1",
        )
        .run(data.clinicName, now);
      this.core.db
        .prepare(
          `INSERT INTO staff (id, name, role, contact, username, password_hash, active, permissions_json, created_at, updated_at)
           VALUES (?, ?, 'administrator', NULL, ?, ?, 1, NULL, ?, ?)`,
        )
        .run(id, data.adminName, data.username.toLowerCase(), hash, now, now);
      audit(this.core.db, null, "bootstrap", "staff", id, { username: data.username });
    });
    run();
    return { staffId: id };
  }

  async login(input: unknown): Promise<{ token: string; session: SessionInfo }> {
    const data = parse(loginSchema, input);
    const username = data.username.toLowerCase();
    this.assertNotLockedOut(username);
    const staff = this.core.db
      .prepare("SELECT * FROM staff WHERE username = ?")
      .get(username) as StaffRow | undefined;
    const ok = staff && staff.active === 1 && (await verifySecret(data.password, staff.password_hash));
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare("INSERT INTO login_attempts (id, username, success, at, ip_note) VALUES (?, ?, ?, ?, NULL)")
      .run(newId(), username, ok ? 1 : 0, now);
    if (!ok || !staff) {
      audit(this.core.db, null, "login_failed", "staff", staff?.id, { username });
      throw new AppError("UNAUTHORIZED", "Username or password is incorrect.");
    }
    const token = newToken(32);
    const sessionId = newId();
    const expires = DateTime.fromJSDate(this.core.clock()).plus({ hours: SESSION_HOURS }).toUTC().toISO()!;
    this.core.db
      .prepare(
        `INSERT INTO sessions (id, staff_id, created_at, last_seen_at, expires_at, locked, failed_unlocks, token_hash)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(sessionId, staff.id, now, now, expires, token);
    const actor = this.actorFromStaff(staff, sessionId);
    audit(this.core.db, actor, "login", "staff", staff.id);
    const session = this.sessionInfo(actor, false);
    return { token, session };
  }

  logout(token: string): void {
    const session = this.lookup(token);
    if (session) {
      const staff = this.staffRow(session.staff_id);
      if (staff) {
        audit(this.core.db, this.actorFromStaff(staff, session.id), "logout", "staff", staff.id);
      }
      this.core.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    }
  }

  lock(token: string): SessionInfo {
    const session = this.requireSessionRow(token);
    this.core.db.prepare("UPDATE sessions SET locked = 1 WHERE id = ?").run(session.id);
    const staff = this.requireStaff(session.staff_id);
    const actor = this.actorFromStaff(staff, session.id);
    audit(this.core.db, actor, "lock", "session", session.id);
    return this.sessionInfo(actor, true);
  }

  async unlock(token: string, password: string): Promise<SessionInfo> {
    const session = this.requireSessionRow(token);
    const staff = this.requireStaff(session.staff_id);
    if (session.failed_unlocks >= MAX_FAILED) {
      throw new AppError("LOCKED", "Too many unlock attempts. Sign in again.");
    }
    const ok = await verifySecret(password, staff.password_hash);
    if (!ok) {
      this.core.db
        .prepare("UPDATE sessions SET failed_unlocks = failed_unlocks + 1 WHERE id = ?")
        .run(session.id);
      throw new AppError("UNAUTHORIZED", "Password is incorrect. The application remains locked.");
    }
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare("UPDATE sessions SET locked = 0, failed_unlocks = 0, last_seen_at = ? WHERE id = ?")
      .run(now, session.id);
    const actor = this.actorFromStaff(staff, session.id);
    audit(this.core.db, actor, "unlock", "session", session.id);
    return this.sessionInfo(actor, false);
  }

  touch(token: string): { actor: Actor; session: SessionInfo } {
    const session = this.requireSessionRow(token);
    const nowDt = DateTime.fromJSDate(this.core.clock());
    const expires = DateTime.fromISO(session.expires_at);
    if (expires < nowDt) {
      this.core.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      throw new AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.");
    }
    const timeout = this.inactivityMinutes();
    if (timeout > 0) {
      const last = DateTime.fromISO(session.last_seen_at);
      if (nowDt.diff(last, "minutes").minutes > timeout) {
        this.core.db.prepare("UPDATE sessions SET locked = 1 WHERE id = ?").run(session.id);
        const staff = this.requireStaff(session.staff_id);
        return { actor: this.actorFromStaff(staff, session.id), session: this.sessionInfo(this.actorFromStaff(staff, session.id), true) };
      }
    }
    if (session.locked) {
      const staff = this.requireStaff(session.staff_id);
      const actor = this.actorFromStaff(staff, session.id);
      return { actor, session: this.sessionInfo(actor, true) };
    }
    const now = nowDt.toUTC().toISO()!;
    this.core.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, session.id);
    const staff = this.requireStaff(session.staff_id);
    if (staff.active !== 1) {
      this.core.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      throw new AppError("UNAUTHORIZED", "This account is inactive. Please contact an administrator.");
    }
    const actor = this.actorFromStaff(staff, session.id);
    return { actor, session: this.sessionInfo(actor, false) };
  }

  resolve(token: string | undefined): Actor {
    if (!token) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
    const { actor, session } = this.touch(token);
    if (session.locked) throw new AppError("LOCKED", "Dentiva Pro is locked. Enter your password to continue.");
    return actor;
  }

  async updateOwnPassword(actor: Actor, current: string, next: string): Promise<void> {
    if (next.length < 8) throw new AppError("VALIDATION", "New password must be at least 8 characters.");
    const staff = this.requireStaff(actor.staffId);
    const ok = await verifySecret(current, staff.password_hash);
    if (!ok) throw new AppError("UNAUTHORIZED", "Current password is incorrect. The password was not changed.");
    const hash = await hashSecret(next);
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE staff SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now, actor.staffId);
    audit(this.core.db, actor, "password_change", "staff", actor.staffId);
  }

  async createStaff(actor: Actor, input: unknown): Promise<Staff> {
    requirePermission(actor, "staff.manage");
    const schema = z.object({
      name: nonEmpty("name", 120),
      role: roleSchema,
      contact: z.string().max(80).optional(),
      username: nonEmpty("username", 64).regex(/^[a-zA-Z0-9._-]+$/, "Username may contain letters, numbers, dots, underscores and hyphens."),
      password: z.string().min(8, "Password must be at least 8 characters.").max(128),
    });
    const data = parse(schema, input);
    const hash = await hashSecret(data.password);
    const id = newId();
    const now = this.core.clock().toISOString();
    try {
      this.core.db
        .prepare(
          `INSERT INTO staff (id, name, role, contact, username, password_hash, active, permissions_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
        )
        .run(id, data.name, data.role, data.contact ?? null, data.username.toLowerCase(), hash, now, now);
    } catch (err) {
      throw new AppError("CONFLICT", "That username is already in use.", { cause: err });
    }
    audit(this.core.db, actor, "staff_create", "staff", id, { username: data.username, role: data.role });
    return this.getStaff(id);
  }

  updateStaff(actor: Actor, id: string, patch: { name?: string; role?: Role; contact?: string; active?: boolean }): Staff {
    requirePermission(actor, "staff.manage");
    const existing = this.requireStaff(id);
    if (existing.role === "administrator" && patch.active === false) {
      const admins = this.core.db
        .prepare("SELECT COUNT(*) AS c FROM staff WHERE role = 'administrator' AND active = 1 AND id != ?")
        .get(id) as { c: number };
      if (admins.c === 0) {
        throw new AppError("VALIDATION", "At least one active administrator is required.");
      }
    }
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare(
        `UPDATE staff SET name = ?, role = ?, contact = ?, active = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? existing.name,
        patch.role ?? existing.role,
        patch.contact ?? existing.contact,
        patch.active === undefined ? existing.active : patch.active ? 1 : 0,
        now,
        id,
      );
    if (patch.active === false) {
      this.core.db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(id);
    }
    audit(this.core.db, actor, "staff_update", "staff", id, patch as Record<string, unknown>);
    return this.getStaff(id);
  }

  async resetStaffPassword(actor: Actor, id: string, password: string): Promise<void> {
    requirePermission(actor, "staff.manage");
    this.requireStaff(id);
    const hash = await hashSecret(password);
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE staff SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now, id);
    this.core.db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(id);
    audit(this.core.db, actor, "staff_password_reset", "staff", id);
  }

  listStaff(actor: Actor): Staff[] {
    requirePermission(actor, "staff.manage");
    const rows = this.core.db.prepare("SELECT * FROM staff ORDER BY name COLLATE NOCASE").all() as StaffRow[];
    return rows.map((r) => this.toStaff(r));
  }

  listDentists(): Array<{ id: string; name: string }> {
    return this.core.db
      .prepare("SELECT id, name FROM staff WHERE active = 1 AND role IN ('dentist','administrator') ORDER BY name COLLATE NOCASE")
      .all() as Array<{ id: string; name: string }>;
  }

  getStaff(id: string): Staff {
    return this.toStaff(this.requireStaff(id));
  }

  private toStaff(row: StaffRow): Staff {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      contact: row.contact,
      username: row.username,
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private actorFromStaff(staff: StaffRow, sessionId: string): Actor {
    const extra = jsonParse<Permission[]>(staff.permissions_json, []);
    return {
      sessionId,
      staffId: staff.id,
      name: staff.name,
      username: staff.username,
      role: staff.role,
      permissions: permissionsFor(staff.role, extra),
    };
  }

  private sessionInfo(actor: Actor, locked: boolean): SessionInfo {
    const clinic = this.core.db.prepare("SELECT clinic_name, timezone, currency FROM clinic_settings WHERE id = 1").get() as
      | { clinic_name: string; timezone: string; currency: string }
      | undefined;
    return {
      sessionId: actor.sessionId,
      staffId: actor.staffId,
      name: actor.name,
      username: actor.username,
      role: actor.role,
      permissions: [...actor.permissions],
      locked,
      clinicName: clinic?.clinic_name || "Dentiva Pro",
      timezone: clinic?.timezone || "Asia/Dhaka",
      currency: clinic?.currency || "BDT",
    };
  }

  private lookup(token: string) {
    return this.core.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(token) as
      | {
          id: string;
          staff_id: string;
          created_at: string;
          last_seen_at: string;
          expires_at: string;
          locked: number;
          failed_unlocks: number;
          token_hash: string;
        }
      | undefined;
  }

  private requireSessionRow(token: string) {
    const row = this.lookup(token);
    if (!row) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
    return row;
  }

  private staffRow(id: string) {
    return this.core.db.prepare("SELECT * FROM staff WHERE id = ?").get(id) as StaffRow | undefined;
  }

  private requireStaff(id: string): StaffRow {
    const row = this.staffRow(id);
    if (!row) throw new AppError("NOT_FOUND", "Staff member was not found.");
    return row;
  }

  private inactivityMinutes(): number {
    const row = this.core.db.prepare("SELECT inactivity_timeout_minutes FROM clinic_settings WHERE id = 1").get() as
      | { inactivity_timeout_minutes: number }
      | undefined;
    return row?.inactivity_timeout_minutes ?? 15;
  }

  private assertNotLockedOut(username: string): void {
    const since = DateTime.fromJSDate(this.core.clock()).minus({ minutes: LOCKOUT_MINUTES }).toUTC().toISO()!;
    const row = this.core.db
      .prepare(
        `SELECT COUNT(*) AS c FROM login_attempts
         WHERE username = ? AND success = 0 AND at >= ?`,
      )
      .get(username, since) as { c: number };
    if (row.c >= MAX_FAILED) {
      throw new AppError(
        "LOCKED",
        `Too many failed sign-in attempts. Wait ${LOCKOUT_MINUTES} minutes and try again.`,
      );
    }
  }
}

export { ROLE_LABELS };
