import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

describe("drawing classification documentation contract", () => {
  it("documents the tool, input, persistence path, and structural scope", () => {
    const readme = readFileSync(readmePath, "utf8");
    const section =
      readme.split("extract_drawing_classification")[1] ?? "";

    expect(readme).toContain("extract_drawing_classification");
    expect(section).toContain('"relativePath"');
    expect(section).toContain('"page"');
    expect(section).toContain('"outputName"');
    expect(section).toContain(".volt-ai/classifications/");
    expect(section).toMatch(/structural classification/i);
  });

  it("defines confidence and duplicate as deterministic non-semantic contracts", () => {
    const section =
      readFileSync(readmePath, "utf8").split(
        "extract_drawing_classification",
      )[1] ?? "";

    expect(section).toMatch(/confidence.*rule|rule.*confidence/i);
    expect(section).toMatch(/geometry duplicate/i);
    expect(section).toMatch(/not.*semantic|no semantic/i);
    expect(section).toMatch(/rectangleCandidate/);
    expect(section).toMatch(
      /no symbol recognition|no wire detection|no circuit analysis/i,
    );
  });
});
