import { describe, expect, it } from "vitest";

import { loadMaterialDomain } from "./helpers/materialFixtures.js";

describe("Material knowledge metadata", () => {
  it("round-trips complete metadata through the provider-local codec", async () => {
    const { materialKnowledgeMetadataCodec } = await loadMaterialDomain();
    const metadata = {
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
      revision: "A",
      effectiveDate: "2026-07-01",
    };

    expect(
      materialKnowledgeMetadataCodec.decode(
        materialKnowledgeMetadataCodec.encode(metadata),
      ),
    ).toEqual(metadata);
  });

  it.each([
    ["catalogId", { catalogId: "", itemCode: "CB-1", name: "Cable" }],
    ["itemCode", { catalogId: "CAT-1", itemCode: "   ", name: "Cable" }],
    ["name", { catalogId: "CAT-1", itemCode: "CB-1", name: "" }],
  ])("rejects an empty required %s", async (_field, input) => {
    const { normalizeMaterialKnowledgeMetadata } = await loadMaterialDomain();

    expect(() => normalizeMaterialKnowledgeMetadata(input)).toThrow();
  });

  it("normalizes optional metadata to null without mutating input", async () => {
    const { normalizeMaterialKnowledgeMetadata } = await loadMaterialDomain();
    const input = { catalogId: "CAT-1", itemCode: "CB-1", name: "Cable" };
    const snapshot = structuredClone(input);

    expect(normalizeMaterialKnowledgeMetadata(input)).toEqual({
      catalogId: "CAT-1",
      itemCode: "CB-1",
      name: "Cable",
      manufacturer: null,
      model: null,
      category: null,
      specification: null,
      unit: null,
      unitPrice: null,
      currency: null,
      revision: null,
      effectiveDate: null,
    });
    expect(input).toEqual(snapshot);
  });

  it("rejects invalid effectiveDate and unitPrice values", async () => {
    const { normalizeMaterialKnowledgeMetadata } = await loadMaterialDomain();

    expect(() =>
      normalizeMaterialKnowledgeMetadata({
        catalogId: "CAT-1",
        itemCode: "CB-1",
        name: "Cable",
        effectiveDate: "2026/07/01",
      }),
    ).toThrow();
    expect(() =>
      normalizeMaterialKnowledgeMetadata({
        catalogId: "CAT-1",
        itemCode: "CB-1",
        name: "Cable",
        unitPrice: -1,
      }),
    ).toThrow();
    expect(() =>
      normalizeMaterialKnowledgeMetadata({
        catalogId: "CAT-1",
        itemCode: "CB-1",
        name: "Cable",
        unitPrice: Number.NaN,
      }),
    ).toThrow();
  });

  it("rejects persisted metadata that omits nullable fields", async () => {
    const { materialKnowledgeMetadataCodec } = await loadMaterialDomain();

    expect(() =>
      materialKnowledgeMetadataCodec.decode({
        catalogId: "CAT-1",
        itemCode: "CB-1",
        name: "Cable",
      }),
    ).toThrow();
  });

  it("accepts only a TableLocator with a positive workbook row index", async () => {
    const { materialTableLocatorCodec } = await loadMaterialDomain();

    expect(
      materialTableLocatorCodec.decode({
        kind: "table",
        table: "Catalog",
        rowIndex: 2,
      }),
    ).toEqual({ kind: "table", table: "Catalog", rowIndex: 2 });
    expect(() =>
      materialTableLocatorCodec.decode({
        kind: "table",
        table: "Catalog",
        rowIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      materialTableLocatorCodec.decode({ kind: "page", page: 1 }),
    ).toThrow();
  });
});
