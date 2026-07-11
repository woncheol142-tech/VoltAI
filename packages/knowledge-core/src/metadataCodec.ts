import type { KnowledgeLocator, KnowledgeMetadata } from "./types.js";

export type KnowledgeMetadataCodec<TMetadata extends KnowledgeMetadata> = {
  encode: (value: TMetadata) => KnowledgeMetadata;
  decode: (value: unknown) => TMetadata;
};

export type KnowledgeLocatorCodec<TLocator extends KnowledgeLocator> = {
  encode: (value: TLocator) => KnowledgeLocator;
  decode: (value: unknown) => TLocator;
};

export type KnowledgeCodecs<
  TMetadata extends KnowledgeMetadata,
  TLocator extends KnowledgeLocator,
> = {
  metadata: KnowledgeMetadataCodec<TMetadata>;
  locator: KnowledgeLocatorCodec<TLocator>;
};
