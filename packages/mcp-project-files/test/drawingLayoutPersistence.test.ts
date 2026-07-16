import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DrawingLayoutDocument } from "../src/drawingLayout/types.js";
import { writeDrawingLayout } from "../src/drawingLayout/writeDrawingLayout.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function layoutDocument(
  overrides: Partial<DrawingLayoutDocument> = {},
): DrawingLayoutDocument {
  return {
    schemaVersion: 1,
    source: "docs/electrical.pdf",
    sourceSha256: "a".repeat(64),
    page: 69,
    pageCount: 100,
    pageWidth: 595,
    pageHeight: 842,
    rotation: 0,
    cropBox: { x: 0, y: 0, width: 595, height: 842 },
    coordinateSystem: "normalized-top-left",
    itemCount: 1,
    lineCount: 1,
    items: [
      {
        id: "text-item-000001",
        text: "MCCB",
        normalizedText: "MCCB",
        bbox: { x: 0.1, y: 0.2, width: 0.05, height: 0.01 },
        pageBBox: { x: 59.5, y: 168.4, width: 29.75, height: 8.42 },
        rotation: 270,
        fontName: "FixtureFont",
        fontSize: 8.42,
        direction: "ltr",
        hasEOL: true,
        sourceOrder: 3,
        provenance: {
          transform: [0, -8.42, 8.42, 0, 59.5, 673.6],
          width: 29.75,
          height: 8.42,
        },
      },
    ],
    lines: [
      {
        id: "line-000001",
        text: "MCCB",
        normalizedText: "MCCB",
        bbox: { x: 0.1, y: 0.2, width: 0.05, height: 0.01 },
        pageBBox: { x: 59.5, y: 168.4, width: 29.75, height: 8.42 },
        rotation: 270,
        itemIds: ["text-item-000001"],
        sourceOrders: [3],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("DrawingLayoutDocument deterministic persistence", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("writes the approved schema to a deterministic PROJECT_ROOT-relative POSIX path", () => {
    const root = tempRoot();
    const document = layoutDocument();
    const expectedSourceHash = createHash("sha256")
      .update("docs/electrical.pdf", "utf8")
      .digest("hex")
      .slice(0, 12);

    const relativePath = writeDrawingLayout(root, document, "electrical-layout");
    const stored = JSON.parse(readFileSync(join(root, relativePath), "utf8")) as DrawingLayoutDocument;

    expect(relativePath).toBe(
      `.volt-ai/layouts/electrical-layout-${expectedSourceHash}-page-069.json`,
    );
    expect(relativePath).not.toContain("\\");
    expect(stored).toEqual(document);
    expect(stored).not.toHaveProperty("relativeLayoutPath");
  });

  it("produces identical path and UTF-8 JSON bytes for identical input", () => {
    const root = tempRoot();
    const base = layoutDocument();
    const document = layoutDocument({
      items: [
        {
          ...base.items[0]!,
          text: "도면",
          normalizedText: "도면",
        },
      ],
      lines: [
        {
          ...base.lines[0]!,
          text: "도면",
          normalizedText: "도면",
        },
      ],
    });

    const firstPath = writeDrawingLayout(root, document, "도면 레이아웃");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeDrawingLayout(root, structuredClone(document), "도면 레이아웃");
    const secondBytes = readFileSync(join(root, secondPath));

    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(firstBytes.toString("utf8")).toContain("도면");
  });

  it("uses the source-path hash to avoid same-basename collisions", () => {
    const root = tempRoot();

    const first = writeDrawingLayout(
      root,
      layoutDocument({ source: "building-a/electrical.pdf" }),
      "layout",
    );
    const second = writeDrawingLayout(
      root,
      layoutDocument({ source: "building-b/electrical.pdf" }),
      "layout",
    );

    expect(second).not.toBe(first);
    expect(existsSync(join(root, first))).toBe(true);
    expect(existsSync(join(root, second))).toBe(true);
  });

  it("treats NFKC-equivalent output names as the same deterministic logical name", () => {
    const root = tempRoot();
    const document = layoutDocument();

    expect(writeDrawingLayout(root, document, "ＬＡＹＯＵＴ")).toBe(
      writeDrawingLayout(root, document, "LAYOUT"),
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
    expect(() => writeDrawingLayout(tempRoot(), layoutDocument(), outputName)).toThrow(message);
  });

  it("rejects a symbolic link in the output directory chain", () => {
    const root = tempRoot();
    const outside = tempRoot();
    symlinkSync(outside, join(root, ".volt-ai"));

    expect(() => writeDrawingLayout(root, layoutDocument(), "layout")).toThrow(/symbolic/i);
  });

  it("rejects an existing symbolic-link target", () => {
    const root = tempRoot();
    const target = writeDrawingLayout(root, layoutDocument(), "layout");
    const absolute = join(root, target);
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}\n");
    rmSync(absolute);
    symlinkSync(outside, absolute);

    expect(() => writeDrawingLayout(root, layoutDocument(), "layout")).toThrow(/symbolic/i);
  });

  it("rejects an existing non-regular target", () => {
    const root = tempRoot();
    const target = writeDrawingLayout(root, layoutDocument(), "layout");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);

    expect(() => writeDrawingLayout(root, layoutDocument(), "layout")).toThrow(/regular|file/i);
  });

  it("cleans temporary files after a successful overwrite", () => {
    const root = tempRoot();
    const target = writeDrawingLayout(root, layoutDocument(), "layout");
    writeDrawingLayout(root, layoutDocument({ warnings: ["updated"] }), "layout");
    const directory = dirname(join(root, target));

    expect(
      readFileSync(join(root, target), "utf8"),
    ).toContain("updated");
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("stores a zero-item layout without inventing excluded arrays", () => {
    const root = tempRoot();
    const target = writeDrawingLayout(
      root,
      layoutDocument({
        itemCount: 0,
        lineCount: 0,
        items: [],
        lines: [],
        warnings: ["NO_TEXT_ITEMS: page contains no valid text items"],
      }),
      "empty-layout",
    );
    const stored = JSON.parse(readFileSync(join(root, target), "utf8")) as Record<string, unknown>;

    expect(stored).toMatchObject({ itemCount: 0, lineCount: 0, items: [], lines: [] });
    expect(stored).not.toHaveProperty("blocks");
    expect(stored).not.toHaveProperty("regions");
  });

  it("supports a layout JSON larger than 10 MiB without truncating deterministic bytes", () => {
    const root = tempRoot();
    const largeText = "MCCB".repeat(2_700_000);
    const document = layoutDocument({
      items: [
        {
          ...layoutDocument().items[0]!,
          text: largeText,
          normalizedText: largeText,
        },
      ],
    });
    const target = writeDrawingLayout(root, document, "large-layout");

    expect(lstatSync(join(root, target)).size).toBeGreaterThan(10 * 1024 * 1024);
  });
});
