import type { KnowledgeDocument } from "@voltai/knowledge-core";

import type {
  MaterialDocumentMetadata,
  MaterialKnowledgeDocument,
  MaterialRow,
  MaterialSheet,
} from "./types.js";

function normalizeSourcePath(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

export function createMaterialKnowledgeDocument(
  input: {
    sourcePath: string;
    catalogId: string;
    revision?: string | null;
    effectiveDate?: string | null;
  },
  sheet: MaterialSheet,
  rows: MaterialRow[],
): MaterialKnowledgeDocument {
  if (typeof input.sourcePath !== "string" || input.sourcePath.length === 0) {
    throw new Error("sourcePath is required");
  }
  if (typeof input.catalogId !== "string" || input.catalogId.trim().length === 0) {
    throw new Error("catalogId is required");
  }
  if (
    input.effectiveDate !== undefined &&
    input.effectiveDate !== null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)
  ) {
    throw new Error("effectiveDate must use YYYY-MM-DD");
  }

  const sourcePath = normalizeSourcePath(input.sourcePath);
  const metadata: MaterialDocumentMetadata = {
    catalogId: input.catalogId,
    revision: input.revision ?? null,
    effectiveDate: input.effectiveDate ?? null,
  };
  const document: KnowledgeDocument<MaterialDocumentMetadata, { sheetName: string; rows: MaterialRow[] }> = {
    schemaVersion: 1,
    id: `materials:${sourcePath}`,
    collection: "materials",
    sourcePath,
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content: {
      sheetName: sheet.sheetName,
      rows: rows.map((row) => ({ ...row })),
    },
    metadata,
  };

  return document;
}
