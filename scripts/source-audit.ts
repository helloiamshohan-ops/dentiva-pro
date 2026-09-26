import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "dist", "release", "data", ".git", "coverage"]);
const SKIP_FILES = new Set(["source-audit.ts", "ENGINEERING_CHECKPOINT.md", "FORENSIC_AUDIT.md", "REQUIREMENT_COVERAGE.md", "production.test.ts"]);
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "TODO", re: /\bTODO\b/ },
  { name: "FIXME", re: /\bFIXME\b/ },
  { name: "HACK", re: /\bHACK\b/ },
  { name: "activation", re: /\b(activation server|license key|machine binding)\b/i },
];

const hits: Array<{ file: string; name: string; line: number; text: string }> = [];

function walk(dir: string): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(ent.name) && !SKIP_FILES.has(ent.name)) scan(p);
  }
}

function scan(file: string): void {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    if (/no activation|there is \*\*no\*\*|not toMatch/i.test(text)) return;
    for (const p of PATTERNS) {
      if (p.re.test(text)) {
        hits.push({ file: path.relative(ROOT, file), name: p.name, line: i + 1, text: text.trim().slice(0, 160) });
      }
    }
  });
}

walk(ROOT);
process.stdout.write(`Source audit findings: ${hits.length}\n`);
for (const h of hits) {
  process.stdout.write(`${h.name} ${h.file}:${h.line} ${h.text}\n`);
}
if (hits.length) process.exitCode = 1;
