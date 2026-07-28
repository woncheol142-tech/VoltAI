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

function searcherReturning(value: unknown) {
  return createExistingLexicalSearcher(
    existingLexicalAdapterDependencies({
      searchLexically: async () => runtimeResults(value),
    }),
  );
}

function cloneRow(
  overrides: Record<string, unknown> = {},
): Record<PropertyKey, unknown> {
  return {
    ...kecLexicalRuntimeResult(),
    ...overrides,
  };
}

class CustomRequest {
  query = "query";
  limit = 1;
}

class CustomResult {
  chunkId = "persisted";
  documentId = "kec:document";
  sourcePath = "knowledge/kec.pdf";
  locator = { kind: "page", page: 1 };
  metadata = { clause: null };
  text = "text";
  lexicalScore = 1;
}

describe("existing lexical search adapter request security", () => {
  it.each([
    { name: "null", value: null },
    { name: "primitive", value: "query" },
    { name: "array", value: ["query", 1] },
    { name: "function", value: () => ({ query: "query", limit: 1 }) },
    { name: "Date", value: new Date(0) },
    { name: "Map", value: new Map([["query", "query"]]) },
    { name: "Set", value: new Set(["query"]) },
    { name: "class instance", value: new CustomRequest() },
    {
      name: "custom prototype",
      value: Object.assign(Object.create({ marker: true }), {
        query: "query",
        limit: 1,
      }),
    },
  ])("rejects a $name request container", async ({ value }) => {
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );

    await expect(searcher.search(runtimeRequest(value))).rejects.toThrow(
      /^INVALID_LEXICAL_SEARCH_REQUEST:.*plain object/,
    );
  });

  it.each([
    { name: "missing query", value: { limit: 1 }, field: "query" },
    { name: "missing limit", value: { query: "query" }, field: "limit" },
  ])("rejects $name as an own-property violation", async ({ value, field }) => {
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );

    await expect(searcher.search(runtimeRequest(value))).rejects.toThrow(
      new RegExp(`^INVALID_LEXICAL_SEARCH_REQUEST:.*${field}`),
    );
  });

  it.each(["extra", "__proto__", "constructor", "prototype"])(
    "rejects the %s own string key before symbols or descriptors",
    async (key) => {
      let queryGetterCalls = 0;
      const request = { limit: 1 } as Record<PropertyKey, unknown>;
      Object.defineProperty(request, "query", {
        enumerable: true,
        get: () => {
          queryGetterCalls += 1;
          return "query";
        },
      });
      Object.defineProperty(request, key, {
        configurable: true,
        enumerable: true,
        value: "hostile",
      });
      request[Symbol("hostile")] = true;
      const searcher = createExistingLexicalSearcher(
        existingLexicalAdapterDependencies(),
      );

      await expect(searcher.search(runtimeRequest(request))).rejects.toThrow(
        /^INVALID_LEXICAL_SEARCH_REQUEST:.*own string key/,
      );
      expect(queryGetterCalls).toBe(0);
      expect(Object.prototype).not.toHaveProperty("hostile");
    },
  );

  it("rejects symbols before reading request descriptors", async () => {
    let queryGetterCalls = 0;
    const request = { limit: 1 } as Record<PropertyKey, unknown>;
    Object.defineProperty(request, "query", {
      enumerable: true,
      get: () => {
        queryGetterCalls += 1;
        return "query";
      },
    });
    request[Symbol("hostile")] = true;
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );

    await expect(searcher.search(runtimeRequest(request))).rejects.toThrow(
      /^INVALID_LEXICAL_SEARCH_REQUEST:.*symbol/,
    );
    expect(queryGetterCalls).toBe(0);
  });

  it("rejects inherited query and limit fields", async () => {
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );
    const originalQuery = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "query",
    );
    const originalLimit = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "limit",
    );

    try {
      Object.defineProperty(Object.prototype, "query", {
        configurable: true,
        value: "inherited",
      });
      await expect(
        searcher.search(runtimeRequest({ limit: 1 })),
      ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:.*query/);
      delete (Object.prototype as Record<string, unknown>).query;

      Object.defineProperty(Object.prototype, "limit", {
        configurable: true,
        value: 1,
      });
      await expect(
        searcher.search(runtimeRequest({ query: "query" })),
      ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:.*limit/);
    } finally {
      if (originalQuery) {
        Object.defineProperty(Object.prototype, "query", originalQuery);
      } else {
        delete (Object.prototype as Record<string, unknown>).query;
      }
      if (originalLimit) {
        Object.defineProperty(Object.prototype, "limit", originalLimit);
      } else {
        delete (Object.prototype as Record<string, unknown>).limit;
      }
    }
  });

  it("rejects accessors and setter-only request fields without execution", async () => {
    let queryGetterCalls = 0;
    let limitGetterCalls = 0;
    const queryAccessor = { limit: 1 };
    Object.defineProperty(queryAccessor, "query", {
      enumerable: true,
      get: () => {
        queryGetterCalls += 1;
        return "query";
      },
    });
    const limitAccessor = { query: "query" };
    Object.defineProperty(limitAccessor, "limit", {
      enumerable: true,
      get: () => {
        limitGetterCalls += 1;
        return 1;
      },
    });
    const setterOnly = { query: "query" };
    Object.defineProperty(setterOnly, "limit", {
      enumerable: true,
      set: () => {},
    });
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );

    await expect(
      searcher.search(runtimeRequest(queryAccessor)),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:.*query/);
    await expect(
      searcher.search(runtimeRequest(limitAccessor)),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:.*limit/);
    await expect(searcher.search(runtimeRequest(setterOnly))).rejects.toThrow(
      /^INVALID_LEXICAL_SEARCH_REQUEST:.*limit/,
    );
    expect(queryGetterCalls).toBe(0);
    expect(limitGetterCalls).toBe(0);
  });

  it.each([
    { name: "numeric", value: 1 },
    { name: "null", value: null },
    { name: "symbol", value: Symbol("query") },
    {
      name: "coercible",
      value: {
        toString: () => {
          throw new Error("must not coerce query");
        },
      },
    },
  ])("rejects a $name query without coercion", async ({ value }) => {
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );

    await expect(
      searcher.search(runtimeRequest({ query: value, limit: 1 })),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:.*query/);
  });

  it.each([
    { name: "numeric string", value: "1" },
    { name: "bigint", value: 1n },
    { name: "NaN", value: Number.NaN },
    { name: "Infinity", value: Number.POSITIVE_INFINITY },
    { name: "fractional", value: 1.5 },
    { name: "negative", value: -1 },
    { name: "unsafe integer", value: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects a $name limit without coercion", async ({ value }) => {
    const searcher = createExistingLexicalSearcher(
      existingLexicalAdapterDependencies(),
    );

    await expect(
      searcher.search(runtimeRequest({ query: "query", limit: value })),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_REQUEST:.*limit/);
  });

  it("does not validate, clone, or freeze trusted dependency objects", async () => {
    const searchLexically = vi.fn(async () => []);
    const dependencies = Object.assign(
      Object.create({ inheritedTrustedMarker: true }),
      { searchLexically, extraTrustedMarker: true },
    );
    const searcher = createExistingLexicalSearcher(dependencies);

    await expect(
      searcher.search({ query: "query", limit: 1 }),
    ).resolves.toEqual([]);
    expect(searchLexically).toHaveBeenCalledTimes(1);
    expect(Object.getPrototypeOf(dependencies)).not.toBe(Object.prototype);
    expect(Object.isFrozen(dependencies)).toBe(false);
  });
});

