import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import { writeDrawingSpatialRelations } from "../src/drawingSpatial/writeDrawingSpatialRelations.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { createDrawingSpatialFixture } from "./helpers/drawingSpatialFixture.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

describe("drawing spatial persistence", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes deterministic compact UTF-8 schema v1 with trailing LF", () => {
    const root = tempRoot();
    const fixture = createDrawingSpatialFixture();
    fixture.layout.source = "docs/전기 공간.pdf";
    fixture.primitive.source = fixture.layout.source;
    fixture.classification.source = fixture.layout.source;
    fixture.layout.warnings = ["한글 경고"];
    const document = buildDrawingSpatialRelations(fixture);
    const sourceHash = createHash("sha256")
      .update("docs/전기 공간.pdf", "utf8")
      .digest("hex")
      .slice(0, 12);

    const firstPath = writeDrawingSpatialRelations(root, document, "공간 관계");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeDrawingSpatialRelations(
      root,
      structuredClone(document),
      "공간 관계",
    );
    const secondBytes = readFileSync(join(root, secondPath));

    expect(firstPath).toBe(
      `.volt-ai/spatial/공간_관계-${sourceHash}-page-015.json`,
    );
    expect(firstPath).not.toContain("\\");
    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(firstBytes.toString("utf8")).toBe(`${JSON.stringify(document)}\n`);
    expect(firstBytes.toString("utf8")).toContain("한글 경고");
    expect(firstBytes.toString("utf8")).not.toContain("\n  ");
  });

  it("persists the document without adding a relative path field", () => {
    const root = tempRoot();
    const document = buildDrawingSpatialRelations(
      createDrawingSpatialFixture(),
    );
    const target = writeDrawingSpatialRelations(root, document, "spatial");
    const stored = JSON.parse(readFileSync(join(root, target), "utf8"));

    expect(stored).toEqual(document);
    expect(stored).not.toHaveProperty("relativeSpatialPath");
  });

  it("uses source path hash to prevent normalized output-name collisions", () => {
    const root = tempRoot();
    const first = buildDrawingSpatialRelations(createDrawingSpatialFixture());
    const fixture = createDrawingSpatialFixture();
    fixture.layout.source = "other/spatial.pdf";
    fixture.primitive.source = fixture.layout.source;
    fixture.classification.source = fixture.layout.source;
    const second = buildDrawingSpatialRelations(fixture);

    const firstPath = writeDrawingSpatialRelations(root, first, "spatial");
    const secondPath = writeDrawingSpatialRelations(root, second, "spatial");

    expect(secondPath).not.toBe(firstPath);
    expect(existsSync(join(root, firstPath))).toBe(true);
    expect(existsSync(join(root, secondPath))).toBe(true);
  });

  it("normalizes NFKC-equivalent output names", () => {
    const root = tempRoot();
    const document = buildDrawingSpatialRelations(
      createDrawingSpatialFixture(),
    );

    expect(writeDrawingSpatialRelations(root, document, "ＳＰＡＴＩＡＬ")).toBe(
      writeDrawingSpatialRelations(root, document, "SPATIAL"),
    );
  });

  it.each([
    ["", /outputName/i],
    ["   ", /outputName/i],
    [".hidden", /hidden|outputName/i],
    ["../escape", /separator|outputName|path/i],
    ["nested/name", /separator|outputName/i],
    ["nested\\name", /separator|outputName/i],
  ])("rejects unsafe outputName %j", (outputName, message) => {
    expect(() =>
      writeDrawingSpatialRelations(
        tempRoot(),
        buildDrawingSpatialRelations(createDrawingSpatialFixture()),
        outputName,
      )
    ).toThrow(message);
  });

  it("rejects parent and final-target symlinks", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const document = buildDrawingSpatialRelations(
      createDrawingSpatialFixture(),
    );
    symlinkSync(outside, join(root, ".volt-ai"));

    expect(() =>
      writeDrawingSpatialRelations(root, document, "spatial")
    ).toThrow(/symbolic/i);

    rmSync(join(root, ".volt-ai"));
    const target = writeDrawingSpatialRelations(root, document, "spatial");
    const absolute = join(root, target);
    const outsideFile = join(root, "outside.json");
    writeFileSync(outsideFile, "{}\n");
    rmSync(absolute);
    symlinkSync(outsideFile, absolute);

    expect(() =>
      writeDrawingSpatialRelations(root, document, "spatial")
    ).toThrow(/symbolic/i);
  });

  it("rejects directory targets and cleans temporary files", () => {
    const root = tempRoot();
    const document = buildDrawingSpatialRelations(
      createDrawingSpatialFixture(),
    );
    const target = writeDrawingSpatialRelations(root, document, "spatial");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);

    expect(() =>
      writeDrawingSpatialRelations(root, document, "spatial")
    ).toThrow(/regular|file/i);
    expect(
      readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});

