import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

describe("mcp-project-files documentation", () => {
  it("documents read_pdf page extraction and render_pdf_page usage", () => {
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain('"relativePath": "project-files/전기 결합_1_100.pdf"');
    expect(readme).toContain('"maxChars": 50000');
    expect(readme).toContain("render_pdf_page");
    expect(readme).toContain('"page": 2');
    expect(readme).toContain('"scale": 2');
    expect(readme).toContain('"format": "png"');
  });

  it("declares the PDF.js-compatible canvas runtime as a direct dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies?.["@napi-rs/canvas"]).toBeDefined();
  });
});
