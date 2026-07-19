import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

describe("drawing spatial documentation contract", () => {
  it("documents the tool, input, persistence path, and bbox basis", () => {
    const readme = readFileSync(readmePath, "utf8");
    const section =
      readme.split("extract_drawing_spatial_relations")[1] ?? "";

    expect(readme).toContain("extract_drawing_spatial_relations");
    expect(section).toContain('"relativePath"');
    expect(section).toContain('"page"');
    expect(section).toContain('"outputName"');
    expect(section).toContain(".volt-ai/spatial/");
    expect(section).toMatch(/page-space|page-bbox|bounding box/i);
  });

  it("states the geometry-only scope and explicit non-goals", () => {
    const section =
      readFileSync(readmePath, "utf8").split(
        "extract_drawing_spatial_relations",
      )[1] ?? "";

    expect(section).toMatch(/geometry relation|spatial relation/i);
    expect(section).toMatch(/item.*line|line.*item/i);
    expect(section).toMatch(
      /no symbol recognition|no semantic reasoning|not semantic/i,
    );
    expect(section).toMatch(
      /no connection|no circuit|no OCR|no AI/i,
    );
  });
});

