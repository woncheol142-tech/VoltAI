import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createListProjectFilesTool,
  listProjectFiles,
} from "../src/tools/listProjectFiles.js";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-project-files-"));
  tempRoots.push(root);
  return root;
}

function writeProjectFile(root: string, relativePath: string, content = "fixture"): void {
  const pathParts = relativePath.split("/");
  const fileName = pathParts.pop();

  if (!fileName) {
    throw new Error("relativePath must include a file name");
  }

  const directory = join(root, ...pathParts);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), content);
}

describe("listProjectFiles", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns only allowed project file extensions", () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf");
    writeProjectFile(root, "sheets/estimate.xlsx");
    writeProjectFile(root, "sheets/legacy.xls");
    writeProjectFile(root, "cad/main.dwg");
    writeProjectFile(root, "cad/export.dxf");
    writeProjectFile(root, "notes/readme.txt");
    writeProjectFile(root, "image.png");

    const files = listProjectFiles(root);

    expect(files.map((file) => file.relativePath).sort()).toEqual([
      "cad/export.dxf",
      "cad/main.dwg",
      "docs/spec.pdf",
      "sheets/estimate.xlsx",
      "sheets/legacy.xls",
    ]);
  });

  it("handles uppercase and mixed-case extensions", () => {
    const root = createTempProject();
    writeProjectFile(root, "A.PDF");
    writeProjectFile(root, "B.XLSX");
    writeProjectFile(root, "C.DwG");

    const files = listProjectFiles(root);

    expect(files.map((file) => file.extension).sort()).toEqual([
      ".dwg",
      ".pdf",
      ".xlsx",
    ]);
  });

  it("excludes hidden folders and node_modules", () => {
    const root = createTempProject();
    writeProjectFile(root, "visible/keep.pdf");
    writeProjectFile(root, ".hidden/skip.pdf");
    writeProjectFile(root, "visible/.cache/skip.xlsx");
    writeProjectFile(root, "node_modules/package/skip.dwg");

    const files = listProjectFiles(root);

    expect(files.map((file) => file.relativePath)).toEqual(["visible/keep.pdf"]);
  });

  it("includes name, relativePath, extension, size, and modifiedAt", () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/spec.pdf", "123456");

    const [file] = listProjectFiles(root);

    expect(file).toMatchObject({
      name: "spec.pdf",
      relativePath: "docs/spec.pdf",
      extension: ".pdf",
      size: 6,
    });
    expect(new Date(file.modifiedAt).toString()).not.toBe("Invalid Date");
  });

  it("throws when PROJECT_ROOT is missing or invalid", async () => {
    expect(() => listProjectFiles(undefined)).toThrow("PROJECT_ROOT is required");
    expect(() => listProjectFiles(join(tmpdir(), "missing-project-root"))).toThrow(
      "PROJECT_ROOT must be an existing directory",
    );

    const tool = createListProjectFilesTool();
    const originalProjectRoot = process.env.PROJECT_ROOT;
    delete process.env.PROJECT_ROOT;

    try {
      await expect(tool.handler()).rejects.toThrow("PROJECT_ROOT is required");
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });
});
