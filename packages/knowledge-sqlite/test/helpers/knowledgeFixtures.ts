import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  EmbeddedKnowledgeChunk,
  KnowledgeCodecs,
  KnowledgeLocator,
  KnowledgeMetadata,
} from "@voltai/knowledge-core";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type TestMetadata = {
  kind: string;
  clause: string | null;
};

export type LegacyKecMetadata = {
  clause: string | null;
};

export const testIndexMetadata = {
  embeddingProvider: "test",
  embeddingModel: "deterministic",
  dimensions: 2,
  indexedAt: "2026-07-11T00:00:00.000Z",
};

export const tempRoots: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 1);
}

function decodeMetadata(value: unknown): TestMetadata {
  if (!isRecord(value)) {
    throw new Error("test metadata is invalid");
  }

  const { kind, clause } = value;

  if (typeof kind !== "string" || (clause !== null && typeof clause !== "string")) {
    throw new Error("test metadata is invalid");
  }

  return { kind, clause };
}

function decodeLocator(value: unknown): KnowledgeLocator {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("test locator is invalid");
  }

  switch (value.kind) {
    case "page":
      if (!Number.isInteger(value.page) || Number(value.page) < 1) {
        throw new Error("test locator is invalid");
      }
      return { kind: "page", page: Number(value.page) };
    case "section":
      if (typeof value.section !== "string" || !optionalPositiveInteger(value.page)) {
        throw new Error("test locator is invalid");
      }
      return { kind: "section", section: value.section, page: value.page };
    case "table":
      if (
        typeof value.table !== "string" ||
        !optionalPositiveInteger(value.rowIndex) ||
        (value.column !== undefined && typeof value.column !== "string")
      ) {
        throw new Error("test locator is invalid");
      }
      return {
        kind: "table",
        table: value.table,
        rowIndex: value.rowIndex,
        column: value.column,
      };
    case "paragraph":
      if (!Number.isInteger(value.paragraphIndex) || !optionalPositiveInteger(value.page)) {
        throw new Error("test locator is invalid");
      }
      return {
        kind: "paragraph",
        paragraphIndex: Number(value.paragraphIndex),
        page: value.page,
      };
    default:
      throw new Error("test locator is invalid");
  }
}

export const testCodecs: KnowledgeCodecs<TestMetadata, KnowledgeLocator> = {
  metadata: {
    encode: (value): KnowledgeMetadata => ({ ...decodeMetadata(value) }),
    decode: decodeMetadata,
  },
  locator: {
    encode: (value): KnowledgeLocator => decodeLocator(value),
    decode: decodeLocator,
  },
};

export const legacyKecCodecs: KnowledgeCodecs<LegacyKecMetadata, KnowledgeLocator> = {
  metadata: {
    encode: (value): KnowledgeMetadata => ({ clause: value.clause }),
    decode: (value: unknown): LegacyKecMetadata => {
      if (!isRecord(value)) {
        throw new Error("legacy KEC metadata is invalid");
      }

      const clause = value.clause;

      if (clause !== null && typeof clause !== "string") {
        throw new Error("legacy KEC metadata is invalid");
      }

      return { clause };
    },
  },
  locator: testCodecs.locator,
};

export function createTempDatabase(prefix = "voltai-knowledge-"): {
  root: string;
  dbPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(root, ".voltai", "knowledge.sqlite");
  mkdirSync(join(root, ".voltai"), { recursive: true });
  tempRoots.push(root);
  return { root, dbPath };
}

export function cleanupTempDatabases(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function createChunk(
  locator: KnowledgeLocator,
  overrides: Partial<EmbeddedKnowledgeChunk<TestMetadata, KnowledgeLocator>> = {},
): EmbeddedKnowledgeChunk<TestMetadata, KnowledgeLocator> {
  return {
    chunkId: "company:standards/design.pdf#chunk=0",
    documentId: "company:standards/design.pdf",
    sourcePath: "standards/design.pdf",
    chunkIndex: 0,
    locator,
    metadata: { kind: "company-standard", clause: null },
    text: "Company grounding standard.",
    embedding: [1, 0],
    ...overrides,
  };
}

export function createLegacyDatabase(
  dbPath: string,
  options: { page?: number; userVersion?: number } = {},
): void {
  const database = new DatabaseSync(dbPath);
  const page = options.page ?? 3;

  database.exec(`
    CREATE TABLE kec_chunks (
      collection TEXT NOT NULL DEFAULT 'kec',
      id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      page INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      clause TEXT,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );

    CREATE TABLE index_metadata (
      id TEXT PRIMARY KEY,
      embedding_provider TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );
  `);
  database
    .prepare(`
      INSERT INTO kec_chunks (
        collection, id, source_path, page, chunk_index, clause, text, embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "kec",
      "legacy#page=3#chunk=2",
      "knowledge/legacy.pdf",
      page,
      2,
      "KEC 232.5",
      "Legacy cable requirement.",
      "[1,0]",
    );
  database
    .prepare(`
      INSERT INTO index_metadata (
        id, embedding_provider, embedding_model, dimensions, indexed_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      "kec",
      testIndexMetadata.embeddingProvider,
      testIndexMetadata.embeddingModel,
      testIndexMetadata.dimensions,
      testIndexMetadata.indexedAt,
    );
  database.exec(`PRAGMA user_version = ${options.userVersion ?? 0}`);
  database.close();
}

export { DatabaseSync };
