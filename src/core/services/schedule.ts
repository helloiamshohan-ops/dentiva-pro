import { z } from "zod";
import type { Appointment, PageResult, QueueItem } from "../../shared/types.ts";
import { APPOINTMENT_STATUSES, QUEUE_STATUSES } from "../../shared/constants.ts";
import { AppError } from "../errors.ts";
import { newId, formatQueueSerial } from "../ids.ts";
import { clinicToday, addMinutesIso } from "../clock.ts";
import { parse, paginationSchema, pageOffset } from "../validation.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { audit, getClinicTimezone, nextSequence, immediate } from "../db/helpers.ts";

const apptSchema = z.object({
  patientId: z.string().min(8),
  dentistId: z.string().optional(),
  chairId: z.string().optional(),
  roomId: z.string().optional(),
  startsAt: z.string().min(10),
  durationMinutes: z.number().int().min(5).max(480),
  appointmentType: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export class ScheduleService {
  constructor(private readonly core: Core) {}

  listAppointments(
    actor: Actor,
    query: { from: string; to: string; dentistId?: string; patientId?: string; page?: number; pageSize?: number },
  ): PageResult<Appointment> {
    requirePermission(actor, "appointments.read");
    const p = parse(paginationSchema, { page: query.page ?? 1, pageSize: query.pageSize ?? 200 });
    const { limit, offset } = pageOffset(p);
    const clauses = ["a.starts_at >= ?", "a.starts_at < ?"];
    const params: unknown[] = [query.from, query.to];
    if (query.dentistId) {
      clauses.push("a.dentist_id = ?");
      params.push(query.dentistId);
    }
    if (query.patientId) {
      clauses.push("a.patient_id = ?");
      params.push(query.patientId);
    }
    const where = clauses.join(" AND ");
    const total = (this.core.db.prepare(`SELECT COUNT(*) AS c FROM appointments a WHERE ${where}`).get(...params) as { c: number }).c;
    const rows = this.core.db
      .prepare(
        `SELECT a.*, p.code AS patient_code, p.full_name AS patient_name,
                s.name AS dentist_name, c.name AS chair_name, r.name AS room_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN staff s ON s.id = a.dentist_id
         LEFT JOIN chairs c ON c.id = a.chair_id
         LEFT JOIN rooms r ON r.id = a.room_id
         WHERE ${where}
         ORDER BY a.starts_at
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ApptRow[];
    return { items: rows.map(toAppt), page: p.page, pageSize: p.pageSize, total };
  }

  getAppointment(actor: Actor, id: string): Appointment {
    requirePermission(actor, "appointments.read");
    const row = this.rowById(id);
    if (!row) throw new AppError("NOT_FOUND", "Appointment was not found.");
    return toAppt(row);
  }

  createAppointment(actor: Actor, input: unknown): Appointment {
    requirePermission(actor, "appointments.write");
    const data = parse(apptSchema, input);
    const endsAt = addMinutesIso(data.startsAt, data.durationMinutes);
    this.assertNoConflict({
      dentistId: data.dentistId,
      chairId: data.chairId,
      roomId: data.roomId,
      startsAt: data.startsAt,
      endsAt,
    });
    const id = newId();
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare(
        `INSERT INTO appointments (
          id, patient_id, dentist_id, chair_id, room_id, starts_at, ends_at, duration_minutes,
          appointment_type, status, notes, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        data.patientId,
        data.dentistId ?? null,
        data.chairId ?? null,
        data.roomId ?? null,
        data.startsAt,
        endsAt,
        data.durationMinutes,
        data.appointmentType ?? null,
        data.status ?? "scheduled",
        data.notes ?? "",
        now,
        now,
      );
    audit(this.core.db, actor, "appointment_create", "appointment", id);
    return this.getAppointment(actor, id);
  }

  updateAppointment(actor: Actor, id: string, input: unknown): Appointment {
    requirePermission(actor, "appointments.write");
    const existing = this.rowById(id);
    if (!existing) throw new AppError("NOT_FOUND", "Appointment was not found.");
    const data = parse(apptSchema.partial(), input);
    const startsAt = data.startsAt ?? existing.starts_at;
    const duration = data.durationMinutes ?? existing.duration_minutes;
    const endsAt = addMinutesIso(startsAt, duration);
    this.assertNoConflict({
      dentistId: data.dentistId ?? existing.dentist_id ?? undefined,
      chairId: data.chairId ?? existing.chair_id ?? undefined,
      roomId: data.roomId ?? existing.room_id ?? undefined,
      startsAt,
      endsAt,
      excludeId: id,
    });
    const now = this.core.clock().toISOString();
    this.core.db
      .prepare(
        `UPDATE appointments SET patient_id=?, dentist_id=?, chair_id=?, room_id=?, starts_at=?, ends_at=?,
          duration_minutes=?, appointment_type=?, status=?, notes=?, updated_at=? WHERE id=?`,
      )
      .run(
        data.patientId ?? existing.patient_id,
        data.dentistId ?? existing.dentist_id,
        data.chairId ?? existing.chair_id,
        data.roomId ?? existing.room_id,
        startsAt,
        endsAt,
        duration,
        data.appointmentType ?? existing.appointment_type,
        data.status ?? existing.status,
        data.notes ?? existing.notes,
        now,
        id,
      );
    audit(this.core.db, actor, "appointment_update", "appointment", id);
    return this.getAppointment(actor, id);
  }

  setAppointmentStatus(actor: Actor, id: string, status: string): Appointment {
    requirePermission(actor, "appointments.write");
    if (!(APPOINTMENT_STATUSES as readonly string[]).includes(status)) {
      throw new AppError("VALIDATION", "Unknown appointment status.");
    }
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    audit(this.core.db, actor, "appointment_status", "appointment", id, { status });
    return this.getAppointment(actor, id);
  }

  enqueue(actor: Actor, patientId: string, appointmentId?: string, notes?: string): QueueItem {
    requirePermission(actor, "queue.manage");
    const tz = getClinicTimezone(this.core.db);
    const date = clinicToday(tz, this.core.clock);
    let id = "";
    immediate(this.core.db, () => {
      const existing = this.core.db
        .prepare(
          `SELECT id FROM queue WHERE queue_date = ? AND patient_id = ? AND status IN ('waiting','called','in_treatment')`,
        )
        .get(date, patientId) as { id: string } | undefined;
      if (existing) {
        id = existing.id;
        return;
      }
      const seq = nextSequence(this.core.db, `queue-${date}`);
      id = newId();
      const now = this.core.clock().toISOString();
      try {
        this.core.db
          .prepare(
            `INSERT INTO queue (id, queue_date, serial, patient_id, appointment_id, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
          )
          .run(id, date, seq, patientId, appointmentId ?? null, notes ?? "", now, now);
      } catch (err) {
        throw new AppError("CONFLICT", "Could not assign a queue serial. Try again.", { cause: err });
      }
      audit(this.core.db, actor, "queue_add", "queue", id, { serial: seq, date });
    });
    return this.getQueueItem(actor, id);
  }

  listQueue(actor: Actor, date?: string): QueueItem[] {
    requirePermission(actor, "queue.manage");
    const tz = getClinicTimezone(this.core.db);
    const d = date || clinicToday(tz, this.core.clock);
    const rows = this.core.db
      .prepare(
        `SELECT q.*, p.code AS patient_code, p.full_name AS patient_name
         FROM queue q JOIN patients p ON p.id = q.patient_id
         WHERE q.queue_date = ? ORDER BY q.serial`,
      )
      .all(d) as QRow[];
    return rows.map(toQueue);
  }

  setQueueStatus(actor: Actor, id: string, status: string): QueueItem {
    requirePermission(actor, "queue.manage");
    if (!(QUEUE_STATUSES as readonly string[]).includes(status)) {
      throw new AppError("VALIDATION", "Unknown queue status.");
    }
    const now = this.core.clock().toISOString();
    this.core.db.prepare("UPDATE queue SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    audit(this.core.db, actor, "queue_status", "queue", id, { status });
    return this.getQueueItem(actor, id);
  }

  getQueueItem(actor: Actor, id: string): QueueItem {
    requirePermission(actor, "queue.manage");
    const row = this.core.db
      .prepare(
        `SELECT q.*, p.code AS patient_code, p.full_name AS patient_name
         FROM queue q JOIN patients p ON p.id = q.patient_id WHERE q.id = ?`,
      )
      .get(id) as QRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", "Queue item was not found.");
    return toQueue(row);
  }

  listChairs() {
    return this.core.db.prepare("SELECT id, name, active FROM chairs ORDER BY name").all();
  }

  listRooms() {
    return this.core.db.prepare("SELECT id, name, active FROM rooms ORDER BY name").all();
  }

  saveChair(actor: Actor, id: string | null, name: string, active = true) {
    requirePermission(actor, "settings.manage");
    const cid = id ?? newId();
    if (id) this.core.db.prepare("UPDATE chairs SET name = ?, active = ? WHERE id = ?").run(name, active ? 1 : 0, cid);
    else this.core.db.prepare("INSERT INTO chairs (id, name, active) VALUES (?, ?, ?)").run(cid, name, active ? 1 : 0);
    return { id: cid, name, active };
  }

  saveRoom(actor: Actor, id: string | null, name: string, active = true) {
    requirePermission(actor, "settings.manage");
    const rid = id ?? newId();
    if (id) this.core.db.prepare("UPDATE rooms SET name = ?, active = ? WHERE id = ?").run(name, active ? 1 : 0, rid);
    else this.core.db.prepare("INSERT INTO rooms (id, name, active) VALUES (?, ?, ?)").run(rid, name, active ? 1 : 0);
    return { id: rid, name, active };
  }

  private assertNoConflict(args: {
    dentistId?: string | null;
    chairId?: string | null;
    roomId?: string | null;
    startsAt: string;
    endsAt: string;
    excludeId?: string;
  }): void {
    const active = `status NOT IN ('cancelled','no_show')`;
    const overlap = `starts_at < ? AND ends_at > ?`;
    const exclude = args.excludeId ? "AND id != ?" : "";
    const paramsBase = [args.endsAt, args.startsAt];
    const extra = args.excludeId ? [args.excludeId] : [];
    if (args.dentistId) {
      const hit = this.core.db
        .prepare(`SELECT id FROM appointments WHERE dentist_id = ? AND ${active} AND ${overlap} ${exclude} LIMIT 1`)
        .get(args.dentistId, ...paramsBase, ...extra);
      if (hit) throw new AppError("CONFLICT", "This dentist already has an appointment in that time.");
    }
    if (args.chairId) {
      const hit = this.core.db
        .prepare(`SELECT id FROM appointments WHERE chair_id = ? AND ${active} AND ${overlap} ${exclude} LIMIT 1`)
        .get(args.chairId, ...paramsBase, ...extra);
      if (hit) throw new AppError("CONFLICT", "This chair is already booked in that time.");
    }
    if (args.roomId) {
      const hit = this.core.db
        .prepare(`SELECT id FROM appointments WHERE room_id = ? AND ${active} AND ${overlap} ${exclude} LIMIT 1`)
        .get(args.roomId, ...paramsBase, ...extra);
      if (hit) throw new AppError("CONFLICT", "This room is already booked in that time.");
    }
  }

  private rowById(id: string) {
    return this.core.db
      .prepare(
        `SELECT a.*, p.code AS patient_code, p.full_name AS patient_name,
                s.name AS dentist_name, c.name AS chair_name, r.name AS room_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN staff s ON s.id = a.dentist_id
         LEFT JOIN chairs c ON c.id = a.chair_id
         LEFT JOIN rooms r ON r.id = a.room_id
         WHERE a.id = ?`,
      )
      .get(id) as ApptRow | undefined;
  }
}

type ApptRow = {
  id: string;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  dentist_id: string | null;
  dentist_name: string | null;
  chair_id: string | null;
  chair_name: string | null;
  room_id: string | null;
  room_name: string | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  appointment_type: string | null;
  status: Appointment["status"];
  notes: string;
};

function toAppt(row: ApptRow): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientCode: row.patient_code,
    patientName: row.patient_name,
    dentistId: row.dentist_id,
    dentistName: row.dentist_name,
    chairId: row.chair_id,
    chairName: row.chair_name,
    roomId: row.room_id,
    roomName: row.room_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: row.duration_minutes,
    appointmentType: row.appointment_type,
    status: row.status,
    notes: row.notes,
  };
}

type QRow = {
  id: string;
  queue_date: string;
  serial: number;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  appointment_id: string | null;
  status: QueueItem["status"];
  notes: string;
};

function toQueue(row: QRow): QueueItem {
  return {
    id: row.id,
    queueDate: row.queue_date,
    serial: row.serial,
    serialLabel: formatQueueSerial(row.serial),
    patientId: row.patient_id,
    patientCode: row.patient_code,
    patientName: row.patient_name,
    appointmentId: row.appointment_id,
    status: row.status,
    notes: row.notes,
  };
}
