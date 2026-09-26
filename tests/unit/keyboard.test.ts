import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../../src/shared/constants.ts";
import fs from "node:fs";
import path from "node:path";

describe("keyboard workflow", () => {
  it("documents and wires every required shortcut", () => {
    const required = [
      "Ctrl+K",
      "Ctrl+F",
      "Ctrl+N",
      "Ctrl+Shift+V",
      "Ctrl+Shift+A",
      "Ctrl+Shift+I",
      "Ctrl+Shift+P",
      "Ctrl+S",
      "Escape",
      "Ctrl+L",
    ];
    const keys = SHORTCUTS.map((s) => s.keys);
    for (const k of required) expect(keys).toContain(k);
    const app = fs.readFileSync(path.join("src", "renderer", "App.tsx"), "utf8");
    expect(app).toContain('e.key.toLowerCase() === "k"');
    expect(app).toContain('e.key.toLowerCase() === "f"');
    expect(app).toContain('e.key.toLowerCase() === "n"');
    expect(app).toContain('e.key.toLowerCase() === "v"');
    expect(app).toContain('e.key.toLowerCase() === "a"');
    expect(app).toContain('e.key.toLowerCase() === "i"');
    expect(app).toContain('e.key.toLowerCase() === "p"');
    expect(app).toContain('e.key.toLowerCase() === "s"');
    expect(app).toContain('e.key.toLowerCase() === "l"');
    expect(app).toContain('e.key === "Escape"');
    expect(app).toContain("requestSubmit");
    const docs = fs.readFileSync(path.join("docs", "KEYBOARD.md"), "utf8");
    for (const k of required) expect(docs).toContain(k);
  });
});
