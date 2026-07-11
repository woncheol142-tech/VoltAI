import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeMetadata,
  KnowledgeSearchResult,
  PageLocator,
} from "@voltai/knowledge-core";

export type CompanyKnowledgeMetadata = KnowledgeMetadata & {
  standardId: string;
  title: string;
  section: string | null;
  revision: string | null;
  effectiveDate: string | null;
  department: string | null;
};

export type CompanyPdfPage = {
  page: number;
  text: string;
};

export type CompanyKnowledgeDocument = KnowledgeDocument<
  CompanyKnowledgeMetadata,
  { pages: CompanyPdfPage[] }
>;

export type CompanyKnowledgeChunk = KnowledgeChunk<CompanyKnowledgeMetadata, PageLocator>;

export type CompanyKnowledgeSearchResult = KnowledgeSearchResult<
  CompanyKnowledgeMetadata,
  PageLocator
>;

export type CompanySearchResult = {
  chunkId: string;
  sourcePath: string;
  page: number;
  standardId: string;
  title: string;
  section: string | null;
  text: string;
  similarity: number;
};

export type CompanyCitation = {
  id: string;
  sourceType: "company";
  standardId: string;
  title: string;
  section: string | null;
  sourcePath: string;
  page: number;
  excerpt: string;
};
