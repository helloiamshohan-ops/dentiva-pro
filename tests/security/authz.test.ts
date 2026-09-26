import { describe, expect, it } from "vitest";
import { bootApp, cleanup } from "../helpers.ts";
import { assertNoZipSlip } from "../../src/core/security/paths.ts";
import { hashSecret, verifySecret, looksHashed } from "../../src/core/security/passwords.ts";

describe("security", () => {
  it("never stores plaintext passwords", async () => {
    const { app, dir } = await bootApp();
    const row = app.db.prepare("SELECT password_hash FROM staff WHERE username = 'admin'").get() as { password_hash: string };
    expect(looksHashed(row.password_hash)).toBe(true);
    expect(row.password_hash).not.toContain("correct-horse-battery");
    expect(await verifySecret("correct-horse-battery", row.password_hash)).toBe(true);
    expect(await verifySecret("wrong", row.password_hash)).toBe(false);
    cleanup(app, dir);
  });

  it("locks out after repeated failures", async () => {
    const { app, dir } = await bootApp();
    for (let i = 0; i < 5; i++) {
      await expect(app.auth.login({ username: "admin", password: "nope" })).rejects.toThrow();
    }
    await expect(app.auth.login({ username: "admin", password: "correct-horse-battery" })).rejects.toThrow(/too many/i);
    cleanup(app, dir);
  });

  it("hashes with scrypt", async () => {
    const h = await hashSecret("abcd1234");
    expect(h.startsWith("scrypt$")).toBe(true);
  });

  it("rejects zip slip", () => {
    expect(() => assertNoZipSlip("../../secret")).toThrow();
  });
});
