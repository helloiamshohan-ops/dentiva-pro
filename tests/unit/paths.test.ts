import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { assertNoZipSlip, resolveInside, sanitizeFilename } from "../../src/core/security/paths.ts";

describe("path security", () => {
  it("rejects zip-slip entries", () => {
    expect(() => assertNoZipSlip("../etc/passwd")).toThrow();
    expect(() => assertNoZipSlip("..\\windows\\system32")).toThrow();
    expect(() => assertNoZipSlip("/etc/passwd")).toThrow();
    expect(() => assertNoZipSlip("C:/windows/notepad.exe")).toThrow();
    expect(assertNoZipSlip("clinic.db")).toBe("clinic.db");
    expect(assertNoZipSlip("attachments/x.png")).toBe("attachments/x.png");
  });

  it("keeps resolved paths inside the root", () => {
    const root = path.join(os.tmpdir(), "dentiva-root");
    expect(() => resolveInside(root, "..", "outside")).toThrow();
    expect(resolveInside(root, "attachments", "a.png")).toBe(path.resolve(root, "attachments", "a.png"));
  });

  it("sanitizes filenames", () => {
    expect(sanitizeFilename("ok file.pdf")).toBe("ok file.pdf");
    expect(() => sanitizeFilename("..")).toThrow();
    expect(sanitizeFilename("a<>b.pdf")).toContain("_");
  });
});
