export type KnowledgeStoreDecodeField = "metadata" | "locator" | "embedding";

export class KnowledgeStoreDecodeError extends Error {
  readonly collection: string;
  readonly chunkId: string;
  readonly field: KnowledgeStoreDecodeField;

  constructor(collection: string, chunkId: string, field: KnowledgeStoreDecodeField) {
    super(
      `Knowledge store row decode failed for collection "${collection}", chunk "${chunkId}", field "${field}"`,
    );
    this.name = "KnowledgeStoreDecodeError";
    this.collection = collection;
    this.chunkId = chunkId;
    this.field = field;
  }
}
