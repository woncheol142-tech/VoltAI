export { KnowledgeStoreDecodeError } from "./errors.js";
export type { KnowledgeStoreDecodeField } from "./errors.js";
export { createKnowledgeDocumentId, currentKnowledgeSchemaVersion } from "./schema.js";
export { SqliteKnowledgeStore } from "./sqliteKnowledgeStore.js";
export type {
  SqliteCompatibilityProjection,
  SqliteKnowledgeWriteOptions,
} from "./sqliteKnowledgeStore.js";
