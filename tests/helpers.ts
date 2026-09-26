import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DentivaApp } from "../src/core/app.ts";
import type { Actor } from "../src/core/context.ts";
import type { SessionInfo } from "../src/shared/types.ts";

export function tempDir(prefix = "dentiva-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function bootApp(): Promise<{ app: DentivaApp; actor: Actor; token: string; session: SessionInfo; dir: string }> {
  const dir = tempDir();
  const app = new DentivaApp(dir);
  await app.auth.bootstrap({
    clinicName: "Banani Dental Studio",
    adminName: "Dr. Rahman",
    username: "admin",
    password: "correct-horse-battery",
  });
  const { token, session } = await app.auth.login({ username: "admin", password: "correct-horse-battery" });
  const { actor } = app.auth.touch(token);
  return { app, actor, token, session, dir };
}

export function cleanup(app: DentivaApp, dir: string): void {
  try {
    app.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
