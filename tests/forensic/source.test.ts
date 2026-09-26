import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("source forensic audit", () => {
  it("does not ship eval, Function constructor, or remote code loading in product sources", () => {
    const roots = ["src", "scripts"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
          const text = fs.readFileSync(p, "utf8");
          if (/\beval\s*\(/.test(text) || /\bnew Function\s*\(/.test(text)) hits.push(p);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(hits).toEqual([]);
    const preload = fs.readFileSync("src/preload/index.ts", "utf8");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).toContain("allowed.has(channel)");
    const main = fs.readFileSync("src/main/index.ts", "utf8");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
  });

  it("source-audit reports zero product-source hits", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("npx", ["tsx", "scripts/source-audit.ts"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Source audit findings: 0/);
  });
});
