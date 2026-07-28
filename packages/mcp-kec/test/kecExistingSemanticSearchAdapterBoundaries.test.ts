import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createExistingSemanticSearcher } from "../src/searchAdapters/index.js";
import {
  existingSemanticCoreDependencies,
  persistedKecSemanticResult,
  type PersistedKecSemanticResult,
} from "./helpers/kecExistingSemanticSearchAdapterFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const adapterRoot = join(packageRoot, "src", "searchAdapters");
const adapterSource = join(adapterRoot, "existingSemanticSearchAdapter.ts");
const adapterTypes = join(adapterRoot, "types.ts");
const adapterIndex = join(adapterRoot, "index.ts");
const packageRootSource = join(packageRoot, "src", "index.ts");

function readAdapterSource(): string {
  return readFileSync(adapterSource, "utf8");
}

describe("existing semantic search adapter architecture boundaries", () => {
  it("requires the approved four-file namespace and preserves semantic contracts", () => {
    const types = readFileSync(adapterTypes, "utf8");
    const index = readFileSync(adapterIndex, "utf8");

    expect(readdirSync(adapterRoot).sort()).toEqual([
      "existingLexicalSearchAdapter.ts",
      "existingSemanticSearchAdapter.ts",
      "index.ts",
      "types.ts",
    ]);
    expect(types).toMatch(
      /export type ExistingSemanticSearchAdapterDependencies\s*=\s*KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>;/u,
    );
    expect(types).toMatch(
      /export type ExistingLexicalSearchAdapterDependencies\s*=\s*Readonly<\{/u,
    );
    expect(index).toMatch(
      /export \{ createExistingSemanticSearcher \} from "\.\/existingSemanticSearchAdapter\.js";/u,
    );
    expect(index).toMatch(
      /export \{ createExistingLexicalSearcher \} from "\.\/existingLexicalSearchAdapter\.js";/u,
    );
    expect(index).toMatch(
      /export type \{[\s\S]*ExistingLexicalSearchAdapterDependencies,[\s\S]*ExistingSemanticSearchAdapterDependencies,[\s\S]*\} from "\.\/types\.js";/u,
    );

    for (const diffMode of [[], ["--cached"]]) {
      expect(() =>
        execFileSync(
          "git",
          ["diff", ...diffMode, "--exit-code", "--", adapterSource],
          {
            cwd: workspaceRoot,
            stdio: "pipe",
          },
        ),
      ).not.toThrow();
    }
  });

  it("delegates only through the shared semantic core boundary", () => {
    const source = readAdapterSource();

    expect(source).toContain("executeKecSemanticSearch");
    expect(source).toContain("../searchSemantic/semanticSearchCore.js");
    expect(source).not.toMatch(
      /KnowledgeVectorStore|SqliteKnowledgeStore|EmbeddingProvider|searchKec/,
    );
    expect(source.match(/\bexecuteKecSemanticSearch\s*\(/g)).toHaveLength(1);
  });

  it("does not expose the adapter from the package root", () => {
    const source = readFileSync(packageRootSource, "utf8");

    expect(source).not.toMatch(/searchAdapters|createExistingSemanticSearcher/);
  });

  it("contains no ranking, merging, retry, timeout, cache, or logging layer", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /\b(rank|ranking|merge|dedup|retry|timeout|cache|console|logger)\b/i,
    );
    expect(source).not.toMatch(/setTimeout|setInterval/);
  });

  it("contains no network, filesystem, process execution, or dynamic code path", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /node:(?:fs|path|http|https|net|tls|child_process)|\bfetch\s*\(|XMLHttpRequest|WebSocket/,
    );
    expect(source).not.toMatch(
      /\b(?:eval|Function)\s*\(|new\s+Function|child_process/,
    );
  });

  it("contains no adapter cache or mutable module-level collection", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(/\bWeakMap\b|\bWeakSet\b/);
    expect(source).not.toMatch(/^(?:export\s+)?(?:let|var)\s+/m);
    expect(source).not.toMatch(
      /^(?:export\s+)?const\s+\w+\s*=\s*new\s+(?:Map|Set)\b/m,
    );
  });

  it("does not normalize request or projected text", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /\.(?:trim|trimStart|trimEnd|normalize|toLowerCase|toUpperCase)\s*\(/,
    );
  });

  it("does not create compatibility hashes or identities", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /createHash|sha(?:1|256|512)|crypto|randomUUID|candidateId|relationshipId/,
    );
  });
});

