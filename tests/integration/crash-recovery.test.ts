import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { DentivaApp } from "../../src/core/app.ts";
import { bootApp, cleanup } from "../helpers.ts";
import type { Actor } from "../../src/core/context.ts";

async function signIn(app: DentivaApp): Promise<Actor> {
  const r = await app.auth.login({ username: "admin", password: "correct-horse-battery" });
  return app.auth.touch(r.token).actor;
}

describe("crash and restore recovery", () => {
  const apps: Array<{ app: DentivaApp; dir: string }> = [];
  afterEach(() => {
    for (const a of apps) cleanup(a.app, a.dir);
    apps.length = 0;
  });

  it("clears the unclean-shutdown marker on close and boots when the marker is left behind", async () => {
    const ctx = await bootApp();
    apps.push(ctx);
    expect(fs.existsSync(ctx.app.paths.crashMarker)).toBe(true);
    const dir = ctx.dir;
    ctx.app.close();
    expect(fs.existsSync(ctx.app.paths.crashMarker)).toBe(false);
    fs.writeFileSync(path.join(dir, "unclean-shutdown.json"), JSON.stringify({ at: new Date().toISOString() }));
    const reopened = new DentivaApp(dir);
    apps.push({ app: reopened, dir });
    expect(reopened.ops.diagnostics().integrity).toBe(true);
  });

  it("restores the safety copy when a restore-in-progress marker is present and then removes the marker", async () => {
    const ctx = await bootApp();
    const { app, actor, dir } = ctx;
    const original = app.patients.create(actor, { fullName: "Original Name", ignoreDuplicateWarning: true });
    app.close();

    const live = path.join(dir, "clinic.db");
    const safetyDir = path.join(dir, "safety");
    fs.mkdirSync(safetyDir, { recursive: true });
    const safety = path.join(safetyDir, "pre-restore.db");
    fs.copyFileSync(live, safety);

    const mutated = new DentivaApp(dir);
    const actor2 = await signIn(mutated);
    mutated.patients.update(actor2, original.id, { fullName: "Mutated Name", ignoreDuplicateWarning: true });
    expect(mutated.patients.get(actor2, original.id).fullName).toBe("Mutated Name");
    mutated.close();

    fs.writeFileSync(
      path.join(dir, "restore-in-progress.json"),
      JSON.stringify({ at: new Date().toISOString(), safety, live }),
    );
    const recovered = new DentivaApp(dir);
    apps.push({ app: recovered, dir });
    const actor3 = await signIn(recovered);
    expect(recovered.patients.get(actor3, original.id).fullName).toBe("Original Name");
    expect(fs.existsSync(recovered.paths.recoveryMarker)).toBe(false);
  });
});
