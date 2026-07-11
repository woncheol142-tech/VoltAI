import type { KnowledgeEmbeddingProvider, KnowledgeVectorStore } from "@voltai/knowledge-core";
import { indexCompanyKnowledge } from "@voltai/knowledge-company";
import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";
import type { VoltAiTool } from "@voltai/mcp-core";
import { readPdf, type ReadPdfResult } from "@voltai/mcp-project-files";
import { z } from "zod";

import {
  createCompanyEmbeddingProviderFromEnv,
  resolveCompanyKnowledgeDbPath,
  type CompanyEnvironment,
} from "../config.js";

export type IndexCompanyInput = {
  relativePath: string;
  standardId: string;
  title: string;
  revision?: string;
  effectiveDate?: string;
  department?: string;
  chunkSize?: number;
  chunkOverlap?: number;
};

export type IndexCompanyResult = {
  relativePath: string;
  standardId: string;
  indexedChunks: number;
};

type ReadPdf = (projectRoot: string | undefined, input: unknown) => Promise<ReadPdfResult>;

export type IndexCompanyToolDependencies = {
  embeddingProvider?: KnowledgeEmbeddingProvider;
  environment?: CompanyEnvironment;
  createVectorStore?: (dbPath: string) => Pick<KnowledgeVectorStore, "replaceSource" | "close">;
  readPdf?: ReadPdf;
};

function assertIndexCompanyInput(input: unknown): IndexCompanyInput {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<IndexCompanyInput>;
  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }

  return {
    relativePath: candidate.relativePath,
    standardId: candidate.standardId as string,
    title: candidate.title as string,
    revision: candidate.revision,
    effectiveDate: candidate.effectiveDate,
    department: candidate.department,
    chunkSize: candidate.chunkSize,
    chunkOverlap: candidate.chunkOverlap,
  };
}

export function createIndexCompanyTool(
  deps: IndexCompanyToolDependencies = {},
): VoltAiTool<IndexCompanyResult> {
  return {
    name: "index_company",
    description: "Index a Company standard PDF into the local SQLite knowledge base.",
    inputSchema: {
      relativePath: z.string().min(1),
      standardId: z.string().min(1),
      title: z.string().min(1),
      revision: z.string().optional(),
      effectiveDate: z.string().optional(),
      department: z.string().optional(),
      chunkSize: z.number().int().positive().optional(),
      chunkOverlap: z.number().int().nonnegative().optional(),
    },
    handler: async (input) => {
      const indexInput = assertIndexCompanyInput(input);
      const environment = deps.environment ?? process.env;
      const pdf = await (deps.readPdf ?? readPdf)(environment.PROJECT_ROOT, {
        relativePath: indexInput.relativePath,
      });
      const dbPath = resolveCompanyKnowledgeDbPath(environment.PROJECT_ROOT ?? "", environment);
      const vectorStore = deps.createVectorStore?.(dbPath) ?? new SqliteKnowledgeStore(dbPath);

      try {
        const result = await indexCompanyKnowledge(
          {
            ...indexInput,
            sourcePath: pdf.relativePath,
          },
          {
            readPdfPages: async () => pdf.pages,
            embeddingProvider:
              deps.embeddingProvider ?? createCompanyEmbeddingProviderFromEnv(environment),
            vectorStore,
          },
        );

        return {
          relativePath: pdf.relativePath,
          standardId: result.standardId,
          indexedChunks: result.indexedChunks,
        };
      } finally {
        await vectorStore.close();
      }
    },
  };
}
