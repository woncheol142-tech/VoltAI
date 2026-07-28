import { join } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import {
  createEmbeddingProviderFromEnv,
  type EmbeddingProvider,
} from "../knowledge/embedding.js";
import { assertProjectRoot } from "../knowledge/projectPath.js";
import { SqliteVectorStore } from "../knowledge/sqliteVectorStore.js";
import type {
  KecSearchResult,
  KnowledgeCollection,
  VectorStore,
} from "../knowledge/vectorStore.js";
import { executeKecSemanticSearch } from "../searchSemantic/semanticSearchCore.js";

const kecCollection: KnowledgeCollection = "kec";

export type SearchKecInput = {
  question?: string;
  query?: string;
  topK?: number;
};

export type SearchKecDependencies = {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
};

export type SearchKecToolDependencies = {
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
};

export type SearchKecToolResult = {
  results: KecSearchResult[];
};

function assertSearchKecInput(input: unknown): {
  question: string;
  topK: number;
} {
  if (!input || typeof input !== "object") {
    throw new Error("query is required");
  }

  const candidate = input as Partial<SearchKecInput>;

  const question = candidate.query ?? candidate.question;

  if (typeof question !== "string" || question.length === 0) {
    throw new Error("query is required");
  }

  if (
    candidate.topK !== undefined &&
    (!Number.isInteger(candidate.topK) || candidate.topK < 1)
  ) {
    throw new Error("topK must be a positive integer");
  }

  return {
    question,
    topK: candidate.topK ?? 5,
  };
}

function createDefaultVectorStore(projectRoot: string): VectorStore {
  return new SqliteVectorStore(
    process.env.KEC_DB_PATH ?? join(projectRoot, ".voltai", "kec.sqlite"),
  );
}

export async function searchKec(
  input: unknown,
  deps: SearchKecDependencies,
): Promise<KecSearchResult[]> {
  const { question, topK } = assertSearchKecInput(input);

  return executeKecSemanticSearch(question, topK, {
    embeddingProvider: deps.embeddingProvider,
    getIndexMetadata: () => deps.vectorStore.getIndexMetadata(kecCollection),
    search: (embedding, limit) =>
      deps.vectorStore.search(kecCollection, embedding, limit),
  });
}

export function createSearchKecTool(
  deps: SearchKecToolDependencies = {},
): VoltAiTool<SearchKecToolResult> {
  return {
    name: "search_kec",
    description:
      "Search indexed KEC chunks from the local SQLite knowledge base.",
    inputSchema: {
      query: z.string().min(1),
      topK: z.number().int().positive().optional(),
    },
    handler: async (input) => {
      const root = assertProjectRoot(process.env.PROJECT_ROOT);
      const vectorStore = deps.vectorStore ?? createDefaultVectorStore(root);

      try {
        const results = await searchKec(input, {
          embeddingProvider:
            deps.embeddingProvider ?? createEmbeddingProviderFromEnv(),
          vectorStore,
        });

        return { results };
      } finally {
        if (!deps.vectorStore) {
          await vectorStore.close();
        }
      }
    },
  };
}
