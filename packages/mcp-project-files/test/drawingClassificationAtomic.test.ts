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

import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import { writeDrawingClassification } from "../src/drawingClassification/writeDrawingClassification.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { makeClassificationDocument } from "./helpers/drawingClassificationFixture.js";

const roots: string[] = [];

describe("drawing classification atomic replacement", () => {
  afterEach(() => {
    observations.destinationExistedAtRename.length = 0;
    observations.temporaryPaths.length = 0;
    observations.failRename = false;
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the existing target until atomic rename", () => {
    const root = createTempPdfProject();
    roots.push(root);
    const document = classifyDrawingPrimitives(makeClassificationDocument([]));

    writeDrawingClassification(root, document, "classification");
    writeDrawingClassification(root, document, "classification");

    expect(observations.destinationExistedAtRename).toEqual([false, true]);
  });

  it("removes its temporary file when rename fails", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    const document = classifyDrawingPrimitives(makeClassificationDocument([]));
    writeDrawingClassification(root, document, "classification");
    observations.failRename = true;

    expect(() =>
      writeDrawingClassification(root, document, "classification"),
    ).toThrow("rename failed");
    const fs = await import("node:fs");
    expect(observations.temporaryPaths.every((path) => !fs.existsSync(path))).toBe(
      true,
    );
  });
});
