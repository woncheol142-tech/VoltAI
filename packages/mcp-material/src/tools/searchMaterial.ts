import type { KnowledgeEmbeddingProvider, KnowledgeVectorStore } from "@voltai/knowledge-core";
import { searchMaterialKnowledge, type MaterialSearchResult } from "@voltai/knowledge-material";
import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";
import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import {
  createMaterialEmbeddingProviderFromEnv,
  resolveMaterialKnowledgeDbPath,
  type MaterialEnvironment,
} from "../config.js";

export type SearchMaterialResult = {
  results: MaterialSearchResult[];
};

export type SearchMaterialToolDependencies = {
  embeddingProvider?: KnowledgeEmbeddingProvider;
  environment?: MaterialEnvironment;
  createVectorStore?: (
    dbPath: string,
  ) => Pick<KnowledgeVectorStore, "getIndexMetadata" | "search" | "close">;
};

export function createSearchMaterialTool(
  deps: SearchMaterialToolDependencies = {},
): VoltAiTool<SearchMaterialResult> {
  return {
    name: "search_material",
    description: "Search indexed material catalog rows from the local SQLite knowledge base.",
    inputSchema: {
      query: z.string().min(1),
      topK: z.number().int().positive().optional(),
    },
    handler: async (input) => {
      const environment = deps.environment ?? process.env;
      const dbPath = resolveMaterialKnowledgeDbPath(environment.PROJECT_ROOT ?? "", environment);
      const vectorStore = deps.createVectorStore?.(dbPath) ?? new SqliteKnowledgeStore(dbPath);

      try {
        const results = await searchMaterialKnowledge(input, {
          embeddingProvider:
            deps.embeddingProvider ?? createMaterialEmbeddingProviderFromEnv(environment),
          vectorStore,
        });

        return { results };
      } finally {
        await vectorStore.close();
      }
    },
  };
}