describe("existing lexical search adapter result-array security", () => {
  it.each([
    { name: "null", value: null },
    { name: "plain object", value: { 0: kecLexicalRuntimeResult() } },
    { name: "string", value: "result" },
  ])("rejects a non-array $name result", async ({ value }) => {
    await expect(
      searcherReturning(value).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*array/);
  });

  it("rejects symbols before reading array indices", async () => {
    let indexGetterCalls = 0;
    const results: unknown[] = [];
    results.length = 1;
    Object.defineProperty(results, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        indexGetterCalls += 1;
        return kecLexicalRuntimeResult();
      },
    });
    results[Symbol("hostile")] = true;

    await expect(
      searcherReturning(results).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*symbol/);
    expect(indexGetterCalls).toBe(0);
  });

  it.each(["extra", "01", "-1", "1.0"])(
    "rejects the noncanonical own array key %s",
    async (key) => {
      const results = [kecLexicalRuntimeResult()] as unknown[] &
        Record<string, unknown>;
      Object.defineProperty(results, key, {
        configurable: true,
        enumerable: true,
        value: true,
      });

      await expect(
        searcherReturning(results).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*array key/);
    },
  );

  it("rejects sparse, inherited, accessor, and setter-only indices safely", async () => {
    const sparse = new Array<KecLexicalSearchResult>(2);
    sparse[1] = kecLexicalRuntimeResult();
    let inheritedGetterCalls = 0;
    const inheritedArrayPrototype = Object.create(Array.prototype);
    Object.defineProperty(inheritedArrayPrototype, "0", {
      configurable: true,
      get: () => {
        inheritedGetterCalls += 1;
        return kecLexicalRuntimeResult();
      },
    });
    const inherited = new Array<KecLexicalSearchResult>(1);
    Object.setPrototypeOf(inherited, inheritedArrayPrototype);
    let indexGetterCalls = 0;
    const accessor: unknown[] = [];
    accessor.length = 1;
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get: () => {
        indexGetterCalls += 1;
        return kecLexicalRuntimeResult();
      },
    });
    const setterOnly: unknown[] = [];
    setterOnly.length = 1;
    Object.defineProperty(setterOnly, "0", {
      enumerable: true,
      set: () => {},
    });

    await expect(
      searcherReturning(sparse).search({ query: "query", limit: 2 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*dense/);
    await expect(
      searcherReturning(inherited).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*dense/);
    await expect(
      searcherReturning(accessor).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*data descriptor/);
    await expect(
      searcherReturning(setterOnly).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*data descriptor/);
    expect(inheritedGetterCalls).toBe(0);
    expect(indexGetterCalls).toBe(0);
  });
});

