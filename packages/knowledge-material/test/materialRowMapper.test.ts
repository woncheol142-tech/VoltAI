import { describe, expect, it } from "vitest";

import {
  loadMaterialDomain,
  materialInput,
  materialSheet,
} from "./helpers/materialFixtures.js";

describe("Material sheet row mapping", () => {
  it("maps English headers into material rows with actual workbook row indexes", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();

    const rows = mapMaterialRows(materialSheet(), materialInput());

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowIndex: 2,
      itemCode: "CB-001",
      name: "XLPE Cable",
      unitPrice: 12000,
    });
    expect(rows[1]).toMatchObject({ rowIndex: 4, itemCode: "BR-002" });
  });

  it("maps Korean headers through an explicit column map", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows[0].values = ["자재코드", "품명", "제조사", "단가"];
    sheet.rows[1].values = ["CB-001", "XLPE Cable", "Volt Electric", 12000];
    sheet.rows = sheet.rows.slice(0, 2);

    expect(
      mapMaterialRows(
        sheet,
        materialInput({
          columnMap: {
            itemCode: "자재코드",
            name: "품명",
            manufacturer: "제조사",
            unitPrice: "단가",
          },
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        rowIndex: 2,
        itemCode: "CB-001",
        name: "XLPE Cable",
        manufacturer: "Volt Electric",
        unitPrice: 12000,
      }),
    ]);
  });

  it("matches headers after NFKC, whitespace, and case normalization", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows[0].values[0] = " Ｉｔｅｍ   Ｃｏｄｅ ";
    sheet.rows[0].values[1] = "  NAME ";

    expect(mapMaterialRows(sheet, materialInput())).toHaveLength(2);
  });

  it("uses headerRow when a catalog has leading title rows", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows.unshift({
      rowIndex: 1,
      values: ["Electrical Material Catalog"],
    });
    sheet.rows = sheet.rows.map((row, index) => ({
      ...row,
      rowIndex: index + 1,
    }));

    expect(
      mapMaterialRows(sheet, materialInput({ headerRow: 2 })).map(
        (row: { rowIndex: number }) => row.rowIndex,
      ),
    ).toEqual([3, 5]);
  });

  it("rejects missing required mapped headers and duplicate normalized headers", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const missing = materialSheet();
    missing.rows[0].values = ["Item Code", "Manufacturer"];

    expect(() => mapMaterialRows(missing, materialInput())).toThrow(/Name/);

    const duplicate = materialSheet();
    duplicate.rows[0].values[1] = " item   code ";

    expect(() => mapMaterialRows(duplicate, materialInput())).toThrow(
      /duplicate/i,
    );
  });

  it("skips fully blank rows and rows whose mapped required fields are both blank", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows.splice(2, 0, {
      rowIndex: 3,
      values: [null, null, "Note only", null, null, null, null, null, null],
    });

    expect(
      mapMaterialRows(sheet, materialInput()).map(
        (row: { rowIndex: number }) => row.rowIndex,
      ),
    ).toEqual([2, 4]);
  });

  it("fails a row with only one required mapped value", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows[1].values[1] = null;

    expect(() => mapMaterialRows(sheet, materialInput())).toThrow(
      /row 2.*name/i,
    );
  });

  it("normalizes formula, rich text, hyperlink, and error cell values deterministically", async () => {
    const { normalizeMaterialCell } = await loadMaterialDomain();

    expect(normalizeMaterialCell({ formula: "=12000", result: 12000 })).toBe(
      12000,
    );
    expect(
      normalizeMaterialCell({
        richText: [{ text: "XLPE " }, { text: "Cable" }],
      }),
    ).toBe("XLPE Cable");
    expect(
      normalizeMaterialCell({
        text: "Catalog Cable",
        hyperlink: "https://example.test",
      }),
    ).toBe("Catalog Cable");
    expect(normalizeMaterialCell({ error: "#N/A" })).toBe("#N/A");
    expect(normalizeMaterialCell(new Date("2026-07-01T00:00:00.000Z"))).toBe(
      "2026-07-01",
    );
  });

  it("fails when a required field contains an Excel error cell", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows[1].values[0] = { error: "#N/A" };

    expect(() => mapMaterialRows(sheet, materialInput())).toThrow(
      /row 2.*itemCode.*error/i,
    );
  });

  it("keeps nullable error cells as display codes without object stringification", async () => {
    const {
      createMaterialChunks,
      createMaterialKnowledgeDocument,
      mapMaterialRows,
    } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows[1].values[2] = { error: "#N/A" };
    const input = materialInput();
    const rows = mapMaterialRows(sheet, input);
    const document = createMaterialKnowledgeDocument(input, sheet, rows);
    const [chunk] = createMaterialChunks(document);

    expect(rows[0].manufacturer).toBe("#N/A");
    expect(chunk.text).toContain("manufacturer: #N/A");
    expect(chunk.text).not.toContain("[object Object]");
  });

  it("rejects non-numeric unitPrice input instead of coercing mixed text", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    sheet.rows[1].values[7] = "12,000 KRW";

    expect(() => mapMaterialRows(sheet, materialInput())).toThrow(
      /row 2.*unitPrice/i,
    );
  });

  it("does not mutate source sheet rows or mapping input", async () => {
    const { mapMaterialRows } = await loadMaterialDomain();
    const sheet = materialSheet();
    const input = materialInput();
    const sheetSnapshot = structuredClone(sheet);
    const inputSnapshot = structuredClone(input);

    mapMaterialRows(sheet, input);

    expect(sheet).toEqual(sheetSnapshot);
    expect(input).toEqual(inputSnapshot);
  });
});
