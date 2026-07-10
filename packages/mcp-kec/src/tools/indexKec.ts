import { join } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import { createPageChunks } from "../knowledge/chunk.js";
import { createEmbeddingProviderFromEnv, type EmbeddingProvider } from "../knowledge/embedding.js";
import { readPdfPages } from "../knowledge/pdfPages.js";
import { assertProjectRoot, resolveKecPdfPath } from "../knowledge/projectPath.js";
import { SqliteVectorStore } from "../knowledge/sqliteVectorStore.js";
import type { KnowledgeCollection, VectorStore } from "../knowledge/vectorStore.js";

const kecCollection: KnowledgeCollection = "kec";

export type IndexKecInput = {
  relativePath: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingConcurrency?: number;
  embeddingMaxAttempts?: number;
  embeddingRetryDelayMs?: number;
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

type EmbeddingExecutionOptions = {
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
};

const defaultEmbeddingConcurrency = 4;
const defaultEmbeddingMaxAttempts = 3;
const defaultEmbeddingRetryDelayMs = 100;

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

  if (
    candidate.embeddingConcurrency !== undefined &&
    (!Number.isInteger(candidate.embeddingConcurrency) || candidate.embeddingConcurrency < 1)
  ) {
    throw new Error("embeddingConcurrency must be a positive integer");
  }

  if (
    candidate.embeddingMaxAttempts !== undefined &&
    (!Number.isInteger(candidate.embeddingMaxAttempts) || candidate.embeddingMaxAttempts < 1)
  ) {
    throw new Error("embeddingMaxAttempts must be a positive integer");
  }

  if (
    candidate.embeddingRetryDelayMs !== undefined &&
    (!Number.isInteger(candidate.embeddingRetryDelayMs) || candidate.embeddingRetryDelayMs < 0)
  ) {
    throw new Error("embeddingRetryDelayMs must be a non-negative integer");
  }

  return {
    relativePath: candidate.relativePath,
    chunkSize: candidate.chunkSize,
    chunkOverlap: candidate.chunkOverlap,
    embeddingConcurrency: candidate.embeddingConcurrency,
    embeddingMaxAttempts: candidate.embeddingMaxAttempts,
    embeddingRetryDelayMs: candidate.embeddingRetryDelayMs,
  };
}

function createDefaultVectorStore(projectRoot: string): VectorStore {
  return new SqliteVectorStore(process.env.KEC_DB_PATH ?? join(projectRoot, ".voltai", "kec.sqlite"));
}

function parsePositiveIntegerEnv(name: string): number | undefined {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function parseNonNegativeIntegerEnv(name: string): number | undefined {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function resolveEmbeddingExecutionOptions(input: IndexKecInput): EmbeddingExecutionOptions {
  return {
    concurrency:
      input.embeddingConcurrency ??
      parsePositiveIntegerEnv("KEC_EMBED_CONCURRENCY") ??
      defaultEmbeddingConcurrency,
    maxAttempts:
      input.embeddingMaxAttempts ??
      parsePositiveIntegerEnv("KEC_EMBED_MAX_ATTEMPTS") ??
      defaultEmbeddingMaxAttempts,
    retryDelayMs:
      input.embeddingRetryDelayMs ??
      parseNonNegativeIntegerEnv("KEC_EMBED_RETRY_DELAY_MS") ??
      defaultEmbeddingRetryDelayMs,
  };
}

function delay(ms: number): Promise<void> {
  if (ms === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapWithConcurrencyAndRetry<T, R>(
  items: T[],
  options: EmbeddingExecutionOptions,
  task: (item: T, index: number, attempt: number) => Promise<R>,
  createFailureMessage: (item: T, index: number, attempts: number, error: unknown) => string,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runOne(item: T, index: number): Promise<R> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      try {
        return await task(item, index, attempt);
      } catch (error) {
        lastError = error;

        if (attempt < options.maxAttempts) {
          await delay(options.retryDelayMs);
        }
      }
    }

    throw new Error(createFailureMessage(item, index, options.maxAttempts, lastError));
  }

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runOne(items[index], index);
    }
  }

  const workerCount = Math.min(options.concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );

  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function indexKec(
  projectRoot: string | undefined,
  input: unknown,
  deps: IndexKecDependencies,
): Promise<IndexKecResult> {
  const root = assertProjectRoot(projectRoot);
  const indexInput = assertIndexKecInput(input);
  const { relativePath, chunkSize, chunkOverlap } = indexInput;
  const absolutePath = resolveKecPdfPath(root, relativePath);
  const pages = await readPdfPages(absolutePath);
  const chunks = createPageChunks(relativePath, pages, { chunkSize, chunkOverlap });

  if (chunks.length === 0) {
    throw new Error("PDF text is empty or unavailable");
  }

  const embeddingOptions = resolveEmbeddingExecutionOptions(indexInput);
  const embeddedChunks = await mapWithConcurrencyAndRetry(
    chunks,
    embeddingOptions,
    async (chunk) => ({
      ...chunk,
      embedding: await deps.embeddingProvider.embed(chunk.text),
    }),
    (chunk, _index, attempts, error) =>
      `Embedding failed for ${chunk.sourcePath} page ${chunk.page} chunk ${chunk.chunkIndex} after ${attempts} attempts: ${errorMessage(error)}`,
  );

  await deps.vectorStore.replaceSource(kecCollection, relativePath, embeddedChunks, {
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

export function createIndexKecTool(deps: IndexKecToolDependencies = {}): VoltAiTool<IndexKecResult> {
  return {
    name: "index_kec",
    description: "Index a KEC PDF into the local SQLite knowledge base.",
    inputSchema: {
      relativePath: z.string().min(1),
      chunkSize: z.number().int().positive().optional(),
      chunkOverlap: z.number().int().nonnegative().optional(),
      embeddingConcurrency: z.number().int().positive().optional(),
      embeddingMaxAttempts: z.number().int().positive().optional(),
      embeddingRetryDelayMs: z.number().int().nonnegative().optional(),
    },
    handler: async (input) => {
      const root = assertProjectRoot(process.env.PROJECT_ROOT);
      const vectorStore = deps.vectorStore ?? createDefaultVectorStore(root);

      try {
        const result = await indexKec(root, input, {
          embeddingProvider: deps.embeddingProvider ?? createEmbeddingProviderFromEnv(),
          vectorStore,
        });

        return result;
      } finally {
        if (!deps.vectorStore) {
          await vectorStore.close();
        }
      }
    },
  };
}
