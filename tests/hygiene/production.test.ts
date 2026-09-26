import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import type { DentivaApp } from "../../src/core/app.ts";

const ROOT = path.resolve(".");

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "release", "data", ".git"].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|sql|md|yml)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

describe("production-data hygiene", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("seeds no sample patients and stores no plaintext passwords", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    const patients = (ctx.app.db.prepare("SELECT COUNT(*) AS c FROM patients").get() as { c: number }).c;
    expect(patients).toBe(0);
    const row = ctx.app.db.prepare("SELECT password_hash FROM staff WHERE username = 'admin'").get() as { password_hash: string };
    expect(row.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row.password_hash).not.toContain("correct-horse-battery");
  });

  it("contains no activation, serial, license, or machine-binding lock", () => {
    const files = walk(path.join(ROOT, "src"));
    const joined = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect(joined).not.toMatch(/activation server/i);
    expect(joined).not.toMatch(/license key/i);
    expect(joined).not.toMatch(/machine binding/i);
    expect(joined).not.toMatch(/trial expired/i);
    expect(joined).not.toMatch(/nodeIntegration:\s*true/);
    expect(joined).not.toMatch(/contextIsolation:\s*false/);
    expect(joined).not.toMatch(/sandbox:\s*false/);
  });
});
