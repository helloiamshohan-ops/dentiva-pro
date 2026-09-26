import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors.ts";

function stripUnsafeFilenameChars(name: string): string {
  let out = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    out += code < 32 || '<>:"|?*'.includes(ch) ? "_" : ch;
  }
  return out;
}

export function sanitizeFilename(name: string): string {
  const base = stripUnsafeFilenameChars(path.basename(name)).replace(/^\.+/, "_").trim();
  const cleaned = base.replace(/\s+/g, " ");
  if (!cleaned || cleaned === "_" || cleaned === ".") {
    throw new AppError("VALIDATION", "The file name is not allowed.");
  }
  return cleaned.slice(0, 180);
}

export function resolveInside(root: string, ...parts: string[]): string {
  const base = path.resolve(root);
  for (const part of parts) {
    if (part.includes("\0")) {
      throw new AppError("VALIDATION", "The requested path is not allowed.");
    }
  }
  const target = path.resolve(base, ...parts);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AppError("VALIDATION", "The requested path is not allowed.");
  }
  return target;
}

export function assertNoZipSlip(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    normalized.includes("..") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new AppError("RESTORE", "The backup archive contains an unsafe path and was rejected. Your current database has not been changed.");
  }
  if (normalized.split("/").some((p) => p === ".." || p === "")) {
    // allow folder prefixes but not empty or ..
    const segs = normalized.split("/").filter(Boolean);
    if (segs.some((s) => s === ".." || s === ".")) {
      throw new AppError("RESTORE", "The backup archive contains an unsafe path and was rejected. Your current database has not been changed.");
    }
  }
  return normalized;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function copyFileSafe(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}
