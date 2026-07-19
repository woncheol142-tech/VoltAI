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

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import { writeDrawingSpatialRelations } from "../src/drawingSpatial/writeDrawingSpatialRelations.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { createDrawingSpatialFixture } from "./helpers/drawingSpatialFixture.js";

const roots: string[] = [];

describe("drawing spatial atomic replacement", () => {
  afterEach(() => {
    observations.destinationExistedAtRename.length = 0;
    observations.temporaryPaths.length = 0;
    observations.failRename = false;
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an existing target until atomic rename", () => {
    const root = createTempPdfProject();
    roots.push(root);
    const document = buildDrawingSpatialRelations(
      createDrawingSpatialFixture(),
    );

    writeDrawingSpatialRelations(root, document, "spatial");
    writeDrawingSpatialRelations(root, document, "spatial");

    expect(observations.destinationExistedAtRename).toEqual([false, true]);
  });

  it("removes the temporary file when rename fails", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    const document = buildDrawingSpatialRelations(
      createDrawingSpatialFixture(),
    );
    writeDrawingSpatialRelations(root, document, "spatial");
    observations.failRename = true;

    expect(() =>
      writeDrawingSpatialRelations(root, document, "spatial")
    ).toThrow("rename failed");
    const fs = await import("node:fs");
    expect(observations.temporaryPaths.every((path) => !fs.existsSync(path)))
      .toBe(true);
  });
});

