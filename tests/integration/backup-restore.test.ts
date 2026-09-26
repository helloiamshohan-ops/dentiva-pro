import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { bootApp, cleanup } from "../helpers.ts";

describe("backup and restore", () => {
  it("round-trips a valid backup and rejects zip-slip", async () => {
    const ctx = await bootApp();
    const { app, actor, dir } = ctx;
    const patient = app.patients.create(actor, { fullName: "Backup Patient", ignoreDuplicateWarning: true });
    const created = await app.backup.create(actor, "test");
    expect(fs.existsSync(created.path)).toBe(true);
    expect(created.checksum).toMatch(/^[a-f0-9]{64}$/);

    const list = app.backup.list(actor, 1, 20);
    expect(list.total).toBe(1);

    const malicious = new JSZip();
    malicious.file("../evil.txt", "nope");
    malicious.file("manifest.json", JSON.stringify({ schemaVersion: 1, checksum: "x" }));
    const evilPath = path.join(dir, "evil.dvbak");
    fs.writeFileSync(evilPath, await malicious.generateAsync({ type: "nodebuffer" }));
    await expect(app.backup.restore(actor, evilPath)).rejects.toThrow(/unsafe path|rejected/i);

    const p2 = app.patients.create(actor, { fullName: "After backup", ignoreDuplicateWarning: true });
    await app.restoreAndReopen(actor, created.path);
    const restored = app.patients.get(actor, patient.id);
    expect(restored.fullName).toBe("Backup Patient");
    expect(() => app.patients.get(actor, p2.id)).toThrow();
    cleanup(app, dir);
  });

  it("rejects a corrupt archive without touching live data", async () => {
    const ctx = await bootApp();
    const { app, actor, dir } = ctx;
    const patient = app.patients.create(actor, { fullName: "Keep Me", ignoreDuplicateWarning: true });
    const bad = path.join(dir, "bad.dvbak");
    fs.writeFileSync(bad, "not a zip");
    await expect(app.backup.restore(actor, bad)).rejects.toThrow(/could not be read/i);
    expect(app.patients.get(actor, patient.id).fullName).toBe("Keep Me");
    cleanup(app, dir);
  });
});
