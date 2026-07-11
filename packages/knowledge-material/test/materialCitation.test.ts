import { describe, expect, it } from "vitest";

import { loadMaterialDomain } from "./helpers/materialFixtures.js";

const searchResult = {
  chunkId: "materials:catalogs/electrical.xlsx#sheet=Catalog#row=12",
  sourcePath: "catalogs/electrical.xlsx",
  sheetName: "Catalog",
  rowIndex: 12,
  catalogId: "CAT-ELEC-001",
  itemCode: "CB-001",
  name: "XLPE Cable",
  manufacturer: "Volt Electric",
  model: "X-100",
  category: "Cable",
  specification: "0.6/1kV 4C 25sq",
  unit: "m",
  unitPrice: 12000,
  currency: "KRW",
  text: "itemCode: CB-001\nname: XLPE Cable",
  similarity: 0.99,
};

describe("Material citation adapter", () => {
  it("converts MaterialSearchResult into a row-provenance citation", async () => {
    const { materialSearchResultToMaterialCitation } =
      await loadMaterialDomain();

    expect(materialSearchResultToMaterialCitation(searchResult)).toEqual({
      id: "material:materials:catalogs/electrical.xlsx#sheet=Catalog#row=12",
      sourceType: "material",
      catalogId: "CAT-ELEC-001",
      itemCode: "CB-001",
      name: "XLPE Cable",
      sourcePath: "catalogs/electrical.xlsx",
      sheetName: "Catalog",
      rowIndex: 12,
      excerpt: "itemCode: CB-001\nname: XLPE Cable",
    });
  });

  it("uses the actual SQLite chunk id as stable citation identity", async () => {
    const { materialSearchResultToMaterialCitation } =
      await loadMaterialDomain();
    const first = materialSearchResultToMaterialCitation(searchResult);
    const second = materialSearchResultToMaterialCitation({
      ...searchResult,
      text: "Different excerpt.",
      similarity: 0.1,
    });

    expect(first.id).toBe(`material:${searchResult.chunkId}`);
    expect(second.id).toBe(first.id);
  });

  it("round-trips MaterialCitation through KnowledgeCitation", async () => {
    const {
      materialCitationToKnowledgeCitation,
      materialSearchResultToMaterialCitation,
      knowledgeCitationToMaterialCitation,
    } = await loadMaterialDomain();
    const citation = materialSearchResultToMaterialCitation(searchResult);
    const generic = materialCitationToKnowledgeCitation(citation);

    expect(generic).toMatchObject({
      citationId: citation.id,
      sourceType: "knowledge",
      domain: "material",
      collection: "materials",
      documentId: "materials:catalogs/electrical.xlsx",
      sourcePath: citation.sourcePath,
      locator: { kind: "table", table: "Catalog", rowIndex: 12 },
      metadata: {
        catalogId: citation.catalogId,
        itemCode: citation.itemCode,
        name: citation.name,
      },
    });
    expect(knowledgeCitationToMaterialCitation(generic)).toEqual(citation);
  });

  it("does not mutate search results, citations, or generic citations", async () => {
    const {
      materialCitationToKnowledgeCitation,
      materialSearchResultToMaterialCitation,
      knowledgeCitationToMaterialCitation,
    } = await loadMaterialDomain();
    const resultSnapshot = structuredClone(searchResult);
    const citation = materialSearchResultToMaterialCitation(searchResult);
    const citationSnapshot = structuredClone(citation);
    const generic = materialCitationToKnowledgeCitation(citation);
    const genericSnapshot = structuredClone(generic);

    knowledgeCitationToMaterialCitation(generic);

    expect(searchResult).toEqual(resultSnapshot);
    expect(citation).toEqual(citationSnapshot);
    expect(generic).toEqual(genericSnapshot);
  });
});
