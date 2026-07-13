import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsObservations = vi.hoisted(() => ({
  destinationExistedAtRename: [] as boolean[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    renameSync(source: Parameters<typeof actual.renameSync>[0], destination: Parameters<typeof actual.renameSync>[1]) {
      fsObservations.destinationExistedAtRename.push(actual.existsSync(destination));
      actual.renameSync(source, destination);
    },
  };
});

import { renderPdfPage } from "../src/tools/renderPdfPage.js";
import {
  createTempPdfProject,
  createTextPdf,
  writeProjectFile,
} from "./helpers/pdfFixture.js";

const tempRoots: string[] = [];

describe("renderPdfPage atomic replacement", () => {
  afterEach(() => {
    fsObservations.destinationExistedAtRename.length = 0;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the previous image in place until the replacement rename", async () => {
    const root = createTempPdfProject();
    tempRoots.push(root);
    writeProjectFile(root, "docs/spec.pdf", createTextPdf("Atomic replacement"));
    const input = {
      relativePath: "docs/spec.pdf",
      page: 1,
      scale: 2,
      format: "png",
    } as const;

    const first = await renderPdfPage(root, input);
    const second = await renderPdfPage(root, input);

    expect(second.relativeImagePath).toBe(first.relativeImagePath);
    expect(fsObservations.destinationExistedAtRename).toEqual([false, true]);
  });
});
