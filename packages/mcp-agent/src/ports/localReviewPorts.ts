import { MockReviewLlm, type ReviewProjectPorts } from "@voltai/agent-review";
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
};

export function createLocalReviewPorts(
  projectPath: string,
  deps: LocalReviewPortsDependencies = {},
): ReviewProjectPorts {
  const embeddingProvider = deps.embeddingProvider ?? createEmbeddingProviderFromEnv();
  const vectorStore =
    deps.vectorStoreFactory?.() ?? new SqliteVectorStore(createKecDbPath(projectPath));

  return {
    listProjectFiles: async (path) => listProjectFiles(path),
    readPdf: async (relativePath) => readPdf(projectPath, { relativePath }),
    readExcel: async (relativePath) => {
      const workbook = await readExcel(projectPath, { relativePath });
      const firstSheet = workbook.sheets[0];

      if (!firstSheet) {
        return workbook;
      }

      return readExcel(projectPath, {
        relativePath,
        sheetName: firstSheet,
        maxRows: 50,
      });
    },
    searchKec: async (question) =>
      searchKec(
        { question, topK: 5 },
        {
          embeddingProvider,
          vectorStore,
        },
      ),
    llm: new MockReviewLlm(),
    close: async () => {
      await vectorStore.close();
    },
  };
}
