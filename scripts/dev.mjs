import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = {
  ...process.env,
  DENTIVA_DATA_DIR: process.env.DENTIVA_DATA_DIR || path.join(root, "data"),
  DENTIVA_API_HOST: "0.0.0.0",
  DENTIVA_API_PORT: process.env.DENTIVA_API_PORT || "4780",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-sqlite"].filter(Boolean).join(" "),
};

function run(cmd, args, name) {
  const child = spawn(cmd, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code) => {
    process.stderr.write(`[${name}] exited ${code}\n`);
    process.exit(code || 0);
  });
  return child;
}

run("npx", ["tsx", "src/server/index.ts"], "api");
run("npx", ["vite", "--config", "vite.config.ts", "--host", "0.0.0.0", "--port", "5173"], "ui");
