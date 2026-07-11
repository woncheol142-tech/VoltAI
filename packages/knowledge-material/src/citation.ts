import type { KnowledgeCitation, TableLocator } from "@voltai/knowledge-core";

import type { MaterialCitation, MaterialSearchResult } from "./types.js";

type MaterialCitationMetadata = {
  catalogId: string;
  itemCode: string;
  name: string;
};

export function materialSearchResultToMaterialCitation(
  result: MaterialSearchResult,
): MaterialCitation {
  return {
    id: `material:${result.chunkId}`,
    sourceType: "material",
    catalogId: result.catalogId,
    itemCode: result.itemCode,
    name: result.name,
    sourcePath: result.sourcePath,
    sheetName: result.sheetName,
    rowIndex: result.rowIndex,
    excerpt: result.text,
  };
}

export function materialCitationToKnowledgeCitation(
  citation: MaterialCitation,
): KnowledgeCitation<"material", MaterialCitationMetadata, TableLocator> {
  return {
    citationId: citation.id,
    sourceType: "knowledge",
    domain: "material",
    collection: "materials",
    documentId: `materials:${citation.sourcePath}`,
    sourcePath: citation.sourcePath,
    locator: { kind: "table", table: citation.sheetName, rowIndex: citation.rowIndex },
    label: `${citation.itemCode}: ${citation.name}`,
    excerpt: citation.excerpt,
    metadata: {
      catalogId: citation.catalogId,
      itemCode: citation.itemCode,
      name: citation.name,
    },
  };
}

export function knowledgeCitationToMaterialCitation(
  citation: KnowledgeCitation<"material", MaterialCitationMetadata, TableLocator>,
): MaterialCitation {
  return {
    id: citation.citationId,
    sourceType: "material",
    catalogId: citation.metadata.catalogId,
    itemCode: citation.metadata.itemCode,
    name: citation.metadata.name,
    sourcePath: citation.sourcePath,
    sheetName: citation.locator.table,
    rowIndex: citation.locator.rowIndex as number,
    excerpt: citation.excerpt,
  };
}
