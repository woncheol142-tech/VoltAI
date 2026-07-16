import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

describe("extract_drawing_layout documentation", () => {
  it("documents the fixed input contract and layouts output directory", () => {
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("extract_drawing_layout");
    expect(readme).toContain('"relativePath": "project-files/전기 결합_1_100.pdf"');
    expect(readme).toContain('"page": 69');
    expect(readme).toContain('"outputName"');
    expect(readme).toContain(".volt-ai/layouts/");
  });

  it("does not document excluded Task 43B+ output fields as current layout fields", () => {
    const readme = readFileSync(readmePath, "utf8");
    const section = readme.split("extract_drawing_layout")[1] ?? "";

    expect(section).not.toMatch(/"blocks"\s*:/u);
    expect(section).not.toMatch(/"regions"\s*:/u);
    expect(section).not.toMatch(/"primitives"\s*:/u);
    expect(section).not.toMatch(/"symbols"\s*:/u);
    expect(section).not.toMatch(/"connections"\s*:/u);
  });
});
