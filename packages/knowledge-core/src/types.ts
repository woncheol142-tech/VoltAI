export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type KnowledgeMetadata = Readonly<Record<string, JsonValue>>;

/** All locator indexes are 1-based because they are displayed to users. */
export type PageLocator = {
  kind: "page";
  page: number;
};

/** All locator indexes are 1-based because they are displayed to users. */
export type SectionLocator = {
  kind: "section";
  section: string;
  page?: number;
};

/** All locator indexes are 1-based because they are displayed to users. */
export type TableLocator = {
  kind: "table";
  table: string;
  rowIndex?: number;
  column?: string;
};

/** All locator indexes are 1-based because they are displayed to users. */
export type ParagraphLocator = {
  kind: "paragraph";
  paragraphIndex: number;
  page?: number;
};

export type KnowledgeLocator =
  | PageLocator
  | SectionLocator
  | TableLocator
  | ParagraphLocator;

export type KnowledgeDocument<
  TMetadata extends KnowledgeMetadata = KnowledgeMetadata,
  TContent = unknown,
> = {
  schemaVersion: 1;
  id: string;
  collection: string;
  sourcePath: string;
  mediaType: string;
  content: TContent;
  metadata: TMetadata;
};

export type KnowledgeChunk<
  TMetadata extends KnowledgeMetadata = KnowledgeMetadata,
  TLocator extends KnowledgeLocator = KnowledgeLocator,
> = {
  chunkId: string;
  documentId: string;
  sourcePath: string;
  chunkIndex: number;
  locator: TLocator;
  metadata: TMetadata;
  text: string;
};

export type EmbeddedKnowledgeChunk<
  TMetadata extends KnowledgeMetadata = KnowledgeMetadata,
  TLocator extends KnowledgeLocator = KnowledgeLocator,
> = KnowledgeChunk<TMetadata, TLocator> & {
  embedding: number[];
};

export type KnowledgeSearchResult<
  TMetadata extends KnowledgeMetadata = KnowledgeMetadata,
  TLocator extends KnowledgeLocator = KnowledgeLocator,
> = {
  chunkId: string;
  documentId: string;
  sourcePath: string;
  locator: TLocator;
  metadata: TMetadata;
  text: string;
  similarity: number;
};

export type KnowledgeCitation<
  TDomain extends string = string,
  TMetadata extends KnowledgeMetadata = KnowledgeMetadata,
  TLocator extends KnowledgeLocator = KnowledgeLocator,
> = {
  citationId: string;
  sourceType: "knowledge";
  domain: TDomain;
  collection: string;
  documentId: string;
  sourcePath: string;
  locator: TLocator;
  label: string;
  excerpt: string;
  metadata: TMetadata;
};

export type KnowledgeIndexMetadata = {
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  indexedAt: string;
};
