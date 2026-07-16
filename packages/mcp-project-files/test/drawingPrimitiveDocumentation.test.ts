import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));

describe("extract_drawing_primitives documentation and dependency contract", () => {
  it("documents the fixed tool input and persistence contract", () => {
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("extract_drawing_primitives");
    expect(readme).toContain('"relativePath"');
    expect(readme).toContain('"page"');
    expect(readme).toContain('"outputName"');
    expect(readme).toContain(".volt-ai/primitives/");
  });

  it("documents painted-path scope and the explicit analysis exclusions", () => {
    const section =
      readFileSync(readmePath, "utf8").split("extract_drawing_primitives")[1] ?? "";

    expect(section).toMatch(/painted path/i);
    expect(section).toMatch(/no (line|rectangle|polyline) classification/i);
    expect(section).toMatch(/no symbol or connection inference/i);
    expect(section).toMatch(/off-page.*preserv/i);
    expect(section).toMatch(/payload.*large|large.*payload/i);
    expect(section).not.toMatch(/"symbols"\s*:/u);
    expect(section).not.toMatch(/"connections"\s*:/u);
  });

  it("documents the PDF.js 6.1.200 compressed operator dependency", () => {
    const section =
      readFileSync(readmePath, "utf8").split("extract_drawing_primitives")[1] ?? "";

    expect(section).toContain("PDF.js 6.1.200");
    expect(section).toMatch(/compressed constructPath/i);
    expect(section).toMatch(/internal|non-public/i);
  });

  it("pins pdfjs-dist exactly because compressed constructPath is non-public", () => {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["pdfjs-dist"]).toBe("6.1.200");
  });
});