describe("existing lexical search adapter runtime-row security", () => {
  it("accepts null-prototype rows and nested records", async () => {
    const locator = Object.assign(Object.create(null), {
      kind: "page",
      page: 3,
    });
    const metadata = Object.assign(Object.create(null), {
      clause: "KEC 232.5",
    });
    const row = Object.assign(Object.create(null), {
      chunkId: "persisted-null-prototype",
      documentId: "kec:document",
      sourcePath: "knowledge/kec.pdf",
      locator,
      metadata,
      text: "text",
      lexicalScore: 0.5,
    });

    await expect(
      searcherReturning([row]).search({ query: "query", limit: 1 }),
    ).resolves.toEqual([
      {
        chunkId: "persisted-null-prototype",
        sourcePath: "knowledge/kec.pdf",
        page: 3,
        clause: "KEC 232.5",
        text: "text",
        lexicalScore: 0.5,
      },
    ]);
  });

  it.each([
    { name: "null", row: null },
    { name: "array", row: [] },
    { name: "class instance", row: new CustomResult() },
    {
      name: "custom prototype",
      row: Object.assign(Object.create({ marker: true }), cloneRow()),
    },
  ])("rejects a $name row container", async ({ row }) => {
    await expect(
      searcherReturning([row]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*plain object/);
  });

  it("rejects row extra keys and symbols before reading fields", async () => {
    let chunkIdGetterCalls = 0;
    const extraRow = cloneRow({ extra: true });
    Object.defineProperty(extraRow, "chunkId", {
      configurable: true,
      enumerable: true,
      get: () => {
        chunkIdGetterCalls += 1;
        return "persisted";
      },
    });
    const symbolRow = cloneRow();
    symbolRow[Symbol("hostile")] = true;

    await expect(
      searcherReturning([extraRow]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*own string key/);
    await expect(
      searcherReturning([symbolRow]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*symbol/);
    expect(chunkIdGetterCalls).toBe(0);
  });

  it.each([
    { name: "missing", value: undefined, mode: "missing" },
    { name: "empty", value: "", mode: "value" },
    { name: "number", value: 1, mode: "value" },
    { name: "null", value: null, mode: "value" },
  ])(
    "reports a $name chunkId with the dedicated prefix",
    async ({ value, mode }) => {
      const row = cloneRow();
      if (mode === "missing") {
        delete row.chunkId;
      } else {
        row.chunkId = value;
      }

      await expect(
        searcherReturning([row]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_LEXICAL_CHUNK_ID:/);
    },
  );

  it("rejects accessor, setter-only, and inherited chunkIds without getters", async () => {
    let accessorCalls = 0;
    const accessorRow = cloneRow();
    Object.defineProperty(accessorRow, "chunkId", {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return "persisted";
      },
    });
    const setterRow = cloneRow();
    Object.defineProperty(setterRow, "chunkId", {
      configurable: true,
      enumerable: true,
      set: () => {},
    });
    const inheritedRow = cloneRow();
    delete inheritedRow.chunkId;
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "chunkId",
    );
    Object.defineProperty(Object.prototype, "chunkId", {
      configurable: true,
      value: "inherited",
    });

    try {
      await expect(
        searcherReturning([accessorRow]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_LEXICAL_CHUNK_ID:/);
      await expect(
        searcherReturning([setterRow]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_LEXICAL_CHUNK_ID:/);
      await expect(
        searcherReturning([inheritedRow]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_LEXICAL_CHUNK_ID:/);
      expect(accessorCalls).toBe(0);
    } finally {
      if (original) {
        Object.defineProperty(Object.prototype, "chunkId", original);
      } else {
        delete (Object.prototype as Record<string, unknown>).chunkId;
      }
    }
  });

  it.each([
    { field: "documentId", value: 1 },
    { field: "sourcePath", value: null },
    {
      field: "text",
      value: {
        toString: () => {
          throw new Error("must not coerce text");
        },
      },
    },
    { field: "lexicalScore", value: Number.NaN },
    { field: "lexicalScore", value: Number.POSITIVE_INFINITY },
    { field: "lexicalScore", value: Number.NEGATIVE_INFINITY },
    { field: "lexicalScore", value: 0 },
    { field: "lexicalScore", value: -0 },
    { field: "lexicalScore", value: -0.1 },
    { field: "lexicalScore", value: 1.000001 },
  ])("rejects invalid $field values", async ({ field, value }) => {
    const row = cloneRow({ [field]: value });

    await expect(
      searcherReturning([row]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(new RegExp(`^INVALID_LEXICAL_SEARCH_RESULT:.*${field}`));
  });

  it.each([
    { name: "null locator", locator: null, field: "locator" },
    { name: "array locator", locator: [], field: "locator" },
    {
      name: "wrong locator kind",
      locator: { kind: "section", page: 1 },
      field: "locator.kind",
    },
    {
      name: "zero page",
      locator: { kind: "page", page: 0 },
      field: "locator.page",
    },
    {
      name: "fractional page",
      locator: { kind: "page", page: 1.5 },
      field: "locator.page",
    },
    {
      name: "unsafe page",
      locator: { kind: "page", page: Number.MAX_SAFE_INTEGER + 1 },
      field: "locator.page",
    },
  ])("rejects a $name", async ({ locator, field }) => {
    await expect(
      searcherReturning([cloneRow({ locator })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(new RegExp(`^INVALID_LEXICAL_SEARCH_RESULT:.*${field}`));
  });

  it.each([
    { name: "null metadata", metadata: null, field: "metadata" },
    { name: "array metadata", metadata: [], field: "metadata" },
    {
      name: "numeric clause",
      metadata: { clause: 1 },
      field: "metadata.clause",
    },
    {
      name: "missing clause",
      metadata: {},
      field: "metadata.clause",
    },
  ])("rejects $name", async ({ metadata, field }) => {
    await expect(
      searcherReturning([cloneRow({ metadata })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(new RegExp(`^INVALID_LEXICAL_SEARCH_RESULT:.*${field}`));
  });

  it("rejects nested extras, symbols, and accessors without execution", async () => {
    let pageGetterCalls = 0;
    let clauseGetterCalls = 0;
    const locatorExtra = { kind: "page", page: 1, extra: true };
    const metadataSymbol = { clause: null } as Record<PropertyKey, unknown>;
    metadataSymbol[Symbol("hostile")] = true;
    const locatorAccessor = { kind: "page" };
    Object.defineProperty(locatorAccessor, "page", {
      enumerable: true,
      get: () => {
        pageGetterCalls += 1;
        return 1;
      },
    });
    const metadataAccessor = {};
    Object.defineProperty(metadataAccessor, "clause", {
      enumerable: true,
      get: () => {
        clauseGetterCalls += 1;
        return null;
      },
    });

    await expect(
      searcherReturning([cloneRow({ locator: locatorExtra })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*locator/);
    await expect(
      searcherReturning([cloneRow({ metadata: metadataSymbol })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*metadata/);
    await expect(
      searcherReturning([cloneRow({ locator: locatorAccessor })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*locator.page/);
    await expect(
      searcherReturning([cloneRow({ metadata: metadataAccessor })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*metadata.clause/);
    expect(pageGetterCalls).toBe(0);
    expect(clauseGetterCalls).toBe(0);
  });

  it("hard rejects duplicate runtime chunkIds without deduplication", async () => {
    const first = kecLexicalRuntimeResult({
      chunkId: "duplicate",
      lexicalScore: 0.9,
    });
    const second = kecLexicalRuntimeResult({
      chunkId: "duplicate",
      lexicalScore: 0.8,
    });

    await expect(
      searcherReturning([first, second]).search({ query: "query", limit: 2 }),
    ).rejects.toThrow(/^INVALID_LEXICAL_SEARCH_RESULT:.*duplicate/);
  });
});
