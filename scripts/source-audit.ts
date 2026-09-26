import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "dist", "release", "data", ".git", "coverage"]);
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "TODO", re: /\bTODO\b/ },
  { name: "FIXME", re: /\bFIXME\b/ },
  { name: "HACK", re: /\bHACK\b/ },
  { name: "placeholder", re: /\bplaceholder\b/i },
  { name: "activation", re: /\b(license key|serial number|activation server|machine binding)\b/i },
];

const hits: Array<{ file: string; name: string; line: number; text: string }> = [];

function walk(dir: string): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|sql|md)$/.test(ent.name)) scan(p);
  }
}

function scan(file: string): void {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(text) && !text.includes("source-audit") && !file.includes("ENGINEERING_CHECKPOINT")) {
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
