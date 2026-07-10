import type { KnowledgeMetadata } from "./types.js";

export type KnowledgeMetadataCodec<TMetadata extends KnowledgeMetadata> = {
  encode: (value: TMetadata) => KnowledgeMetadata;
  decode: (value: unknown) => TMetadata;
};
