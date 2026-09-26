import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

async function main(): Promise<void> {
  fs.mkdirSync("dist/main", { recursive: true });
  fs.mkdirSync("dist/preload", { recursive: true });
  fs.mkdirSync("dist/core/db/migrations", { recursive: true });

  await esbuild.build({
    entryPoints: ["src/main/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: "dist/main/index.js",
    external: ["electron", "node:sqlite"],
    sourcemap: false,
  });

  await esbuild.build({
    entryPoints: ["src/preload/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: "dist/preload/index.js",
    external: ["electron"],
    sourcemap: false,
  });

  const migSrc = "src/core/db/migrations";
  fs.mkdirSync("dist/main/migrations", { recursive: true });
  for (const f of fs.readdirSync(migSrc).filter((x) => x.endsWith(".sql"))) {
    fs.copyFileSync(path.join(migSrc, f), path.join("dist/core/db/migrations", f));
    fs.copyFileSync(path.join(migSrc, f), path.join("dist/main/migrations", f));
  }
}

void main();
