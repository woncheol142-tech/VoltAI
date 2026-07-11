import { describe, expect, it } from "vitest";

import {
  loadMaterialDomain,
  materialInput,
  materialSheet,
} from "./helpers/materialFixtures.js";

async function createDocument(overrides: Record<string, unknown> = {}) {
  const { createMaterialKnowledgeDocument, mapMaterialRows } =
    await loadMaterialDomain();
  const input = materialInput(overrides);
  const sheet = materialSheet();
  const rows = mapMaterialRows(sheet, input);

  return createMaterialKnowledgeDocument(input, sheet, rows);
}

describe("Material row chunking", () => {
  it("preserves KnowledgeDocument identity and row provenance", async () => {
    const document = await createDocument();

    expect(document).toMatchObject({
      schemaVersion: 1,
      id: "materials:catalogs/electrical-materials.xlsx",
      collection: "materials",
      sourcePath: "catalogs/electrical-materials.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      metadata: { catalogId: "CAT-ELEC-001", revision: "A" },
    });
    expect(
      document.content.rows.map((row: { rowIndex: number }) => row.rowIndex),
    ).toEqual([2, 4]);
  });

  it("creates exactly one chunk per mapped material row", async () => {
    const { createMaterialChunks } = await loadMaterialDomain();
    const chunks = createMaterialChunks(await createDocument());

    expect(chunks).toHaveLength(2);
    expect(
      chunks.map((chunk: { chunkIndex: number }) => chunk.chunkIndex),
    ).toEqual([0, 1]);
  });

  it("uses the deterministic field order and excludes null fields", async () => {
    const { createMaterialChunks } = await loadMaterialDomain();
    const [, chunk] = createMaterialChunks(await createDocument());

    expect(chunk.text).toBe(
      "itemCode: BR-002\nname: MCCB Breaker\ncategory: Breaker\nspecification: 3P 100A\nunit: ea\nunitPrice: 85000\ncurrency: KRW",
    );
    expect(chunk.text).not.toContain("manufacturer:");
    expect(chunk.text).not.toContain("null");
  });

  it("uses a TableLocator with the source sheet and actual workbook row", async () => {
    const { createMaterialChunks } = await loadMaterialDomain();
    const [chunk] = createMaterialChunks(await createDocument());

    expect(chunk.locator).toEqual({
      kind: "table",
      table: "Catalog",
      rowIndex: 2,
    });
    expect(chunk.locator.kind).not.toBe("page");
  });

  it("uses stable document and chunk IDs for the same workbook rows", async () => {
    const { createMaterialChunks } = await loadMaterialDomain();
    const first = createMaterialChunks(await createDocument());
    const second = createMaterialChunks(await createDocument());

    expect(first.map((chunk: { chunkId: string }) => chunk.chunkId)).toEqual([
      "materials:catalogs/electrical-materials.xlsx#sheet=Catalog#row=2",
      "materials:catalogs/electrical-materials.xlsx#sheet=Catalog#row=4",
    ]);
    expect(second.map((chunk: { chunkId: string }) => chunk.chunkId)).toEqual(
      first.map((chunk: { chunkId: string }) => chunk.chunkId),
    );
  });

  it("normalizes CRLF and LF cell text into identical chunk text", async () => {
    const {
      createMaterialChunks,
      createMaterialKnowledgeDocument,
      mapMaterialRows,
    } = await loadMaterialDomain();
    const input = materialInput();
    const crlf = materialSheet();
    const lf = materialSheet();
    crlf.rows[1].values[5] = "0.6/1kV\r\n4C 25sq";
    lf.rows[1].values[5] = "0.6/1kV\n4C 25sq";

    const crlfDocument = createMaterialKnowledgeDocument(
      input,
      crlf,
      mapMaterialRows(crlf, input),
    );
    const lfDocument = createMaterialKnowledgeDocument(
      input,
      lf,
      mapMaterialRows(lf, input),
    );

    expect(createMaterialChunks(crlfDocument)[0].text).toBe(
      createMaterialChunks(lfDocument)[0].text,
    );
  });

  it("does not mutate the mapped document", async () => {
    const { createMaterialChunks } = await loadMaterialDomain();
    const document = await createDocument();
    const snapshot = structuredClone(document);

    createMaterialChunks(document);

    expect(document).toEqual(snapshot);
  });
});
