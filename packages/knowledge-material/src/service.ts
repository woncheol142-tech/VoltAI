import type {
  EmbeddedKnowledgeChunk,
  KnowledgeEmbeddingProvider,
  KnowledgeVectorStore,
  TableLocator,
} from "@voltai/knowledge-core";

import { createMaterialChunks } from "./chunk.js";
import { createMaterialKnowledgeDocument } from "./document.js";
import { materialKnowledgeCodecs } from "./metadata.js";
import { mapMaterialRows } from "./rowMapper.js";
import type {
  MaterialColumnMap,
  MaterialKnowledgeMetadata,
  MaterialSearchResult,
  MaterialSheet,
} from "./types.js";

const materialsCollection = "materials";
const metadataMismatchError = "Material index embedding metadata mismatch. Please re-run index_material.";

export type IndexMaterialKnowledgeInput = {
  sourcePath: string;
  catalogId: string;
  sheetName?: string;
  headerRow?: number;
  columnMap: MaterialColumnMap;
  revision?: string | null;
  effectiveDate?: string | null;
};

export type IndexMaterialKnowledgeResult = {
  sourcePath: string;
  catalogId: string;
  sheetName: string;
  indexedRows: number;
};

export type IndexMaterialKnowledgeDependencies = {
  readMaterialSheet: (sourcePath: string, sheetName?: string) => Promise<MaterialSheet>;
  embeddingProvider: KnowledgeEmbeddingProvider;
  vectorStore: Pick<KnowledgeVectorStore, "replaceSource">;
};

export type SearchMaterialKnowledgeInput = {
  query: string;
  topK?: number;
};

export type SearchMaterialKnowledgeDependencies = {
  embeddingProvider: KnowledgeEmbeddingProvider;
  vectorStore: Pick<KnowledgeVectorStore, "getIndexMetadata" | "search">;
};

function assertIndexInput(input: unknown): IndexMaterialKnowledgeInput {
  if (!input || typeof input !== "object") {
    throw new Error("Material index input is required");
  }

  const candidate = input as Partial<IndexMaterialKnowledgeInput>;
  if (typeof candidate.sourcePath !== "string" || candidate.sourcePath.length === 0) {
    throw new Error("sourcePath is required");
  }
  if (typeof candidate.catalogId !== "string" || candidate.catalogId.trim().length === 0) {
    throw new Error("catalogId is required");
  }
  if (!candidate.columnMap || typeof candidate.columnMap !== "object") {
    throw new Error("columnMap is required");
  }
  if (typeof candidate.columnMap.itemCode !== "string" || typeof candidate.columnMap.name !== "string") {
    throw new Error("columnMap itemCode and name are required");
  }
  if (
    candidate.headerRow !== undefined &&
    (!Number.isInteger(candidate.headerRow) || candidate.headerRow < 1)
  ) {
    throw new Error("headerRow must be a positive integer");
  }

  return {
    sourcePath: candidate.sourcePath,
    catalogId: candidate.catalogId,
    sheetName: candidate.sheetName,
    headerRow: candidate.headerRow,
    columnMap: { ...candidate.columnMap },
    revision: candidate.revision,
    effectiveDate: candidate.effectiveDate,
  };
}

function assertSearchInput(input: unknown): { query: string; topK: number } {
  if (!input || typeof input !== "object") {
    throw new Error("query is required");
  }

  const candidate = input as Partial<SearchMaterialKnowledgeInput>;
  if (typeof candidate.query !== "string" || candidate.query.trim().length === 0) {
    throw new Error("query is required");
  }
  if (candidate.topK !== undefined && (!Number.isInteger(candidate.topK) || candidate.topK < 1)) {
    throw new Error("topK must be a positive integer");
  }

  return { query: candidate.query, topK: candidate.topK ?? 5 };
}

export async function indexMaterialKnowledge(
  input: unknown,
  deps: IndexMaterialKnowledgeDependencies,
): Promise<IndexMaterialKnowledgeResult> {
  const indexInput = assertIndexInput(input);
  const sheet = await deps.readMaterialSheet(indexInput.sourcePath, indexInput.sheetName);
  const rows = mapMaterialRows(sheet, indexInput);
  const document = createMaterialKnowledgeDocument(indexInput, sheet, rows);
  const chunks = createMaterialChunks(document);

  if (chunks.length === 0) {
    throw new Error("Excel sheet contains no indexable material rows");
  }

  const embeddedChunks: EmbeddedKnowledgeChunk<MaterialKnowledgeMetadata, TableLocator>[] = [];
  for (const chunk of chunks) {
    embeddedChunks.push({
      ...chunk,
      embedding: await deps.embeddingProvider.embed(chunk.text),
    });
  }

  await deps.vectorStore.replaceSource(
    materialsCollection,
    document.sourcePath,
    embeddedChunks,
    {
      embeddingProvider: deps.embeddingProvider.getMetadata().provider,
      embeddingModel: deps.embeddingProvider.getMetadata().model,
      dimensions: embeddedChunks[0].embedding.length,
      indexedAt: new Date().toISOString(),
    },
    materialKnowledgeCodecs,
  );

  return {
    sourcePath: document.sourcePath,
    catalogId: document.metadata.catalogId,
    sheetName: document.content.sheetName,
    indexedRows: embeddedChunks.length,
  };
}

export async function searchMaterialKnowledge(
  input: unknown,
  deps: SearchMaterialKnowledgeDependencies,
): Promise<MaterialSearchResult[]> {
  const { query, topK } = assertSearchInput(input);
  const embedding = await deps.embeddingProvider.embed(query);
  const providerMetadata = deps.embeddingProvider.getMetadata();
  const indexMetadata = await deps.vectorStore.getIndexMetadata(materialsCollection);

  if (
    !indexMetadata ||
    indexMetadata.embeddingProvider !== providerMetadata.provider ||
    indexMetadata.embeddingModel !== providerMetadata.model ||
    indexMetadata.dimensions !== embedding.length
  ) {
    throw new Error(metadataMismatchError);
  }

  const results = await deps.vectorStore.search(
    materialsCollection,
    embedding,
    topK,
    materialKnowledgeCodecs,
  );

  return results.map((result) => ({
    chunkId: result.chunkId,
    sourcePath: result.sourcePath,
    sheetName: result.locator.table,
    rowIndex: result.locator.rowIndex as number,
    catalogId: result.metadata.catalogId,
    itemCode: result.metadata.itemCode,
    name: result.metadata.name,
    manufacturer: result.metadata.manufacturer,
    model: result.metadata.model,
    category: result.metadata.category,
    specification: result.metadata.specification,
    unit: result.metadata.unit,
    unitPrice: result.metadata.unitPrice,
    currency: result.metadata.currency,
    text: result.text,
    similarity: result.similarity,
  }));
}
