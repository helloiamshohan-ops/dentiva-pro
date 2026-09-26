import { DateTime } from "luxon";
import { DEFAULT_TIMEZONE } from "../shared/constants.ts";
import { AppError } from "./errors.ts";

export function nowUtcIso(clock?: () => Date): string {
  const d = clock ? clock() : new Date();
  return d.toISOString();
}

export function clinicNow(timezone = DEFAULT_TIMEZONE, clock?: () => Date): DateTime {
  const d = clock ? clock() : new Date();
  return DateTime.fromJSDate(d, { zone: "utc" }).setZone(timezone);
}

export function clinicToday(timezone = DEFAULT_TIMEZONE, clock?: () => Date): string {
  return clinicNow(timezone, clock).toFormat("yyyy-MM-dd");
}

export function toUtcIso(input: string, timezone = DEFAULT_TIMEZONE): string {
  const dt = DateTime.fromISO(input, { zone: timezone });
  if (!dt.isValid) {
    const dt2 = DateTime.fromSQL(input, { zone: timezone });
    if (!dt2.isValid) {
      throw new AppError("VALIDATION", "Enter a valid date and time.");
    }
    return dt2.toUTC().toISO()!;
  }
  return dt.toUTC().toISO()!;
}

export function combineLocalDateTime(date: string, time: string, timezone = DEFAULT_TIMEZONE): string {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!dt.isValid) {
    throw new AppError("VALIDATION", "Enter a valid date and time.");
  }
  return dt.toUTC().toISO()!;
}

export function formatDate(iso: string, timezone = DEFAULT_TIMEZONE): string {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(timezone);
  if (!dt.isValid) return iso;
  return dt.toFormat("dd MMM yyyy");
}

export function formatDateTime(iso: string, timezone = DEFAULT_TIMEZONE): string {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(timezone);
  if (!dt.isValid) return iso;
  return dt.toFormat("dd MMM yyyy, HH:mm");
}

export function formatTime(iso: string, timezone = DEFAULT_TIMEZONE): string {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(timezone);
  if (!dt.isValid) return iso;
  return dt.toFormat("HH:mm");
}

export function ageYears(dateOfBirth: string, timezone = DEFAULT_TIMEZONE, clock?: () => Date): number {
  const dob = DateTime.fromISO(dateOfBirth, { zone: timezone });
  if (!dob.isValid) {
    throw new AppError("VALIDATION", "Enter a valid date of birth.");
  }
  const now = clinicNow(timezone, clock);
  const years = Math.floor(now.diff(dob, "years").years);
  if (years < 0 || years > 130) {
    throw new AppError("VALIDATION", "Date of birth is outside the accepted range.");
  }
  return years;
}

export function ageLabel(dateOfBirth: string | null | undefined, timezone = DEFAULT_TIMEZONE, clock?: () => Date): string {
  if (!dateOfBirth) return "";
  try {
    const years = ageYears(dateOfBirth, timezone, clock);
    return `${years}y`;
  } catch {
    return "";
  }
}

export function parseIsoDate(value: string): string {
  const dt = DateTime.fromISO(value);
  if (!dt.isValid) throw new AppError("VALIDATION", "Enter a valid date.");
  return dt.toISODate()!;
}

export function addMinutesIso(iso: string, minutes: number): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) throw new AppError("VALIDATION", "Enter a valid date and time.");
  return dt.plus({ minutes }).toUTC().toISO()!;
}
