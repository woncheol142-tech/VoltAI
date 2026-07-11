import type { KnowledgeEmbeddingProvider, KnowledgeVectorStore } from "@voltai/knowledge-core";
import { searchCompanyKnowledge, type CompanySearchResult } from "@voltai/knowledge-company";
import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";
import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import {
  createCompanyEmbeddingProviderFromEnv,
  resolveCompanyKnowledgeDbPath,
  type CompanyEnvironment,
} from "../config.js";

export type SearchCompanyInput = {
  query: string;
  topK?: number;
};

export type SearchCompanyResult = {
  results: CompanySearchResult[];
};

export type SearchCompanyToolDependencies = {
  embeddingProvider?: KnowledgeEmbeddingProvider;
  environment?: CompanyEnvironment;
  createVectorStore?: (
    dbPath: string,
  ) => Pick<KnowledgeVectorStore, "getIndexMetadata" | "search" | "close">;
};

export function createSearchCompanyTool(
  deps: SearchCompanyToolDependencies = {},
): VoltAiTool<SearchCompanyResult> {
  return {
    name: "search_company",
    description: "Search indexed Company standard chunks from the local SQLite knowledge base.",
    inputSchema: {
      query: z.string().min(1),
      topK: z.number().int().positive().optional(),
    },
    handler: async (input) => {
      const environment = deps.environment ?? process.env;
      const projectRoot = environment.PROJECT_ROOT;
      const dbPath = resolveCompanyKnowledgeDbPath(projectRoot ?? "", environment);
      const vectorStore = deps.createVectorStore?.(dbPath) ?? new SqliteKnowledgeStore(dbPath);

      try {
        const results = await searchCompanyKnowledge(input, {
          embeddingProvider:
            deps.embeddingProvider ?? createCompanyEmbeddingProviderFromEnv(environment),
          vectorStore,
        });

        return { results };
      } finally {
        await vectorStore.close();
      }
    },
  };
}
