import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const observations = vi.hoisted(() => ({
  destinationExistedAtRename: [] as boolean[],
  temporaryPaths: [] as string[],
  failRename: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    writeFileSync(
      path: Parameters<typeof actual.writeFileSync>[0],
      data: Parameters<typeof actual.writeFileSync>[1],
      options?: Parameters<typeof actual.writeFileSync>[2],
    ) {
      if (String(path).endsWith(".tmp")) observations.temporaryPaths.push(String(path));
      return actual.writeFileSync(path, data, options as never);
    },
    renameSync(
      source: Parameters<typeof actual.renameSync>[0],
      destination: Parameters<typeof actual.renameSync>[1],
    ) {
      observations.destinationExistedAtRename.push(actual.existsSync(destination));
      if (observations.failRename) throw new Error("rename failed");
      actual.renameSync(source, destination);
    },
  };
});

import type { DrawingLayoutDocument } from "../src/drawingLayout/types.js";
import { writeDrawingLayout } from "../src/drawingLayout/writeDrawingLayout.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

const roots: string[] = [];

function document(): DrawingLayoutDocument {
  return {
    schemaVersion: 1,
    source: "docs/layout.pdf",
    sourceSha256: "a".repeat(64),
    page: 1,
    pageCount: 1,
    pageWidth: 600,
    pageHeight: 800,
    rotation: 0,
    cropBox: { x: 0, y: 0, width: 600, height: 800 },
    coordinateSystem: "normalized-top-left",
    itemCount: 0,
    lineCount: 0,
    items: [],
    lines: [],
    warnings: ["NO_TEXT_ITEMS: page contains no valid text items"],
  };
}

describe("DrawingLayoutDocument atomic replacement", () => {
  afterEach(() => {
    observations.destinationExistedAtRename.length = 0;
    observations.temporaryPaths.length = 0;
    observations.failRename = false;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("keeps the previous target present until the atomic rename", () => {
    const root = createTempPdfProject();
    roots.push(root);

    const first = writeDrawingLayout(root, document(), "layout");
    const second = writeDrawingLayout(root, document(), "layout");

    expect(second).toBe(first);
    expect(observations.destinationExistedAtRename).toEqual([false, true]);
  });

  it("removes its temporary file when atomic replacement fails", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingLayout(root, document(), "layout");
    observations.failRename = true;

    expect(() => writeDrawingLayout(root, document(), "layout")).toThrow("rename failed");
    const fs = await import("node:fs");
    expect(
      observations.temporaryPaths.every((path) => !fs.existsSync(path)),
    ).toBe(true);
  });
});
