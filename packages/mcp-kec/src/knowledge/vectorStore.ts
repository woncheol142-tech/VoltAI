export type KecChunk = {
  id: string;
  sourcePath: string;
  page: number;
  chunkIndex: number;
  clause: string | null;
  text: string;
};

export type EmbeddedKecChunk = KecChunk & {
  embedding: number[];
};

export type KecSearchResult = {
  clause: string | null;
  page: number;
  text: string;
  similarity: number;
  sourcePath: string;
};

export type KecIndexMetadata = {
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  indexedAt: string;
};

export type VectorStore = {
  upsert: (chunks: EmbeddedKecChunk[]) => Promise<void>;
  search: (embedding: number[], topK: number) => Promise<KecSearchResult[]>;
  listChunks: () => Promise<KecChunk[]>;
  saveIndexMetadata: (metadata: KecIndexMetadata) => Promise<void>;
  getIndexMetadata: () => Promise<KecIndexMetadata | null>;
};
