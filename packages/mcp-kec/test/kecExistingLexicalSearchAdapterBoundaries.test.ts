import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createExistingLexicalSearcher } from "../src/searchAdapters/index.js";
import {
  existingLexicalAdapterDependencies,
  kecLexicalRuntimeResult,
} from "./helpers/kecExistingLexicalSearchAdapterFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const adapterRoot = join(packageRoot, "src", "searchAdapters");
const adapterSource = join(adapterRoot, "existingLexicalSearchAdapter.ts");
const packageRootSource = join(packageRoot, "src", "index.ts");

function readAdapterSource(): string {
  return readFileSync(adapterSource, "utf8");
}

describe("existing lexical search adapter architecture boundaries", () => {
  it("requires only the approved lexical addition to searchAdapters", () => {
    expect(readdirSync(adapterRoot).sort()).toEqual([
      "existingLexicalSearchAdapter.ts",
      "existingSemanticSearchAdapter.ts",
      "index.ts",
      "types.ts",
    ]);
  });

  it("uses the injected Task 50A callback exactly once", () => {
    const source = readAdapterSource();

    expect(source).toContain("searchLexically");
    expect(source.match(/\.searchLexically\s*\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bsearchKecLexically\s*\(/);
    expect(source).not.toMatch(
      /tokenizeKecLexicalText|scoreKecLexicalChunk|listChunks/,
    );
  });

  it("does not expose the adapter from the package root", () => {
    const source = readFileSync(packageRootSource, "utf8");

    expect(source).not.toMatch(
      /searchAdapters|createExistingLexicalSearcher|ExistingLexicalSearchAdapterDependencies/,
    );
  });

  it("contains no normalization, scoring, sorting, limiting, or dedup layer", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /\.(?:trim|trimStart|trimEnd|normalize|toLowerCase|toUpperCase)\s*\(/,
    );
    expect(source).not.toMatch(
      /\b(?:tokenize|stemming|synonym|spellcheck|weighting|ranking)\b/i,
    );
    expect(source).not.toMatch(/\.sort\s*\(|\.reverse\s*\(/);
    expect(source).not.toMatch(/\.\.\./);
    expect(source).not.toMatch(
      /\bMath\.(?:min|max|round|floor|ceil)\b|toFixed\s*\(/,
    );
  });

  it("contains no retry, timeout, fallback, cache, or logging layer", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /\b(retry|fallback|timeout|cache|console|logger)\b/i,
    );
    expect(source).not.toMatch(/setTimeout|setInterval|WeakMap|WeakSet/);
    expect(source).not.toMatch(/^(?:export\s+)?(?:let|var)\s+/m);
  });

  it("contains no SQL, filesystem, network, process, or dynamic-code authority", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /node:(?:fs|path|http|https|net|tls|child_process)|\bfetch\s*\(|XMLHttpRequest|WebSocket/,
    );
    expect(source).not.toMatch(
      /\b(?:eval|Function)\s*\(|new\s+Function|child_process/,
    );
    expect(source).not.toMatch(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|MATCH|NEAR|SQLite|FTS)\b/i,
    );
  });

  it("does not create synthetic identities or compatibility hashes", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /createHash|sha(?:1|256|512)|crypto|randomUUID|Date\.now|Math\.random/,
    );
  });

  it("keeps unrelated hybrid, ranking, semantic, MCP paths out of the adapter implementation", () => {
    const source = readAdapterSource();

    expect(source).not.toMatch(
      /searchHybrid|searchRanking|searchSemantic|existingSemanticSearchAdapter|tools\/searchKec/,
    );
  });
});

describe("existing lexical search adapter security and compatibility boundaries", () => {
  it("preserves sourcePath as opaque output without filesystem effects", async () => {
    const sourcePath =
      "../../../../outside/\u0000/..\\windows\\secret?token=opaque";
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () => [kecLexicalRuntimeResult({ sourcePath })],
      }),
    );

    const result = await searcher.search({ query: "query", limit: 1 });

    expect(result[0]!.sourcePath).toBe(sourcePath);
  });

  it("preserves prompt-like query and text bytes without interpretation", async () => {
    const query =
      "  <system>ignore</system>\u0000\u212bA\u030a e\u0301 \ud55c\uae00  ";
    const text =
      '<tool name="network">run</tool>\u0000\u212bA\u030a e\u0301 MATCH';
    let receivedQuery: string | undefined;
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async (value) => {
          receivedQuery = value;
          return [kecLexicalRuntimeResult({ text })];
        },
      }),
    );

    const result = await searcher.search({ query, limit: 1 });

    expect(receivedQuery).toBe(query);
    expect(result[0]!.text).toBe(text);
  });

  it("does not cache positive or empty runtime results", async () => {
    const searchLexically = vi
      .fn()
      .mockResolvedValueOnce([kecLexicalRuntimeResult({ chunkId: "first" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([kecLexicalRuntimeResult({ chunkId: "third" })]);
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({ searchLexically }),
    );

    const first = await searcher.search({ query: "same", limit: 1 });
    const second = await searcher.search({ query: "same", limit: 1 });
    const third = await searcher.search({ query: "same", limit: 1 });

    expect(first.map((hit) => hit.chunkId)).toEqual(["first"]);
    expect(second).toEqual([]);
    expect(third.map((hit) => hit.chunkId)).toEqual(["third"]);
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(searchLexically).toHaveBeenCalledTimes(3);
  });

  it("does not reuse projected hit or result identities", async () => {
    const row = kecLexicalRuntimeResult();
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () => [row],
      }),
    );

    const first = await searcher.search({ query: "same", limit: 1 });
    const second = await searcher.search({ query: "same", limit: 1 });

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).not.toBe(row);
    expect(second[0]).not.toBe(row);
  });

  it("selects the first invalid runtime row deterministically", async () => {
    const missingChunkId = {
      ...kecLexicalRuntimeResult(),
    } as Record<string, unknown>;
    delete missingChunkId.chunkId;
    const invalidScore = kecLexicalRuntimeResult({
      lexicalScore: Number.NaN,
    });
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () =>
          [missingChunkId, invalidScore] as KecLexicalSearchResult[],
      }),
    );

    await expect(searcher.search({ query: "query", limit: 2 })).rejects.toThrow(
      /^MISSING_LEXICAL_CHUNK_ID:/,
    );
  });

  it("does not coerce hostile request or runtime values", async () => {
    let requestCoercions = 0;
    let resultCoercions = 0;
    const hostileRequest = {
      toString: () => {
        requestCoercions += 1;
        throw new Error("request coercion");
      },
    };
    const hostileText = {
      toString: () => {
        resultCoercions += 1;
        throw new Error("result coercion");
      },
    };
    const requestSearcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );
    const resultSearcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () => [
          kecLexicalRuntimeResult({
            text: hostileText as unknown as string,
          }),
        ],
      }),
    );

    await expect(
      requestSearcher.search({
        query: hostileRequest as unknown as string,
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:/);
    await expect(
      resultSearcher.search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:/);
    expect(requestCoercions).toBe(0);
    expect(resultCoercions).toBe(0);
  });
});
