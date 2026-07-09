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

export type KnowledgeCollection = "kec" | "company" | "materials" | "estimates" | "drawings";

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
  upsert: (collection: KnowledgeCollection, chunks: EmbeddedKecChunk[]) => Promise<void>;
  replaceSource: (
    collection: KnowledgeCollection,
    sourcePath: string,
    chunks: EmbeddedKecChunk[],
    metadata: KecIndexMetadata,
  ) => Promise<void>;
  deleteBySourcePath: (collection: KnowledgeCollection, sourcePath: string) => Promise<void>;
  search: (
    collection: KnowledgeCollection,
    embedding: number[],
    topK: number,
  ) => Promise<KecSearchResult[]>;
  listChunks: (collection: KnowledgeCollection) => Promise<KecChunk[]>;
  saveIndexMetadata: (
    collection: KnowledgeCollection,
    metadata: KecIndexMetadata,
  ) => Promise<void>;
  getIndexMetadata: (collection: KnowledgeCollection) => Promise<KecIndexMetadata | null>;
  close: () => Promise<void> | void;
};
