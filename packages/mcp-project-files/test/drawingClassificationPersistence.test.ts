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

import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import { writeDrawingClassification } from "../src/drawingClassification/writeDrawingClassification.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createDrawingClassificationFixture,
  makeClassificationDocument,
} from "./helpers/drawingClassificationFixture.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

describe("drawing classification persistence", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes deterministic compact schema v1 with UTF-8 and trailing LF", () => {
    const root = tempRoot();
    const input = createDrawingClassificationFixture();
    input.source = "docs/전기 도면.pdf";
    input.warnings = ["한글 경고"];
    const document = classifyDrawingPrimitives(input);
    const sourceHash = createHash("sha256")
      .update("docs/전기 도면.pdf", "utf8")
      .digest("hex")
      .slice(0, 12);

    const firstPath = writeDrawingClassification(root, document, "도면 분류");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeDrawingClassification(
      root,
      structuredClone(document),
      "도면 분류",
    );
    const secondBytes = readFileSync(join(root, secondPath));

    expect(firstPath).toBe(
      `.volt-ai/classifications/도면_분류-${sourceHash}-page-069.json`,
    );
    expect(firstPath).not.toContain("\\");
    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(firstBytes.toString("utf8")).toBe(`${JSON.stringify(document)}\n`);
    expect(firstBytes.toString("utf8")).toContain("한글 경고");
  });

  it("does not persist any relative path inside the public document", () => {
    const root = tempRoot();
    const document = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const target = writeDrawingClassification(root, document, "classification");
    const stored = JSON.parse(readFileSync(join(root, target), "utf8")) as Record<
      string,
      unknown
    >;

    expect(stored).toEqual(document);
    expect(stored).not.toHaveProperty("relativeClassificationPath");
  });

  it("uses source path hash to avoid same-output-name collisions", () => {
    const root = tempRoot();
    const first = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const second = {
      ...structuredClone(first),
      source: "other/classification.pdf",
    };

    const firstPath = writeDrawingClassification(root, first, "classification");
    const secondPath = writeDrawingClassification(root, second, "classification");

    expect(secondPath).not.toBe(firstPath);
    expect(existsSync(join(root, firstPath))).toBe(true);
    expect(existsSync(join(root, secondPath))).toBe(true);
  });

  it("normalizes NFKC-equivalent output names", () => {
    const root = tempRoot();
    const document = classifyDrawingPrimitives(makeClassificationDocument([]));

    expect(writeDrawingClassification(root, document, "ＣＬＡＳＳ")).toBe(
      writeDrawingClassification(root, document, "CLASS"),
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
      writeDrawingClassification(
        tempRoot(),
        classifyDrawingPrimitives(makeClassificationDocument([])),
        outputName,
      ),
    ).toThrow(message);
  });

  it("rejects output directory and target symlinks", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const document = classifyDrawingPrimitives(makeClassificationDocument([]));
    symlinkSync(outside, join(root, ".volt-ai"));

    expect(() =>
      writeDrawingClassification(root, document, "classification"),
    ).toThrow(/symbolic/i);

    rmSync(join(root, ".volt-ai"));
    const target = writeDrawingClassification(root, document, "classification");
    const absolute = join(root, target);
    const outsideFile = join(root, "outside.json");
    writeFileSync(outsideFile, "{}\n");
    rmSync(absolute);
    symlinkSync(outsideFile, absolute);

    expect(() =>
      writeDrawingClassification(root, document, "classification"),
    ).toThrow(/symbolic/i);
  });

  it("rejects an existing directory target and leaves no temp files", () => {
    const root = tempRoot();
    const document = classifyDrawingPrimitives(makeClassificationDocument([]));
    const target = writeDrawingClassification(root, document, "classification");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);

    expect(() =>
      writeDrawingClassification(root, document, "classification"),
    ).toThrow(/regular|file/i);
    expect(
      readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});
