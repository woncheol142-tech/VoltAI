import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { createReadExcelTool, readExcel } from "../src/tools/readExcel.js";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-read-excel-"));
  tempRoots.push(root);
  return root;
}

function ensureProjectDirectory(root: string, relativePath: string): string {
  const parts = relativePath.split("/");
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("relativePath must include a file name");
  }

  const directory = join(root, ...parts);
  mkdirSync(directory, { recursive: true });

  return join(directory, fileName);
}

function writeProjectFile(root: string, relativePath: string, content: string): void {
  writeFileSync(ensureProjectDirectory(root, relativePath), content);
}

async function writeWorkbook(root: string, relativePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["Item", "Qty", "Unit"]);
  summary.addRow(["Cable", 10, "m"]);
  summary.addRow(["Panel", null, "ea"]);
  const notes = workbook.addWorksheet("Notes");
  notes.addRow(["Note"]);
  notes.addRow(["Check load"]);

  await workbook.xlsx.writeFile(ensureProjectDirectory(root, relativePath));
}

describe("readExcel", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns workbook sheet names", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "estimate/input.xlsx");

    const result = await readExcel(root, { relativePath: "estimate/input.xlsx" });

    expect(result).toEqual({
      relativePath: "estimate/input.xlsx",
      sheets: ["Summary", "Notes"],
    });
  });

  it("returns a specific sheet as JSON rows", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "estimate/input.xlsx");

    const result = await readExcel(root, {
      relativePath: "estimate/input.xlsx",
      sheetName: "Summary",
    });

    expect(result).toMatchObject({
      relativePath: "estimate/input.xlsx",
      sheets: ["Summary", "Notes"],
      sheetName: "Summary",
    });
    expect(result.rows).toEqual([
      ["Item", "Qty", "Unit"],
      ["Cable", 10, "m"],
      ["Panel", null, "ea"],
    ]);
    expect(result.totalRows).toBe(3);
  });

  it("limits returned rows with maxRows", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "estimate/input.xlsx");

    const result = await readExcel(root, {
      relativePath: "estimate/input.xlsx",
      sheetName: "Summary",
      maxRows: 2,
    });

    expect(result.rows).toEqual([
      ["Item", "Qty", "Unit"],
      ["Cable", 10, "m"],
    ]);
    expect(result.totalRows).toBe(3);
  });

  it("rejects absolute paths", async () => {
    const root = createTempProject();
    const absolutePath = join(root, "estimate/input.xlsx");
    expect(isAbsolute(absolutePath)).toBe(true);

    await expect(readExcel(root, { relativePath: absolutePath })).rejects.toThrow(
      "relativePath must be relative",
    );
  });

  it("rejects path traversal", async () => {
    const root = createTempProject();

    await expect(readExcel(root, { relativePath: "../secret.xlsx" })).rejects.toThrow(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("rejects symlinks that resolve outside PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    await writeWorkbook(outside, "secret.xlsx");
    symlinkSync(join(outside, "secret.xlsx"), join(root, "linked.xlsx"));

    await expect(readExcel(root, { relativePath: "linked.xlsx" })).rejects.toThrow(
      "relativePath must stay within PROJECT_ROOT",
    );
  });

  it("rejects unsupported extensions", async () => {
    const root = createTempProject();
    writeProjectFile(root, "estimate/input.csv", "Item,Qty");

    await expect(readExcel(root, { relativePath: "estimate/input.csv" })).rejects.toThrow(
      "Only .xlsx files are supported",
    );
  });

  it("rejects legacy .xls files with a clear unsupported policy", async () => {
    const root = createTempProject();
    writeProjectFile(root, "estimate/input.xls", "legacy binary excel placeholder");

    await expect(readExcel(root, { relativePath: "estimate/input.xls" })).rejects.toThrow(
      "Only .xlsx files are supported",
    );
  });

  it("rejects missing files", async () => {
    const root = createTempProject();

    await expect(readExcel(root, { relativePath: "estimate/missing.xlsx" })).rejects.toThrow(
      "Excel file does not exist",
    );
  });

  it("rejects hidden folders and node_modules paths", async () => {
    const root = createTempProject();
    await writeWorkbook(root, ".hidden/input.xlsx");
    await writeWorkbook(root, "node_modules/pkg/input.xlsx");

    await expect(readExcel(root, { relativePath: ".hidden/input.xlsx" })).rejects.toThrow(
      "relativePath cannot include hidden folders or node_modules",
    );
    await expect(
      readExcel(root, { relativePath: "node_modules/pkg/input.xlsx" }),
    ).rejects.toThrow("relativePath cannot include hidden folders or node_modules");
  });

  it("rejects missing sheets", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "estimate/input.xlsx");

    await expect(
      readExcel(root, {
        relativePath: "estimate/input.xlsx",
        sheetName: "Missing",
      }),
    ).rejects.toThrow("Sheet not found");
  });

  it("creates a read_excel tool that reads PROJECT_ROOT and returns JSON", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "estimate/input.xlsx");

    const originalProjectRoot = process.env.PROJECT_ROOT;
    process.env.PROJECT_ROOT = root;

    try {
      const tool = createReadExcelTool();
      const result = await tool.handler({
        relativePath: "estimate/input.xlsx",
        sheetName: "Summary",
        maxRows: 1,
      });

      expect(tool.name).toBe("read_excel");
      expect(result).toMatchObject({
        relativePath: "estimate/input.xlsx",
        sheets: ["Summary", "Notes"],
        sheetName: "Summary",
      });
      expect(result.rows).toEqual([["Item", "Qty", "Unit"]]);
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }
    }
  });
});
