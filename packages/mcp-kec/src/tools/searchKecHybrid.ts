import { join } from "node:path";

import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";
import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import {
  createEmbeddingProviderFromEnv,
  type EmbeddingProvider,
} from "../knowledge/embedding.js";
import { assertProjectRoot } from "../knowledge/projectPath.js";
import { searchKecHybrid } from "../searchEntryPoints/index.js";
import type { KecSearchRequest } from "../searchFoundation/index.js";
import type { KecHybridSearchResult } from "../searchHybrid/index.js";
import type { KecWeightedRankingOptions } from "../searchRanking/index.js";

export type SearchKecHybridInput = Readonly<{
  query: string;
  limit: number;
}>;

export type SearchKecHybridToolDependencies = Readonly<{
  rankingOptions: KecWeightedRankingOptions;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: Pick<
    KnowledgeVectorStore,
    "getIndexMetadata" | "search" | "listChunks"
  >;
}>;

export type SearchKecHybridToolResult = Readonly<{
  results: KecHybridSearchResult;
}>;

export const SearchKecHybridInput =
  undefined as unknown as SearchKecHybridInput;
export const SearchKecHybridToolDependencies =
  undefined as unknown as SearchKecHybridToolDependencies;
export const SearchKecHybridToolResult =
  undefined as unknown as SearchKecHybridToolResult;

function createDefaultVectorStore(): SqliteKnowledgeStore {
  const dbPath =
    process.env.KEC_DB_PATH ??
    join(assertProjectRoot(process.env.PROJECT_ROOT), ".voltai", "kec.sqlite");

  return new SqliteKnowledgeStore(dbPath);
}

export function createSearchKecHybridTool(
  dependencies: SearchKecHybridToolDependencies,
): VoltAiTool<SearchKecHybridToolResult> {
  return {
    name: "search_kec_hybrid",
    description:
      "Search KEC content with native semantic and lexical hybrid retrieval.",
    inputSchema: {
      query: z.string().min(1).max(4096),
      limit: z.number().int().min(0).max(100),
    },
    handler: async (input) => {
      let ownedStore: SqliteKnowledgeStore | undefined;
      let result!: KecHybridSearchResult;
      let primaryError: unknown;
      let hasPrimaryError = false;

      try {
        const vectorStore =
          dependencies.vectorStore ?? (ownedStore = createDefaultVectorStore());
        const embeddingProvider =
          dependencies.embeddingProvider ?? createEmbeddingProviderFromEnv();

        result = await searchKecHybrid(
          input as KecSearchRequest,
          {
            embeddingProvider,
            vectorStore,
          },
          dependencies.rankingOptions,
        );
      } catch (error) {
        primaryError = error;
        hasPrimaryError = true;
      }

      let cleanupError: unknown;
      let hasCleanupError = false;

      if (ownedStore) {
        try {
          await ownedStore.close();
        } catch (error) {
          cleanupError = error;
          hasCleanupError = true;
        }
      }

      if (hasPrimaryError) {
        throw primaryError;
      }

      if (hasCleanupError) {
        throw cleanupError;
      }

      return { results: result };
    },
  };
}
