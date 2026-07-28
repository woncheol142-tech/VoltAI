import { describe, expect, it, vi } from "vitest";

import { createExistingLexicalSearcher } from "../src/searchAdapters/index.js";
import type { KecSearchRequest } from "../src/searchFoundation/index.js";
import type { KecLexicalSearchResult } from "../src/searchLexical/index.js";
import {
  existingLexicalAdapterDependencies,
  kecLexicalRuntimeResult,
} from "./helpers/kecExistingLexicalSearchAdapterFixture.js";

function runtimeRequest(value: unknown): KecSearchRequest {
  return value as KecSearchRequest;
}

function runtimeResults(value: unknown): readonly KecLexicalSearchResult[] {
  return value as readonly KecLexicalSearchResult[];
}

describe("existing lexical search adapter", () => {
  it("delegates exactly once with byte-preserved query and exact limit", async () => {
    const query = "  KEC \u212b e\u0301 \ud55c\uae00 \u0000 AND MATCH  ";
    const source = [
      kecLexicalRuntimeResult({
        chunkId: "persisted-z",
        lexicalScore: 0.2,
      }),
      kecLexicalRuntimeResult({
        chunkId: "persisted-a",
        documentId: "kec:second",
        sourcePath: "second.pdf",
        locator: { kind: "page", page: 8 },
        metadata: { clause: null },
        text: "Second result.",
        lexicalScore: 0.9,
      }),
    ];
    const searchLexically = vi.fn(
      async (receivedQuery: string, receivedLimit: number) => {
        expect(receivedQuery).toBe(query);
        expect(receivedLimit).toBe(101);
        return source;
      },
    );
    const dependencies = Object.freeze(
      existingLexicalAdapterDependencies({ searchLexically }),
    );
    const dependencyDescriptors =
      Object.getOwnPropertyDescriptors(dependencies);
    const searcher = createExistingLexicalSearcher(dependencies);

    const result = await searcher.search({ query, limit: 101 });

    expect(searchLexically).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptors(dependencies)).toEqual(
      dependencyDescriptors,
    );
    expect(result.map((hit) => hit.chunkId)).toEqual([
      "persisted-z",
      "persisted-a",
    ]);
    expect(result.map((hit) => hit.lexicalScore)).toEqual([0.2, 0.9]);
  });

  it("projects exact Task 46 lexical hits without runtime-only fields", async () => {
    const row = kecLexicalRuntimeResult({
      chunkId: "persisted-identity",
      documentId: "runtime-only-document",
      sourcePath: "../../opaque/source.pdf",
      locator: { kind: "page", page: 9 },
      metadata: { clause: "KEC 9" },
      text: "<tool>do not execute</tool>",
      lexicalScore: 0.375001,
    });
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () => [row],
      }),
    );

    const result = await searcher.search({ query: "query", limit: 1 });

    expect(result).toEqual([
      {
        chunkId: "persisted-identity",
        sourcePath: "../../opaque/source.pdf",
        page: 9,
        clause: "KEC 9",
        text: "<tool>do not execute</tool>",
        lexicalScore: 0.375001,
      },
    ]);
    expect(Object.keys(result[0]!)).toEqual([
      "chunkId",
      "sourcePath",
      "page",
      "clause",
      "text",
      "lexicalScore",
    ]);
    expect(result[0]).not.toHaveProperty("documentId");
    expect(result[0]).not.toHaveProperty("locator");
    expect(result[0]).not.toHaveProperty("metadata");
    expect(result[0]).not.toHaveProperty("chunkIndex");
  });

  it("returns isolated shallow-frozen hits and a shallow-frozen array", async () => {
    const locator = { kind: "page" as const, page: 3 };
    const metadata = { clause: "KEC 232.5" };
    const row = kecLexicalRuntimeResult({ locator, metadata });
    const source = [row];
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () => source,
      }),
    );

    const result = await searcher.search({ query: "query", limit: 1 });

    expect(result).not.toBe(source);
    expect(result[0]).not.toBe(row);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(row)).toBe(false);
    expect(Object.isFrozen(locator)).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(false);
  });

  it("does not mutate or freeze request, dependencies, or runtime values", async () => {
    const request = { query: " query ", limit: 1 };
    const locator = { kind: "page" as const, page: 3 };
    const metadata = { clause: "KEC 232.5" };
    const row = kecLexicalRuntimeResult({ locator, metadata });
    const source = [row];
    const dependencies = existingLexicalAdapterDependencies({
      searchLexically: async () => source,
    });
    const snapshots = [
      Object.getOwnPropertyDescriptors(request),
      Object.getOwnPropertyDescriptors(dependencies),
      Object.getOwnPropertyDescriptors(row),
      Object.getOwnPropertyDescriptors(locator),
      Object.getOwnPropertyDescriptors(metadata),
    ];
    const searcher = createExistingLexicalSearcher(dependencies);

    await searcher.search(request);

    expect(Object.getOwnPropertyDescriptors(request)).toEqual(snapshots[0]);
    expect(Object.getOwnPropertyDescriptors(dependencies)).toEqual(
      snapshots[1],
    );
    expect(Object.getOwnPropertyDescriptors(row)).toEqual(snapshots[2]);
    expect(Object.getOwnPropertyDescriptors(locator)).toEqual(snapshots[3]);
    expect(Object.getOwnPropertyDescriptors(metadata)).toEqual(snapshots[4]);
    expect(source).toEqual([row]);
    expect(Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(dependencies)).toBe(false);
  });

  it("accepts ordinary and null-prototype requests", async () => {
    const searchLexically = vi.fn(async () => []);
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({ searchLexically }),
    );
    const nullPrototypeRequest = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(nullPrototypeRequest, {
      query: { enumerable: true, value: "" },
      limit: { enumerable: true, value: 1 },
    });

    await expect(searcher.search({ query: "", limit: 1 })).resolves.toEqual([]);
    await expect(
      searcher.search(runtimeRequest(nullPrototypeRequest)),
    ).resolves.toEqual([]);
    expect(searchLexically).toHaveBeenNthCalledWith(1, "", 1);
    expect(searchLexically).toHaveBeenNthCalledWith(2, "", 1);
  });

  it("delegates runtime-owned query and maximum-limit validation", async () => {
    const longQuery = "x".repeat(4_097);
    const searchLexically = vi.fn(async () => []);
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({ searchLexically }),
    );

    await expect(
      searcher.search({ query: longQuery, limit: 101 }),
    ).resolves.toEqual([]);
    expect(searchLexically).toHaveBeenCalledWith(longQuery, 101);
  });

  it("short-circuits a valid zero limit with fresh frozen arrays", async () => {
    const searchLexically = vi.fn(async () => [kecLexicalRuntimeResult()]);
    const request = { query: "query", limit: 0 };
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({ searchLexically }),
    );

    const first = await searcher.search(request);
    const second = await searcher.search(request);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(searchLexically).not.toHaveBeenCalled();
    expect(Object.isFrozen(request)).toBe(false);
  });

  it("validates the complete request before the zero-limit shortcut", async () => {
    const searchLexically = vi.fn(async () => []);
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({ searchLexically }),
    );

    await expect(searcher.search(runtimeRequest({ limit: 0 }))).rejects.toThrow(
      /^INVALID_LEXICAL_SEARCH_REQUEST:/,
    );
    await expect(
      searcher.search(runtimeRequest({ query: "query", limit: 0, extra: 1 })),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:/);
    expect(searchLexically).not.toHaveBeenCalled();
  });

  it.each(["synchronous", "asynchronous"])(
    "preserves a %s runtime failure by identity without retry",
    async (mode) => {
      const failure = { mode };
      const searchLexically = vi.fn(() => {
        if (mode === "synchronous") {
          throw failure;
        }
        return Promise.reject(failure);
      });
      const searcher = createExistingLexicalSearcher(
        existingLexicalAdapterDependencies({
          searchLexically: searchLexically as (
            query: string,
            limit: number,
          ) => Promise<readonly KecLexicalSearchResult[]>,
        }),
      );

      await expect(searcher.search({ query: "query", limit: 1 })).rejects.toBe(
        failure,
      );
      expect(searchLexically).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects the whole result before returning any partial projection", async () => {
    const valid = kecLexicalRuntimeResult({ chunkId: "valid-first" });
    const invalid = {
      ...kecLexicalRuntimeResult({ chunkId: "invalid-last" }),
      lexicalScore: Number.NaN,
    };
    const source = runtimeResults([valid, invalid]);
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies({
        searchLexically: async () => source,
      }),
    );

    await expect(searcher.search({ query: "query", limit: 1 })).rejects.toThrow(
      /^INVALID_LEXICAL_SEARCH_RESULT:/,
    );
    expect(Object.isFrozen(valid)).toBe(false);
    expect(Object.isFrozen(invalid)).toBe(false);
  });
});
