import type { KnowledgeVectorStore } from "@voltai/knowledge-core";

import type { EmbeddingProvider } from "../knowledge/embedding.js";

export type ExistingKecHybridSearchDependencies = Readonly<{
  embeddingProvider: EmbeddingProvider;
  vectorStore: Pick<
    KnowledgeVectorStore,
    "getIndexMetadata" | "search" | "listChunks"
  >;
}>;
