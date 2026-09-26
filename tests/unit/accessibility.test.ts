import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("accessibility audit", () => {
  it("ships skip link, dialog roles, labelled navigation, focus styles, and English html lang", () => {
    const app = fs.readFileSync(path.join("src", "renderer", "App.tsx"), "utf8");
    const css = fs.readFileSync(path.join("src", "renderer", "styles", "global.css"), "utf8");
    const html = fs.readFileSync(path.join("src", "renderer", "index.html"), "utf8");
    const tokens = fs.readFileSync(path.join("src", "renderer", "styles", "tokens.css"), "utf8");
    expect(html).toContain('lang="en"');
    expect(app).toContain("skip-link");
    expect(app).toContain('aria-label="Clinic navigation"');
    expect(app).toContain("Skip to content");
    expect(app).toContain('role="dialog"');
    expect(app).toContain("aria-modal");
    expect(app).toContain('role="tablist"');
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("@media print");
    expect(tokens).toContain("--focus-ring");
    expect(tokens).toContain("--color-ink");
  });
});
