import type {
  EmbeddedKnowledgeChunk,
  KnowledgeCodecs,
  PageLocator,
} from "../../../packages/knowledge-core/src/index.js";
import { SqliteKnowledgeStore } from "../../../packages/knowledge-sqlite/src/index.js";
import { resolve } from "node:path";

import { createPageChunks } from "../../../packages/mcp-kec/src/knowledge/chunk.js";

import { sanitizeExtractedText } from "./nulSanitizer.js";

type PageText = {
  page: number;
  text: string;
};

type ProvisionalMetadata = {
  clause: string | null;
  documentScope: "CONSOLIDATED_FULL_TEXT";
  publicationLayer: "OFFICIAL_REPUBLICATION";
  sourceProvisional: true;
  sourceSha256: string;
};

type EmbeddingMetadata = {
  provider: string;
  model: string;
};

export type BuildProvisionalIndexInput = {
  collectionId: string;
  targetDbPath: string;
  protectedDrawingIndexPath: string;
  sourcePath: string;
  sourceSha256: string;
  pages: PageText[];
  embed: (text: string) => Promise<number[]>;
  embeddingMetadata: EmbeddingMetadata;
  indexedAt: string;
};

export type BuildProvisionalIndexResult = {
  collectionId: string;
  targetDbPath: string;
  chunkCount: number;
  embeddingDimensions: number;
  nulCountBeforeSanitization: number;
  nulCountAfterSanitization: number;
};

const provisionalCodecs: KnowledgeCodecs<ProvisionalMetadata, PageLocator> = {
  metadata: {
    encode: (value) => ({ ...value }),
    decode: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("clause" in value) ||
        (value.clause !== null && typeof value.clause !== "string") ||
        !("sourceSha256" in value) ||
        typeof value.sourceSha256 !== "string" ||
        value.documentScope !== "CONSOLIDATED_FULL_TEXT" ||
        value.publicationLayer !== "OFFICIAL_REPUBLICATION" ||
        value.sourceProvisional !== true
      ) {
        throw new Error("Provisional regulation metadata is invalid");
      }

      return {
        clause: value.clause,
        documentScope: value.documentScope,
        publicationLayer: value.publicationLayer,
        sourceProvisional: value.sourceProvisional,
        sourceSha256: value.sourceSha256,
      };
    },
  },
  locator: {
    encode: (value) => ({ ...value }),
    decode: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        value.kind !== "page" ||
        !("page" in value) ||
        !Number.isInteger(value.page) ||
        Number(value.page) < 1
      ) {
        throw new Error("Provisional regulation page locator is invalid");
      }

      return { kind: "page", page: Number(value.page) };
    },
  },
};

function countNul(text: string): number {
  return text.split("\u0000").length - 1;
}

function assertBuildInput(input: BuildProvisionalIndexInput): void {
  if (input.collectionId === "kec" || input.collectionId.trim().length === 0) {
    throw new Error("Provisional collection id must be distinct from kec");
  }

  if (resolve(input.targetDbPath) === resolve(input.protectedDrawingIndexPath)) {
    throw new Error("Refusing to write to protected drawing index path");
  }

  if (!/^[a-f0-9]{64}$/i.test(input.sourceSha256)) {
    throw new Error("sourceSha256 must be a 64-character hexadecimal SHA-256");
  }

  if (input.pages.length === 0) {
    throw new Error("At least one extracted page is required");
  }
}

function validateEmbedding(embedding: number[]): number[] {
  if (
    embedding.length === 0 ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Embedding must be a non-empty finite number array");
  }

  return embedding;
}

export async function buildProvisionalRegulationIndexFromPages(
  input: BuildProvisionalIndexInput,
): Promise<BuildProvisionalIndexResult> {
  assertBuildInput(input);

  const nulCountBeforeSanitization = input.pages.reduce(
    (total, page) => total + countNul(page.text),
    0,
  );
  const sanitizedPages = input.pages.map((page) => ({
    page: page.page,
    text: sanitizeExtractedText(page.text),
  }));
  const nulCountAfterSanitization = sanitizedPages.reduce(
    (total, page) => total + countNul(page.text),
    0,
  );

  if (nulCountAfterSanitization !== 0) {
    throw new Error("Research NUL sanitization did not remove every U+0000");
  }

  const chunks = createPageChunks(input.sourcePath, sanitizedPages);

  if (chunks.length === 0) {
    throw new Error("PDF text is empty or unavailable");
  }

  const embeddedChunks: Array<
    EmbeddedKnowledgeChunk<ProvisionalMetadata, PageLocator>
  > = [];
  let embeddingDimensions: number | undefined;

  for (const chunk of chunks) {
    const embedding = validateEmbedding(await input.embed(chunk.text));
    embeddingDimensions ??= embedding.length;

    if (embedding.length !== embeddingDimensions) {
      throw new Error("Embedding dimensions changed during index construction");
    }

    embeddedChunks.push({
      chunkId: `${input.collectionId}:${chunk.id}`,
      documentId: `${input.collectionId}:${input.sourceSha256}`,
      sourcePath: input.sourcePath,
      chunkIndex: chunk.chunkIndex,
      locator: { kind: "page", page: chunk.page },
      metadata: {
        clause: chunk.clause,
        documentScope: "CONSOLIDATED_FULL_TEXT",
        publicationLayer: "OFFICIAL_REPUBLICATION",
        sourceProvisional: true,
        sourceSha256: input.sourceSha256,
      },
      text: chunk.text,
      embedding,
    });
  }

  const store = new SqliteKnowledgeStore(input.targetDbPath);

  try {
    await store.replaceSource(
      input.collectionId,
      input.sourcePath,
      embeddedChunks,
      {
        embeddingProvider: input.embeddingMetadata.provider,
        embeddingModel: input.embeddingMetadata.model,
        dimensions: embeddingDimensions ?? 0,
        indexedAt: input.indexedAt,
      },
      provisionalCodecs,
      {
        compatibilityProjection: (chunk) => ({
          page: chunk.locator.page,
          clause: chunk.metadata.clause,
        }),
      },
    );
  } finally {
    await store.close();
  }

  return {
    collectionId: input.collectionId,
    targetDbPath: input.targetDbPath,
    chunkCount: embeddedChunks.length,
    embeddingDimensions: embeddingDimensions ?? 0,
    nulCountBeforeSanitization,
    nulCountAfterSanitization,
  };
}

export async function searchProvisionalRegulationIndex(input: {
  collectionId: string;
  targetDbPath: string;
  query: string;
  topK: number;
  embed: (text: string) => Promise<number[]>;
}) {
  const store = new SqliteKnowledgeStore(input.targetDbPath);

  try {
    const metadata = await store.getIndexMetadata(input.collectionId);

    if (!metadata) {
      throw new Error("Provisional regulation index metadata is unavailable");
    }

    const queryEmbedding = validateEmbedding(await input.embed(input.query));

    if (queryEmbedding.length !== metadata.dimensions) {
      throw new Error("Query embedding dimensions do not match index metadata");
    }

    return await store.search(
      input.collectionId,
      queryEmbedding,
      input.topK,
      provisionalCodecs,
    );
  } finally {
    await store.close();
  }
}
