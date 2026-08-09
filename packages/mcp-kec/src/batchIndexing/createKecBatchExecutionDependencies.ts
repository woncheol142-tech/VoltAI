import type { KecBatchIndexExecutionDependencies } from "./executeKecBatchIndex.js";
import type { PreparedKecBatchIndex } from "./types.js";

const INVALID_CONFIGURATION = "KEC_BATCH_INDEX: INVALID_CONFIGURATION";
const INTERNAL_ERROR = "KEC_BATCH_INDEX: INTERNAL_ERROR";
const EMBEDDING_MODULE_PATH: string = "../knowledge/embedding.js";
const STORE_MODULE_PATH: string = "../knowledge/sqliteVectorStore.js";
const SINGLE_SOURCE_MODULE_PATH: string = "../tools/indexKec.js";

type StoreInstance = Readonly<{
  close: () => void | Promise<void>;
}>;

type EmbeddingModule = Readonly<{
  createEmbeddingProviderFromEnv: () => unknown;
}>;

type StoreModule = Readonly<{
  SqliteVectorStore: new (databasePath: string) => StoreInstance;
}>;

type SingleSourceModule = Readonly<{
  indexKec: (
    projectRoot: string,
    input: Readonly<{
      relativePath: string;
      embeddingConcurrency: number;
      embeddingMaxAttempts: number;
      embeddingRetryDelayMs: number;
    }>,
    dependencies: Readonly<{
      embeddingProvider: unknown;
      vectorStore: unknown;
    }>,
  ) => Promise<Readonly<{ indexedChunks: number }>>;
}>;

export function createKecBatchExecutionDependencies(
  prepared: PreparedKecBatchIndex,
): KecBatchIndexExecutionDependencies {
  return Object.freeze({
    createProvider: async (provider) => {
      if (provider !== prepared.provider) {
        throw new Error(INVALID_CONFIGURATION);
      }
      const { createEmbeddingProviderFromEnv } = (await import(
        EMBEDDING_MODULE_PATH
      )) as EmbeddingModule;
      return createEmbeddingProviderFromEnv();
    },
    createStore: async (databasePath) => {
      const { SqliteVectorStore } = (await import(
        STORE_MODULE_PATH
      )) as StoreModule;
      return new SqliteVectorStore(databasePath);
    },
    indexSource: async (projectRoot, input, dependencies) => {
      const { indexKec } = (await import(
        SINGLE_SOURCE_MODULE_PATH
      )) as SingleSourceModule;
      const result = await indexKec(projectRoot, input, {
        embeddingProvider: dependencies.embeddingProvider,
        vectorStore: dependencies.vectorStore,
      });
      return Object.freeze({ indexedChunks: result.indexedChunks });
    },
    closeStore: async (store) => {
      const { SqliteVectorStore } = (await import(
        STORE_MODULE_PATH
      )) as StoreModule;
      if (!(store instanceof SqliteVectorStore)) {
        throw new Error(INTERNAL_ERROR);
      }
      await store.close();
    },
    closeProvider: () => {},
  });
}
