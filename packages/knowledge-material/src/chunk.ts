import type { TableLocator } from "@voltai/knowledge-core";

import type { MaterialKnowledgeChunk, MaterialKnowledgeDocument, MaterialRow } from "./types.js";

const textFields = [
  "itemCode",
  "name",
  "manufacturer",
  "model",
  "category",
  "specification",
  "unit",
  "unitPrice",
  "currency",
] as const;

function normalizeTextValue(value: string | number): string {
  return String(value).replace(/\r\n?/g, "\n");
}

function createChunkText(row: MaterialRow): string {
  return textFields
    .flatMap((field) => {
      const value = row[field];
      return value === null ? [] : [`${field}: ${normalizeTextValue(value)}`];
    })
    .join("\n");
}

export function createMaterialChunks(document: MaterialKnowledgeDocument): MaterialKnowledgeChunk[] {
  return document.content.rows.map((row, chunkIndex) => {
    const locator: TableLocator = {
      kind: "table",
      table: document.content.sheetName,
      rowIndex: row.rowIndex,
    };

    return {
      chunkId: `${document.id}#sheet=${document.content.sheetName}#row=${row.rowIndex}`,
      documentId: document.id,
      sourcePath: document.sourcePath,
      chunkIndex,
      locator,
      metadata: {
        catalogId: row.catalogId,
        itemCode: row.itemCode,
        name: row.name,
        manufacturer: row.manufacturer,
        model: row.model,
        category: row.category,
        specification: row.specification,
        unit: row.unit,
        unitPrice: row.unitPrice,
        currency: row.currency,
        revision: row.revision,
        effectiveDate: row.effectiveDate,
      },
      text: createChunkText(row),
    };
  });
}
