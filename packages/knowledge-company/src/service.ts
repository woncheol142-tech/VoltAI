import type {
  EmbeddedKnowledgeChunk,
  KnowledgeEmbeddingProvider,
  KnowledgeVectorStore,
  PageLocator,
} from "@voltai/knowledge-core";

import { createCompanyChunks, type CompanyChunkOptions } from "./chunk.js";
import { createCompanyKnowledgeDocument } from "./document.js";
import { companyKnowledgeCodecs, normalizeCompanyKnowledgeMetadata } from "./metadata.js";
import type {
  CompanyKnowledgeMetadata,
  CompanyPdfPage,
  CompanySearchResult,
} from "./types.js";

const companyCollection = "company";
const metadataMismatchError = "Company index embedding metadata mismatch. Please re-run index_company.";

export type IndexCompanyKnowledgeInput = {
  sourcePath: string;
  standardId: string;
  title: string;
  section?: string | null;
  revision?: string | null;
  effectiveDate?: string | null;
  department?: string | null;
} & CompanyChunkOptions;

export type IndexCompanyKnowledgeResult = {
  sourcePath: string;
  standardId: string;
  indexedChunks: number;
};

export type IndexCompanyKnowledgeDependencies = {
  readPdfPages: (sourcePath: string) => Promise<CompanyPdfPage[]>;
  embeddingProvider: KnowledgeEmbeddingProvider;
  vectorStore: Pick<KnowledgeVectorStore, "replaceSource">;
};

export type SearchCompanyKnowledgeInput = {
  query: string;
  topK?: number;
};

export type SearchCompanyKnowledgeDependencies = {
  embeddingProvider: KnowledgeEmbeddingProvider;
  vectorStore: Pick<KnowledgeVectorStore, "getIndexMetadata" | "search">;
};

function assertIndexInput(input: unknown): IndexCompanyKnowledgeInput {
  if (!input || typeof input !== "object") {
    throw new Error("Company index input is required");
  }

  const candidate = input as Partial<IndexCompanyKnowledgeInput>;
  if (typeof candidate.sourcePath !== "string" || candidate.sourcePath.length === 0) {
    throw new Error("sourcePath is required");
  }

  const metadata = normalizeCompanyKnowledgeMetadata(candidate);
  const chunkSize = candidate.chunkSize;
  const chunkOverlap = candidate.chunkOverlap;

  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize < 1)) {
    throw new Error("chunkSize must be a positive integer");
  }
  if (chunkOverlap !== undefined && (!Number.isInteger(chunkOverlap) || chunkOverlap < 0)) {
    throw new Error("chunkOverlap must be a non-negative integer");
  }

  return {
    sourcePath: candidate.sourcePath,
    ...metadata,
    chunkSize,
    chunkOverlap,
  };
}

function assertSearchInput(input: unknown): { query: string; topK: number } {
  if (!input || typeof input !== "object") {
    throw new Error("query is required");
  }

  const candidate = input as Partial<SearchCompanyKnowledgeInput>;
  if (typeof candidate.query !== "string" || candidate.query.trim().length === 0) {
    throw new Error("query is required");
  }
  if (candidate.topK !== undefined && (!Number.isInteger(candidate.topK) || candidate.topK < 1)) {
    throw new Error("topK must be a positive integer");
  }

  return { query: candidate.query, topK: candidate.topK ?? 5 };
}

export async function indexCompanyKnowledge(
  input: unknown,
  deps: IndexCompanyKnowledgeDependencies,
): Promise<IndexCompanyKnowledgeResult> {
  const indexInput = assertIndexInput(input);
  const pages = await deps.readPdfPages(indexInput.sourcePath);
  const document = createCompanyKnowledgeDocument({
    sourcePath: indexInput.sourcePath,
    pages,
    standardId: indexInput.standardId,
    title: indexInput.title,
    section: indexInput.section,
    revision: indexInput.revision,
    effectiveDate: indexInput.effectiveDate,
    department: indexInput.department,
  });
  const chunks = createCompanyChunks(document, indexInput);

  if (chunks.length === 0) {
    throw new Error("PDF text is empty or unavailable");
  }

  const embeddedChunks: EmbeddedKnowledgeChunk<CompanyKnowledgeMetadata, PageLocator>[] = [];
  for (const chunk of chunks) {
    embeddedChunks.push({
      ...chunk,
      embedding: await deps.embeddingProvider.embed(chunk.text),
    });
  }

  await deps.vectorStore.replaceSource(
    companyCollection,
    document.sourcePath,
    embeddedChunks,
    {
      embeddingProvider: deps.embeddingProvider.getMetadata().provider,
      embeddingModel: deps.embeddingProvider.getMetadata().model,
      dimensions: embeddedChunks[0].embedding.length,
      indexedAt: new Date().toISOString(),
    },
    companyKnowledgeCodecs,
  );

  return {
    sourcePath: document.sourcePath,
    standardId: document.metadata.standardId,
    indexedChunks: embeddedChunks.length,
  };
}

export async function searchCompanyKnowledge(
  input: unknown,
  deps: SearchCompanyKnowledgeDependencies,
): Promise<CompanySearchResult[]> {
  const { query, topK } = assertSearchInput(input);
  const embedding = await deps.embeddingProvider.embed(query);
  const providerMetadata = deps.embeddingProvider.getMetadata();
  const indexMetadata = await deps.vectorStore.getIndexMetadata(companyCollection);

  if (
    !indexMetadata ||
    indexMetadata.embeddingProvider !== providerMetadata.provider ||
    indexMetadata.embeddingModel !== providerMetadata.model ||
    indexMetadata.dimensions !== embedding.length
  ) {
    throw new Error(metadataMismatchError);
  }

  const results = await deps.vectorStore.search(
    companyCollection,
    embedding,
    topK,
    companyKnowledgeCodecs,
  );

  return results.map((result) => ({
    chunkId: result.chunkId,
    sourcePath: result.sourcePath,
    page: result.locator.page,
    standardId: result.metadata.standardId,
    title: result.metadata.title,
    section: result.metadata.section,
    text: result.text,
    similarity: result.similarity,
  }));
}
