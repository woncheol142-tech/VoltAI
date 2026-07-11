import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-excel-provenance-"));
  tempRoots.push(root);
  return root;
}

async function writeWorkbook(
  root: string,
  relativePath: string,
): Promise<void> {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  const catalog = workbook.addWorksheet("Catalog");
  catalog.addRow(["Item Code", "Name", "Price", "Manufacturer", "Reference"]);
  catalog.addRow([
    "CB-001",
    "XLPE Cable",
    { formula: "=12000", result: 12000 },
  ]);
  catalog.addRow([]);
  catalog.addRow([
    "CB-002",
    { richText: [{ text: "MCCB " }, { text: "Breaker" }] },
    85000,
    { error: "#N/A" },
    { text: "Catalog Link", hyperlink: "https://example.test/catalog" },
  ]);
  const notes = workbook.addWorksheet("Notes");
  notes.addRow(["Note"]);
  notes.addRow(["Do not index this sheet by default"]);

  await workbook.xlsx.writeFile(path);
}

async function loadReader() {
  return import("../src/tools/readExcel.js");
}

describe("readExcelSheetWithProvenance", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the first sheet by default and preserves actual non-empty workbook row indexes", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "catalogs/materials.xlsx");
    const { readExcelSheetWithProvenance } = await loadReader();

    await expect(
      readExcelSheetWithProvenance(root, {
        relativePath: "catalogs/materials.xlsx",
      }),
    ).resolves.toMatchObject({
      relativePath: "catalogs/materials.xlsx",
      sheetName: "Catalog",
      rows: [{ rowIndex: 1 }, { rowIndex: 2 }, { rowIndex: 4 }],
    });
  });

  it("selects an explicit sheet and rejects a missing sheet", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "catalogs/materials.xlsx");
    const { readExcelSheetWithProvenance } = await loadReader();

    await expect(
      readExcelSheetWithProvenance(root, {
        relativePath: "catalogs/materials.xlsx",
        sheetName: "Notes",
      }),
    ).resolves.toMatchObject({
      sheetName: "Notes",
      rows: [{ rowIndex: 1 }, { rowIndex: 2 }],
    });
    await expect(
      readExcelSheetWithProvenance(root, {
        relativePath: "catalogs/materials.xlsx",
        sheetName: "Missing",
      }),
    ).rejects.toThrow("Sheet not found");
  });

  it("normalizes formula, rich text, hyperlink, and error cells without object leakage", async () => {
    const root = createTempProject();
    await writeWorkbook(root, "catalogs/materials.xlsx");
    const { readExcelSheetWithProvenance } = await loadReader();

    const result = await readExcelSheetWithProvenance(root, {
      relativePath: "catalogs/materials.xlsx",
    });
    const formulaRow = result.rows.find(
      (row: { rowIndex: number }) => row.rowIndex === 2,
    );
    const richTextRow = result.rows.find(
      (row: { rowIndex: number }) => row.rowIndex === 4,
    );

    expect(formulaRow.values[2]).toBe(12000);
    expect(richTextRow.values).toEqual(
      expect.arrayContaining(["MCCB Breaker", "#N/A", "Catalog Link"]),
    );
    expect(JSON.stringify(result.rows)).not.toContain("[object Object]");
  });

  it.each([
    [
      "absolute",
      (root: string) => join(root, "catalogs/materials.xlsx"),
      "relativePath must be relative",
    ],
    [
      "traversal",
      () => "../materials.xlsx",
      "relativePath must stay within PROJECT_ROOT",
    ],
    [
      "non-xlsx",
      () => "catalogs/materials.xls",
      "Only .xlsx files are supported",
    ],
  ])(
    "preserves existing %s path safety",
    async (_name, createPath, message) => {
      const root = createTempProject();
      await writeWorkbook(root, "catalogs/materials.xlsx");
      const { readExcelSheetWithProvenance } = await loadReader();

      await expect(
        readExcelSheetWithProvenance(root, { relativePath: createPath(root) }),
      ).rejects.toThrow(message);
    },
  );

  it("rejects symlinks whose real path escapes PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    await writeWorkbook(outside, "materials.xlsx");
    symlinkSync(join(outside, "materials.xlsx"), join(root, "linked.xlsx"));
    const { readExcelSheetWithProvenance } = await loadReader();

    await expect(
      readExcelSheetWithProvenance(root, { relativePath: "linked.xlsx" }),
    ).rejects.toThrow("relativePath must stay within PROJECT_ROOT");
  });
});
