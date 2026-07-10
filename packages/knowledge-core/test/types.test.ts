import { describe, expect, it } from "vitest";

import type {
  EmbeddedKnowledgeChunk,
  KnowledgeChunk,
  KnowledgeCitation,
  KnowledgeDocument,
  KnowledgeIndexMetadata,
  KnowledgeLocator,
  KnowledgeMetadata,
  KnowledgeMetadataCodec,
  KnowledgeSearchResult,
  PageLocator,
} from "../src/index.js";

type KecMetadata = {
  clause: string | null;
};

type KecPdfContent = {
  pages: Array<{ page: number; text: string }>;
};

describe("generic knowledge core contracts", () => {
  it("preserves the versioned KnowledgeDocument envelope", () => {
    const document: KnowledgeDocument<KecMetadata, KecPdfContent> = {
      schemaVersion: 1,
      collection: "kec",
      id: "kec:knowledge/kec-source.pdf",
      sourcePath: "knowledge/kec-source.pdf",
      mediaType: "application/pdf",
      metadata: { clause: null },
      content: {
        pages: [{ page: 1, text: "KEC 232.5 cable sizing requirement" }],
      },
    };

    expect(document).toEqual({
      schemaVersion: 1,
      collection: "kec",
      id: "kec:knowledge/kec-source.pdf",
      sourcePath: "knowledge/kec-source.pdf",
      mediaType: "application/pdf",
      metadata: { clause: null },
      content: {
        pages: [{ page: 1, text: "KEC 232.5 cable sizing requirement" }],
      },
    });
  });

  it("keeps chunk, embedding, search result, citation, and index metadata fields typed", () => {
    const locator: PageLocator = { kind: "page", page: 3 };
    const chunk: KnowledgeChunk<KecMetadata, PageLocator> = {
      chunkId: "knowledge/kec.pdf#page=3#chunk=0",
      documentId: "kec:knowledge/kec.pdf",
      sourcePath: "knowledge/kec.pdf",
      chunkIndex: 0,
      locator,
      metadata: { clause: "KEC 232.5" },
      text: "Cable sizing requirement.",
    };
    const embedded: EmbeddedKnowledgeChunk<KecMetadata, PageLocator> = {
      ...chunk,
      embedding: [1, 0, 0],
    };
    const result: KnowledgeSearchResult<KecMetadata, PageLocator> = {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      sourcePath: chunk.sourcePath,
      locator,
      metadata: chunk.metadata,
      text: chunk.text,
      similarity: 0.92,
    };
    const citation: KnowledgeCitation<"kec", KecMetadata, PageLocator> = {
      citationId: "kec:knowledge/kec.pdf:p3:KEC 232.5",
      sourceType: "knowledge",
      domain: "kec",
      collection: "kec",
      documentId: chunk.documentId,
      sourcePath: chunk.sourcePath,
      locator,
      label: "KEC 232.5",
      excerpt: chunk.text,
      metadata: chunk.metadata,
    };
    const indexMetadata: KnowledgeIndexMetadata = {
      embeddingProvider: "placeholder",
      embeddingModel: "deterministic",
      dimensions: 3,
      indexedAt: "2026-07-11T00:00:00.000Z",
    };

    expect(embedded.embedding).toEqual([1, 0, 0]);
    expect(result).toMatchObject({ chunkId: chunk.chunkId, similarity: 0.92 });
    expect(citation).toMatchObject({ domain: "kec", locator });
    expect(indexMetadata.dimensions).toBe(3);
  });

  it("defines the locator union without requiring non-page implementations", () => {
    const locators: KnowledgeLocator[] = [
      { kind: "page", page: 2 },
      { kind: "section", section: "Grounding", page: 2 },
      { kind: "table", table: "Load Schedule", rowIndex: 12, column: "MCCB" },
      { kind: "paragraph", paragraphIndex: 4, page: 2 },
    ];

    expect(locators.map((locator) => locator.kind)).toEqual([
      "page",
      "section",
      "table",
      "paragraph",
    ]);
  });

  it("uses a provider-local metadata codec without a registry", () => {
    const codec: KnowledgeMetadataCodec<KecMetadata> = {
      encode: (metadata): KnowledgeMetadata => ({ clause: metadata.clause }),
      decode: (value: unknown): KecMetadata => {
        if (!value || typeof value !== "object" || !("clause" in value)) {
          throw new Error("KEC metadata is invalid");
        }

        const clause = (value as { clause: unknown }).clause;

        if (clause !== null && typeof clause !== "string") {
          throw new Error("KEC metadata is invalid");
        }

        return { clause };
      },
    };

    expect(codec.encode({ clause: "KEC 232.5" })).toEqual({ clause: "KEC 232.5" });
    expect(codec.decode({ clause: null })).toEqual({ clause: null });
    expect(() => codec.decode({ clause: 232.5 })).toThrow("KEC metadata is invalid");
  });
});
