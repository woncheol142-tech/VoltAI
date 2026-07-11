import type { KnowledgeCodecs } from "./metadataCodec.js";
import type {
  EmbeddedKnowledgeChunk,
  KnowledgeChunk,
  KnowledgeIndexMetadata,
  KnowledgeLocator,
  KnowledgeMetadata,
  KnowledgeSearchResult,
} from "./types.js";

export type KnowledgeVectorStore = {
  upsert: <
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    collection: string,
    chunks: EmbeddedKnowledgeChunk<TMetadata, TLocator>[],
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ) => Promise<void>;
  replaceSource: <
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    collection: string,
    sourcePath: string,
    chunks: EmbeddedKnowledgeChunk<TMetadata, TLocator>[],
    metadata: KnowledgeIndexMetadata,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ) => Promise<void>;
  deleteBySourcePath: (collection: string, sourcePath: string) => Promise<void>;
  search: <
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    collection: string,
    embedding: number[],
    topK: number,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ) => Promise<KnowledgeSearchResult<TMetadata, TLocator>[]>;
  listChunks: <
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    collection: string,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ) => Promise<KnowledgeChunk<TMetadata, TLocator>[]>;
  saveIndexMetadata: (collection: string, metadata: KnowledgeIndexMetadata) => Promise<void>;
  getIndexMetadata: (collection: string) => Promise<KnowledgeIndexMetadata | null>;
  close: () => Promise<void> | void;
};
