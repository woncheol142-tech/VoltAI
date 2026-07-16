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
      if (String(path).endsWith(".tmp")) {
        observations.temporaryPaths.push(String(path));
      }
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

import type { DrawingPrimitiveDocument } from "../src/drawingPrimitive/types.js";
import { writeDrawingPrimitives } from "../src/drawingPrimitive/writeDrawingPrimitives.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

const roots: string[] = [];

function emptyDocument(): DrawingPrimitiveDocument {
  return {
    schemaVersion: 1,
    source: "docs/primitives.pdf",
    sourceSha256: "a".repeat(64),
    page: 1,
    pageCount: 1,
    pageWidth: 600,
    pageHeight: 800,
    rotation: 0,
    cropBox: { x: 0, y: 0, width: 600, height: 800 },
    coordinateSystem: "normalized-top-left",
    primitiveCount: 0,
    primitives: [],
    warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
  };
}

describe("DrawingPrimitiveDocument atomic replacement", () => {
  afterEach(() => {
    observations.destinationExistedAtRename.length = 0;
    observations.temporaryPaths.length = 0;
    observations.failRename = false;
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the previous target until atomic rename", () => {
    const root = createTempPdfProject();
    roots.push(root);

    const first = writeDrawingPrimitives(root, emptyDocument(), "primitives");
    const second = writeDrawingPrimitives(root, emptyDocument(), "primitives");

    expect(second).toBe(first);
    expect(observations.destinationExistedAtRename).toEqual([false, true]);
  });

  it("removes its temporary file when atomic replacement fails", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPrimitives(root, emptyDocument(), "primitives");
    observations.failRename = true;

    expect(() =>
      writeDrawingPrimitives(root, emptyDocument(), "primitives"),
    ).toThrow("rename failed");
    const fs = await import("node:fs");
    expect(observations.temporaryPaths.every((path) => !fs.existsSync(path))).toBe(true);
  });
});