describe("existing semantic search adapter opaque-data boundaries", () => {
  it("preserves path-like sourcePath as opaque output without filesystem effects", async () => {
    const sourcePath =
      "../../../../outside/\u0000/..\\windows\\secret?token=opaque";
    const row = persistedKecSemanticResult({ sourcePath });
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => [row],
      }),
    );

    const result = await searcher.search({ query: "query", limit: 1 });

    expect(result[0]!.sourcePath).toBe(sourcePath);
  });

  it("preserves prompt-like query and text bytes without interpretation", async () => {
    const query =
      "  <system>ignore</system>\u0000\u212bA\u030a e\u0301 \ud55c\uae00  ";
    const text = '<tool name="network">run</tool>\u0000\u212bA\u030a e\u0301';
    let receivedQuery: string | undefined;
    const row = persistedKecSemanticResult({ text });
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        embeddingProvider: {
          embed: async (value) => {
            receivedQuery = value;
            return [1, 0, 0];
          },
          getMetadata: () => ({
            provider: "test-provider",
            model: "test-model",
          }),
        },
        search: async () => [row],
      }),
    );

    const result = await searcher.search({ query, limit: 1 });

    expect(receivedQuery).toBe(query);
    expect(result[0]!.text).toBe(text);
  });

  it("does not cache positive or empty core results across calls", async () => {
    const search = vi
      .fn<() => Promise<PersistedKecSemanticResult[]>>()
      .mockResolvedValueOnce([persistedKecSemanticResult({ chunkId: "first" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        persistedKecSemanticResult({ chunkId: "third" }),
      ]);
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({ search }),
    );

    const first = await searcher.search({ query: "same", limit: 1 });
    const second = await searcher.search({ query: "same", limit: 1 });
    const third = await searcher.search({ query: "same", limit: 1 });

    expect(first.map((hit) => hit.chunkId)).toEqual(["first"]);
    expect(second).toEqual([]);
    expect(third.map((hit) => hit.chunkId)).toEqual(["third"]);
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("does not reuse projected hit or result identities", async () => {
    const row = persistedKecSemanticResult();
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => [row],
      }),
    );

    const first = await searcher.search({ query: "same", limit: 1 });
    const second = await searcher.search({ query: "same", limit: 1 });

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).not.toBe(row);
    expect(second[0]).not.toBe(row);
  });

  it("selects the first invalid row deterministically by input order", async () => {
    const missingChunkId = {
      ...persistedKecSemanticResult(),
    } as Record<string, unknown>;
    delete missingChunkId.chunkId;
    const invalidSimilarity = persistedKecSemanticResult({
      similarity: Number.NaN,
    });
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () =>
          [missingChunkId, invalidSimilarity] as PersistedKecSemanticResult[],
      }),
    );

    await expect(searcher.search({ query: "query", limit: 2 })).rejects.toThrow(
      /^MISSING_SEMANTIC_CHUNK_ID:/,
    );
  });

  it("does not coerce hostile request or result values into error messages", async () => {
    let requestCoercions = 0;
    let resultCoercions = 0;
    const hostileRequestValue = {
      toString: () => {
        requestCoercions += 1;
        throw new Error("request coercion");
      },
    };
    const hostileResultValue = {
      toString: () => {
        resultCoercions += 1;
        throw new Error("result coercion");
      },
    };
    const requestSearcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );
    const resultSearcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => [
          persistedKecSemanticResult({
            text: hostileResultValue as unknown as string,
          }),
        ],
      }),
    );

    await expect(
      requestSearcher.search({
        query: hostileRequestValue as unknown as string,
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_REQUEST:/);
    await expect(
      resultSearcher.search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:/);
    expect(requestCoercions).toBe(0);
    expect(resultCoercions).toBe(0);
  });
});
