import type { EmbeddingProvider } from "../knowledge/embedding.js";
import type { KecIndexMetadata } from "../knowledge/vectorStore.js";

export type KecSemanticSearchCoreDependencies<TResult> = Readonly<{
  embeddingProvider: EmbeddingProvider;
  getIndexMetadata: () => Promise<KecIndexMetadata | null>;
  search: (embedding: number[], topK: number) => Promise<TResult[]>;
}>;
