import { join } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import { createPageChunks } from "../knowledge/chunk.js";
import { createEmbeddingProviderFromEnv, type EmbeddingProvider } from "../knowledge/embedding.js";
import { readPdfPages } from "../knowledge/pdfPages.js";
import { assertProjectRoot, resolveKecPdfPath } from "../knowledge/projectPath.js";
import { SqliteVectorStore } from "../knowledge/sqliteVectorStore.js";
import type { VectorStore } from "../knowledge/vectorStore.js";

export type IndexKecInput = {
  relativePath: string;
  chunkSize?: number;
  chunkOverlap?: number;
};

export type IndexKecResult = {
  relativePath: string;
  indexedChunks: number;
};

export type IndexKecDependencies = {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
};

export type IndexKecToolDependencies = {
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
};

function assertIndexKecInput(input: unknown): IndexKecInput {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<IndexKecInput>;

  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }

  if (
    candidate.chunkSize !== undefined &&
    (!Number.isInteger(candidate.chunkSize) || candidate.chunkSize < 1)
  ) {
    throw new Error("chunkSize must be a positive integer");
  }

  if (
    candidate.chunkOverlap !== undefined &&
    (!Number.isInteger(candidate.chunkOverlap) || candidate.chunkOverlap < 0)
  ) {
    throw new Error("chunkOverlap must be a non-negative integer");
  }

  return {
    relativePath: candidate.relativePath,
    chunkSize: candidate.chunkSize,
    chunkOverlap: candidate.chunkOverlap,
  };
}

function createDefaultVectorStore(projectRoot: string): VectorStore {
  return new SqliteVectorStore(process.env.KEC_DB_PATH ?? join(projectRoot, ".voltai", "kec.sqlite"));
}

export async function indexKec(
  projectRoot: string | undefined,
  input: unknown,
  deps: IndexKecDependencies,
): Promise<IndexKecResult> {
  const root = assertProjectRoot(projectRoot);
  const { relativePath, chunkSize, chunkOverlap } = assertIndexKecInput(input);
  const absolutePath = resolveKecPdfPath(root, relativePath);
  const pages = await readPdfPages(absolutePath);
  const chunks = createPageChunks(relativePath, pages, { chunkSize, chunkOverlap });

  if (chunks.length === 0) {
    throw new Error("PDF text is empty or unavailable");
  }

  const embeddedChunks = await Promise.all(
    chunks.map(async (chunk) => ({
      ...chunk,
      embedding: await deps.embeddingProvider.embed(chunk.text),
    })),
  );

  await deps.vectorStore.upsert(embeddedChunks);

  await deps.vectorStore.saveIndexMetadata({
    embeddingProvider: deps.embeddingProvider.getMetadata().provider,
    embeddingModel: deps.embeddingProvider.getMetadata().model,
    dimensions: embeddedChunks[0].embedding.length,
    indexedAt: new Date().toISOString(),
  });

  return {
    relativePath,
    indexedChunks: embeddedChunks.length,
  };
}

export function createIndexKecTool(deps: IndexKecToolDependencies = {}): VoltAiTool {
  return {
    name: "index_kec",
    description: "Index a KEC PDF into the local SQLite knowledge base.",
    inputSchema: {
      relativePath: z.string().min(1),
      chunkSize: z.number().int().positive().optional(),
      chunkOverlap: z.number().int().nonnegative().optional(),
    },
    handler: async (input) => {
      const root = assertProjectRoot(process.env.PROJECT_ROOT);
      const result = await indexKec(root, input, {
        embeddingProvider: deps.embeddingProvider ?? createEmbeddingProviderFromEnv(),
        vectorStore: deps.vectorStore ?? createDefaultVectorStore(root),
      });

      return JSON.stringify(result);
    },
  };
}
