import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIRS = ["release", "dist"];
const hashes: string[] = [];

function walk(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.isFile() && fs.statSync(p).size > 0) {
      const buf = fs.readFileSync(p);
      const digest = crypto.createHash("sha256").update(buf).digest("hex");
      hashes.push(`${digest}  ${path.relative(ROOT, p)}`);
    }
  }
}

for (const d of DIRS) walk(path.join(ROOT, d));
hashes.sort();
const out = path.join(ROOT, "SHA256SUMS.txt");
const body =
  hashes.length === 0
    ? "# No dist/release artifacts on this host. Hash after a successful Windows/Electron build.\n"
    : hashes.join("\n") + "\n";
fs.writeFileSync(out, body);
process.stdout.write(`Wrote ${out} (${hashes.length} files)\n`);
