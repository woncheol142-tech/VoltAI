import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeLocator,
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

const document: KnowledgeDocument<KecMetadata, { pages: Array<{ page: number; text: string }> }> = {
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

// @ts-expect-error KnowledgeLocator rejects unknown locator discriminants.
const unsupportedLocator: KnowledgeLocator = { kind: "coordinates", x: 1, y: 2 };

void companyChunk;
void materialChunk;
void kecChunk;
void document;
void unsupportedSchema;
void incompletePageLocator;
void unsupportedLocator;
