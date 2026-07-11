import type { KnowledgeEmbeddingProvider, KnowledgeVectorStore } from "@voltai/knowledge-core";
import {
  indexMaterialKnowledge,
  type MaterialColumnMap,
  type MaterialSheet,
} from "@voltai/knowledge-material";
import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";
import type { VoltAiTool } from "@voltai/mcp-core";
import { readExcelSheetWithProvenance } from "@voltai/mcp-project-files";
import { z } from "zod";

import {
  createMaterialEmbeddingProviderFromEnv,
  resolveMaterialKnowledgeDbPath,
  type MaterialEnvironment,
} from "../config.js";

export type IndexMaterialInput = {
  relativePath: string;
  catalogId: string;
  sheetName?: string;
  headerRow?: number;
  columnMap: MaterialColumnMap;
  revision?: string;
  effectiveDate?: string;
};

export type IndexMaterialResult = {
  relativePath: string;
  catalogId: string;
  sheetName: string;
  indexedRows: number;
};

type ReadMaterialSheet = (projectRoot: string | undefined, input: unknown) => Promise<MaterialSheet>;

export type IndexMaterialToolDependencies = {
  embeddingProvider?: KnowledgeEmbeddingProvider;
  environment?: MaterialEnvironment;
  createVectorStore?: (dbPath: string) => Pick<KnowledgeVectorStore, "replaceSource" | "close">;
  readMaterialSheet?: ReadMaterialSheet;
};

function assertIndexMaterialInput(input: unknown): IndexMaterialInput {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<IndexMaterialInput>;
  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }
  if (typeof candidate.catalogId !== "string" || candidate.catalogId.trim().length === 0) {
    throw new Error("catalogId is required");
  }
  if (!candidate.columnMap || typeof candidate.columnMap !== "object") {
    throw new Error("columnMap is required");
  }

  return {
    relativePath: candidate.relativePath,
    catalogId: candidate.catalogId,
    sheetName: candidate.sheetName,
    headerRow: candidate.headerRow,
    columnMap: { ...candidate.columnMap },
    revision: candidate.revision,
    effectiveDate: candidate.effectiveDate,
  };
}

export function createIndexMaterialTool(
  deps: IndexMaterialToolDependencies = {},
): VoltAiTool<IndexMaterialResult> {
  return {
    name: "index_material",
    description: "Index a material catalog XLSX into the local SQLite knowledge base.",
    inputSchema: {
      relativePath: z.string().min(1),
      catalogId: z.string().min(1),
      sheetName: z.string().optional(),
      headerRow: z.number().int().positive().optional(),
      columnMap: z.object({
        itemCode: z.string().min(1),
        name: z.string().min(1),
        manufacturer: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        specification: z.string().min(1).optional(),
        unit: z.string().min(1).optional(),
        unitPrice: z.string().min(1).optional(),
        currency: z.string().min(1).optional(),
      }),
      revision: z.string().optional(),
      effectiveDate: z.string().optional(),
    },
    handler: async (input) => {
      const indexInput = assertIndexMaterialInput(input);
      const environment = deps.environment ?? process.env;
      const sheet = await (deps.readMaterialSheet ?? readExcelSheetWithProvenance)(
        environment.PROJECT_ROOT,
        {
          relativePath: indexInput.relativePath,
          sheetName: indexInput.sheetName,
        },
      );
      const dbPath = resolveMaterialKnowledgeDbPath(environment.PROJECT_ROOT ?? "", environment);
      const vectorStore = deps.createVectorStore?.(dbPath) ?? new SqliteKnowledgeStore(dbPath);

      try {
        const result = await indexMaterialKnowledge(
          {
            ...indexInput,
            sourcePath: sheet.relativePath,
            sheetName: sheet.sheetName,
          },
          {
            readMaterialSheet: async () => sheet,
            embeddingProvider:
              deps.embeddingProvider ?? createMaterialEmbeddingProviderFromEnv(environment),
            vectorStore,
          },
        );

        return {
          relativePath: sheet.relativePath,
          catalogId: result.catalogId,
          sheetName: result.sheetName,
          indexedRows: result.indexedRows,
        };
      } finally {
        await vectorStore.close();
      }
    },
  };
}
