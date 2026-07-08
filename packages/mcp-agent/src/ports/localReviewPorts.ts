import { MockReviewLlm, type ReviewProjectPorts } from "@voltai/agent-review";
import {
  createEmbeddingProviderFromEnv,
  searchKec,
  SqliteVectorStore,
} from "@voltai/mcp-kec";
import { listProjectFiles, readExcel, readPdf } from "@voltai/mcp-project-files";
import { join } from "node:path";

function createKecDbPath(projectPath: string): string {
  return process.env.KEC_DB_PATH ?? join(projectPath, ".voltai", "kec.sqlite");
}

export function createLocalReviewPorts(projectPath: string): ReviewProjectPorts {
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
          embeddingProvider: createEmbeddingProviderFromEnv(),
          vectorStore: new SqliteVectorStore(createKecDbPath(projectPath)),
        },
      ),
    llm: new MockReviewLlm(),
  };
}
