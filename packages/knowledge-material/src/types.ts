import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeMetadata,
  KnowledgeSearchResult,
  TableLocator,
} from "@voltai/knowledge-core";

export type MaterialKnowledgeMetadata = KnowledgeMetadata & {
  catalogId: string;
  itemCode: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  specification: string | null;
  unit: string | null;
  unitPrice: number | null;
  currency: string | null;
  revision: string | null;
  effectiveDate: string | null;
};

export type MaterialDocumentMetadata = KnowledgeMetadata & {
  catalogId: string;
  revision: string | null;
  effectiveDate: string | null;
};

export type MaterialColumnMap = {
  itemCode: string;
  name: string;
  manufacturer?: string;
  model?: string;
  category?: string;
  specification?: string;
  unit?: string;
  unitPrice?: string;
  currency?: string;
};

export type MaterialSheet = {
  relativePath: string;
  sheetName: string;
  rows: Array<{ rowIndex: number; values: unknown[] }>;
};

export type MaterialRow = MaterialKnowledgeMetadata & {
  rowIndex: number;
};

export type MaterialKnowledgeDocument = KnowledgeDocument<
  MaterialDocumentMetadata,
  { sheetName: string; rows: MaterialRow[] }
>;

export type MaterialKnowledgeChunk = KnowledgeChunk<MaterialKnowledgeMetadata, TableLocator>;

export type MaterialKnowledgeSearchResult = KnowledgeSearchResult<
  MaterialKnowledgeMetadata,
  TableLocator
>;

export type MaterialSearchResult = {
  chunkId: string;
  sourcePath: string;
  sheetName: string;
  rowIndex: number;
  catalogId: string;
  itemCode: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  category: string | null;
  specification: string | null;
  unit: string | null;
  unitPrice: number | null;
  currency: string | null;
  text: string;
  similarity: number;
};

export type MaterialCitation = {
  id: string;
  sourceType: "material";
  catalogId: string;
  itemCode: string;
  name: string;
  sourcePath: string;
  sheetName: string;
  rowIndex: number;
  excerpt: string;
};
