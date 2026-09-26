import { AppError } from "../errors.ts";
import type { Actor, Core } from "../context.ts";
import { requirePermission } from "../context.ts";
import { PatientService } from "./patients.ts";

export type CsvPreview = {
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>;
  issues: string[];
};

const PATIENT_FIELDS = [
  "fullName",
  "phone",
  "email",
  "dateOfBirth",
  "gender",
  "address",
  "occupation",
  "notes",
  "title",
];

export class ImportExportService {
  constructor(
    private readonly core: Core,
    private readonly patients: PatientService,
  ) {}

  previewCsv(csv: string): CsvPreview {
    const table = parseCsv(csv);
    if (!table.headers.length) throw new AppError("VALIDATION", "The file has no header row.");
    const mapping: Record<string, string> = {};
    for (const h of table.headers) {
      const key = guessField(h);
      if (key) mapping[h] = key;
    }
    const issues: string[] = [];
    if (!Object.values(mapping).includes("fullName")) issues.push("Map a column to full name before importing.");
    return { headers: table.headers, rows: table.rows.slice(0, 20), mapping, issues };
  }

  importPatients(actor: Actor, csv: string, mapping: Record<string, string>, ignoreDuplicates = false): { created: number; skipped: number; errors: Array<{ row: number; message: string }> } {
    requirePermission(actor, "import.export");
    const table = parseCsv(csv);
    let created = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];
    const run = this.core.db.transaction(() => {
      table.rows.forEach((cols, idx) => {
        const rec: Record<string, string> = {};
        table.headers.forEach((h, i) => {
          const field = mapping[h];
          if (field) rec[field] = cols[i] ?? "";
        });
        if (!rec.fullName) {
          skipped += 1;
          errors.push({ row: idx + 2, message: "Missing full name." });
          return;
        }
        try {
          this.patients.create(actor, {
            fullName: rec.fullName,
            phone: rec.phone,
            email: rec.email,
            dateOfBirth: rec.dateOfBirth,
            gender: rec.gender,
            address: rec.address,
            occupation: rec.occupation,
            notes: rec.notes,
            title: rec.title,
            ignoreDuplicateWarning: ignoreDuplicates,
          });
          created += 1;
        } catch (err) {
          skipped += 1;
          errors.push({ row: idx + 2, message: err instanceof Error ? err.message : "Could not import this row." });
        }
      });
    });
    try {
      run();
    } catch (err) {
      throw new AppError("INTEGRITY", "Import failed. No patient records from this file were saved.", { cause: err });
    }
    return { created, skipped, errors };
  }

  exportPatientsCsv(actor: Actor): string {
    requirePermission(actor, "import.export");
    const rows = this.core.db
      .prepare(
        `SELECT code, title, full_name, gender, date_of_birth, phone, email, address, occupation, notes FROM patients WHERE archived = 0 ORDER BY code`,
      )
      .all() as Array<Record<string, string | null>>;
    const headers = ["code", "title", "full_name", "gender", "date_of_birth", "phone", "email", "address", "occupation", "notes"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(headers.map((h) => csvEscape(r[h] ?? "")).join(","));
    }
    return "\uFEFF" + lines.join("\n");
  }
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]!);
  const rows = lines.slice(1).map(splitCsvLine);
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function guessField(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, string> = {
    name: "fullName",
    fullname: "fullName",
    patientname: "fullName",
    phone: "phone",
    mobile: "phone",
    email: "email",
    dob: "dateOfBirth",
    dateofbirth: "dateOfBirth",
    gender: "gender",
    sex: "gender",
    address: "address",
    occupation: "occupation",
    notes: "notes",
    title: "title",
  };
  return map[h] ?? (PATIENT_FIELDS.includes(header) ? header : null);
}
