import {
  createReviewLlmFromEnv,
  type ReviewLlm,
  type ReviewProjectPorts,
} from "@voltai/agent-review";
import type { KnowledgeEmbeddingProvider, KnowledgeVectorStore } from "@voltai/knowledge-core";
import { searchCompanyKnowledge } from "@voltai/knowledge-company";
import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";
import {
  createCompanyEmbeddingProviderFromEnv,
  resolveCompanyKnowledgeDbPath,
} from "@voltai/mcp-company";
import {
  createEmbeddingProviderFromEnv,
  type EmbeddingProvider,
  searchKec,
  SqliteVectorStore,
  type VectorStore,
} from "@voltai/mcp-kec";
import { listProjectFiles, readExcel, readPdf } from "@voltai/mcp-project-files";
import { join } from "node:path";

function createKecDbPath(projectPath: string): string {
  return process.env.KEC_DB_PATH ?? join(projectPath, ".voltai", "kec.sqlite");
}

export type LocalReviewPortsDependencies = {
  embeddingProvider?: EmbeddingProvider;
  vectorStoreFactory?: () => VectorStore;
  companyEmbeddingProvider?: KnowledgeEmbeddingProvider;
  companyVectorStoreFactory?: () => Pick<
    KnowledgeVectorStore,
    "getIndexMetadata" | "search" | "close"
  >;
  llm?: ReviewLlm;
};

function hasCompanyKnowledgeConfiguration(deps: LocalReviewPortsDependencies): boolean {
  return (
    deps.companyEmbeddingProvider !== undefined ||
    deps.companyVectorStoreFactory !== undefined ||
    (process.env.COMPANY_EMBED_PROVIDER?.length ?? 0) > 0
  );
}

async function closeResources(resources: Array<{ close: () => Promise<void> | void }>): Promise<void> {
  const results = await Promise.allSettled(resources.map(async (resource) => resource.close()));
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failure) {
    throw failure.reason;
  }
}

export function createLocalReviewPorts(
  projectPath: string,
  deps: LocalReviewPortsDependencies = {},
): ReviewProjectPorts {
  const embeddingProvider = deps.embeddingProvider ?? createEmbeddingProviderFromEnv();
  const vectorStore =
    deps.vectorStoreFactory?.() ?? new SqliteVectorStore(createKecDbPath(projectPath));
  const companyConfigured = hasCompanyKnowledgeConfiguration(deps);
  let companyEmbeddingProvider: KnowledgeEmbeddingProvider | undefined;
  let companyVectorStore:
    | Pick<KnowledgeVectorStore, "getIndexMetadata" | "search" | "close">
    | undefined;
  let companySetupError: unknown;

  if (companyConfigured) {
    try {
      companyEmbeddingProvider =
        deps.companyEmbeddingProvider ?? createCompanyEmbeddingProviderFromEnv();
      companyVectorStore =
        deps.companyVectorStoreFactory?.() ??
        new SqliteKnowledgeStore(resolveCompanyKnowledgeDbPath(projectPath));
    } catch (error) {
      companySetupError = error;
    }
  }
  let closed = false;

  return {
    listProjectFiles: async (path) => listProjectFiles(path),
    readPdf: async (relativePath, options) =>
      readPdf(projectPath, { relativePath, maxChars: options?.maxChars }),
    readExcel: async (relativePath, options) =>
      readExcel(projectPath, {
        relativePath,
        sheetName: options?.sheetName,
        maxRows: options?.maxRows,
      }),
    searchKec: async (question) =>
      searchKec(
        { question, topK: 5 },
        {
          embeddingProvider,
          vectorStore,
        },
      ),
    ...(companySetupError !== undefined
      ? {
          searchCompany: async () => {
            throw companySetupError;
          },
        }
      : companyEmbeddingProvider && companyVectorStore
      ? {
          searchCompany: async (question: string) =>
            searchCompanyKnowledge(
              { query: question, topK: 5 },
              {
                embeddingProvider: companyEmbeddingProvider,
                vectorStore: companyVectorStore,
              },
            ),
        }
      : {}),
    ...(companyEmbeddingProvider === undefined
      ? {}
      : { companySearchProvider: companyEmbeddingProvider.getMetadata().provider }),
    llm: deps.llm ?? createReviewLlmFromEnv(),
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      await closeResources(
        companyVectorStore === undefined ? [vectorStore] : [vectorStore, companyVectorStore],
      );
    },
  };
}
