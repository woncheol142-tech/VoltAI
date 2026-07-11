import type {
  EmbeddedKnowledgeChunk,
  KnowledgeChunk,
  KnowledgeCodecs,
  KnowledgeDocument,
  KnowledgeEmbeddingProvider,
  KnowledgeLocator,
  KnowledgeMetadata,
  KnowledgeVectorStore,
  PageLocator,
  SectionLocator,
  TableLocator,
} from "../../src/index.js";

type CompanyMetadata = {
  standardId: string;
  revision: string;
};

type MaterialMetadata = {
  catalogNumber: string;
  manufacturer: string;
};

type KecMetadata = {
  clause: string | null;
};

const companyChunk: KnowledgeChunk<CompanyMetadata, SectionLocator> = {
  chunkId: "company:standards/design.md:section=grounding:chunk=0",
  documentId: "company:standards/design.md",
  sourcePath: "standards/design.md",
  chunkIndex: 0,
  locator: { kind: "section", section: "Grounding" },
  metadata: { standardId: "CS-100", revision: "2026" },
  text: "Grounding conductors follow the company standard.",
};

const materialChunk: KnowledgeChunk<MaterialMetadata, TableLocator> = {
  chunkId: "materials:catalog.xlsx:table=Products:row=12:chunk=0",
  documentId: "materials:catalog.xlsx",
  sourcePath: "catalog.xlsx",
  chunkIndex: 0,
  locator: { kind: "table", table: "Products", rowIndex: 12 },
  metadata: { catalogNumber: "MCCB-100", manufacturer: "Volt" },
  text: "100 A molded-case circuit breaker",
};

const kecChunk: KnowledgeChunk<KecMetadata, PageLocator> = {
  chunkId: "knowledge/kec.pdf#page=3#chunk=0",
  documentId: "kec:knowledge/kec.pdf",
  sourcePath: "knowledge/kec.pdf",
  chunkIndex: 0,
  locator: { kind: "page", page: 3 },
  metadata: { clause: "KEC 232.5" },
  text: "Cable sizing requirement.",
};

const document: KnowledgeDocument<
  KecMetadata,
  { pages: Array<{ page: number; text: string }> }
> = {
  schemaVersion: 1,
  collection: "kec",
  id: "kec:knowledge/kec.pdf",
  sourcePath: "knowledge/kec.pdf",
  mediaType: "application/pdf",
  metadata: { clause: null },
  content: { pages: [{ page: 1, text: "KEC content" }] },
};

const unsupportedSchema: KnowledgeDocument<KecMetadata, string> = {
  // @ts-expect-error KnowledgeDocument schemaVersion only supports version 1.
  schemaVersion: 2,
  collection: "kec",
  id: "kec:invalid",
  sourcePath: "invalid.txt",
  mediaType: "text/plain",
  metadata: { clause: null },
  content: "invalid",
};

// @ts-expect-error PageLocator requires a page number.
const incompletePageLocator: PageLocator = { kind: "page" };

const unsupportedLocator: KnowledgeLocator = {
  // @ts-expect-error KnowledgeLocator rejects unknown locator discriminants.
  kind: "coordinates",
  x: 1,
  y: 2,
};

void companyChunk;
void materialChunk;
void kecChunk;
void document;
void unsupportedSchema;
void incompletePageLocator;
void unsupportedLocator;

const companyEmbeddedChunk: EmbeddedKnowledgeChunk<
  CompanyMetadata,
  SectionLocator
> = {
  ...companyChunk,
  embedding: [1, 0],
};
const companyCodecs: KnowledgeCodecs<CompanyMetadata, SectionLocator> = {
  metadata: {
    encode: (value): KnowledgeMetadata => ({ ...value }),
    decode: (value): CompanyMetadata => value as CompanyMetadata,
  },
  locator: {
    encode: (value): KnowledgeLocator => ({ ...value }),
    decode: (value): SectionLocator => value as SectionLocator,
  },
};
declare const vectorStore: KnowledgeVectorStore;

void vectorStore.upsert("company", [companyEmbeddedChunk], companyCodecs);
void vectorStore.replaceSource(
  "company",
  companyEmbeddedChunk.sourcePath,
  [companyEmbeddedChunk],
  {
    embeddingProvider: "test",
    embeddingModel: "deterministic",
    dimensions: 2,
    indexedAt: "2026-07-11T00:00:00.000Z",
  },
  companyCodecs,
);
void vectorStore.search("company", [1, 0], 5, companyCodecs);
void vectorStore.listChunks("company", companyCodecs);

// @ts-expect-error Generic store operations require runtime codecs.
void vectorStore.upsert("company", [companyEmbeddedChunk]);

const embeddingProvider: KnowledgeEmbeddingProvider = {
  embed: async (text: string) => [text.length],
  getMetadata: () => ({ provider: "test", model: "deterministic" }),
};

void embeddingProvider;
