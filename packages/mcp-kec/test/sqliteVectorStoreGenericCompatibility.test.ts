import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteVectorStore } from "../src/knowledge/sqliteVectorStore.js";
import type { EmbeddedKecChunk } from "../src/knowledge/vectorStore.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
const tempRoots: string[] = [];

function createDatabase(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-generic-wrapper-"));
  const dbPath = join(root, ".voltai", "kec.sqlite");
  mkdirSync(join(root, ".voltai"), { recursive: true });
  tempRoots.push(root);
  return { root, dbPath };
}

function kecChunk(): EmbeddedKecChunk {
  return {
    id: "knowledge/kec.pdf#page=3#chunk=2",
    sourcePath: "knowledge/kec.pdf",
    page: 3,
    chunkIndex: 2,
    clause: "KEC 232.5",
    text: "Cable sizing requirement.",
    embedding: [1, 0],
  };
}

describe("SqliteVectorStore KEC compatibility wrapper", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores canonical generic columns and KEC legacy projections together", async () => {
    const { dbPath } = createDatabase();
    const store = new SqliteVectorStore(dbPath);
    const chunk = kecChunk();

    await store.upsert("kec", [chunk]);
    await store.close();

    const database = new DatabaseSync(dbPath);
    const row = database
      .prepare(
        "SELECT id, document_id, locator_json, metadata_json, page, clause FROM kec_chunks",
      )
      .get() as Record<string, unknown>;
    database.close();

    expect(row).toMatchObject({
      id: chunk.id,
      document_id: "kec:knowledge/kec.pdf",
      page: 3,
      clause: "KEC 232.5",
    });
    expect(JSON.parse(String(row.locator_json))).toEqual({ kind: "page", page: 3 });
    expect(JSON.parse(String(row.metadata_json))).toEqual({ clause: "KEC 232.5" });
  });

  it("keeps KecSearchResult and search_kec JSON byte-identical", async () => {
    const { dbPath } = createDatabase();
    const store = new SqliteVectorStore(dbPath);
    const chunk = kecChunk();
    await store.upsert("kec", [chunk]);

    const results = await store.search("kec", [1, 0], 5);
    await store.close();

    expect(results).toEqual([
      {
        clause: chunk.clause,
        page: chunk.page,
        text: chunk.text,
        similarity: 1,
        sourcePath: chunk.sourcePath,
      },
    ]);
    expect(JSON.stringify({ results })).toBe(
      JSON.stringify({
        results: [
          {
            clause: "KEC 232.5",
            page: 3,
            text: "Cable sizing requirement.",
            similarity: 1,
            sourcePath: "knowledge/kec.pdf",
          },
        ],
      }),
    );
  });

  it("uses the real SQLite id on the generic search path instead of the synthetic fallback", async () => {
    const { dbPath } = createDatabase();
    const wrapper = new SqliteVectorStore(dbPath);
    const chunk = kecChunk();
    await wrapper.upsert("kec", [chunk]);
    await wrapper.close();
    const [{ SqliteKnowledgeStore }, { kecKnowledgeCodecs }] = await Promise.all([
      import("@voltai/knowledge-sqlite"),
      import("../src/knowledge/kecKnowledgeAdapter.js"),
    ]);
    const genericStore = new SqliteKnowledgeStore(dbPath);

    const [result] = await genericStore.search("kec", [1, 0], 5, kecKnowledgeCodecs);
    await genericStore.close();

    expect(result.chunkId).toBe(chunk.id);
  });
});
