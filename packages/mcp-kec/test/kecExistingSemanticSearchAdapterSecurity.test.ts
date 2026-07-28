import { describe, expect, it } from "vitest";

import { createExistingSemanticSearcher } from "../src/searchAdapters/index.js";
import type { KecSearchRequest } from "../src/searchFoundation/index.js";
import type { KecSemanticSearchCoreDependencies } from "../src/searchSemantic/semanticSearchCore.js";
import {
  existingSemanticCoreDependencies,
  persistedKecSemanticResult,
  type PersistedKecSemanticResult,
} from "./helpers/kecExistingSemanticSearchAdapterFixture.js";

function runtimeRequest(value: unknown): KecSearchRequest {
  return value as KecSearchRequest;
}

function runtimeResults(value: unknown): PersistedKecSemanticResult[] {
  return value as PersistedKecSemanticResult[];
}

function searcherReturning(value: unknown) {
  return createExistingSemanticSearcher(
    existingSemanticCoreDependencies({
      search: async () => runtimeResults(value),
    }),
  );
}

function cloneRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...persistedKecSemanticResult(),
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
  similarity = 1;
}

describe("existing semantic search adapter request security", () => {
  it.each([
    { name: "null", value: null },
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
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest(value))).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:.*plain object/,
    );
  });

  it.each([
    { name: "missing query", value: { limit: 1 }, field: "query" },
    { name: "missing limit", value: { query: "query" }, field: "limit" },
  ])("rejects $name as an own-property violation", async ({ value, field }) => {
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest(value))).rejects.toThrow(
      new RegExp(`^INVALID_SEMANTIC_SEARCH_REQUEST:.*${field}`),
    );
  });

  it.each([
    { inheritedField: "query", ownField: "limit", ownValue: 1 },
    { inheritedField: "limit", ownField: "query", ownValue: "query" },
  ])(
    "rejects an inherited $inheritedField on an ordinary object",
    async ({ inheritedField, ownField, ownValue }) => {
      const original = Object.getOwnPropertyDescriptor(
        Object.prototype,
        inheritedField,
      );
      Object.defineProperty(Object.prototype, inheritedField, {
        configurable: true,
        value: inheritedField === "query" ? "query" : 1,
      });

      try {
        const request = { [ownField]: ownValue };
        const searcher = createExistingSemanticSearcher(
          existingSemanticCoreDependencies(),
        );

        await expect(searcher.search(runtimeRequest(request))).rejects.toThrow(
          new RegExp(`^INVALID_SEMANTIC_SEARCH_REQUEST:.*${inheritedField}`),
        );
      } finally {
        if (original) {
          Object.defineProperty(Object.prototype, inheritedField, original);
        } else {
          delete (Object.prototype as Record<string, unknown>)[inheritedField];
        }
      }
    },
  );

  it.each([
    { name: "extra", key: "extra" },
    { name: "__proto__", key: "__proto__" },
    { name: "constructor", key: "constructor" },
    { name: "prototype", key: "prototype" },
  ])("rejects the $name own string key", async ({ key }) => {
    const request = { query: "query", limit: 1 } as Record<string, unknown>;
    Object.defineProperty(request, key, {
      configurable: true,
      enumerable: true,
      value: "hostile",
    });
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest(request))).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:.*own string key/,
    );
    expect(Object.prototype).not.toHaveProperty("hostile");
  });

  it("rejects an own symbol before reading request values", async () => {
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
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest(request))).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:.*symbol/,
    );
    expect(queryGetterCalls).toBe(0);
  });

  it("checks unexpected string keys before symbols and descriptors", async () => {
    let queryGetterCalls = 0;
    const request = { limit: 1, extra: true } as Record<PropertyKey, unknown>;
    Object.defineProperty(request, "query", {
      enumerable: true,
      get: () => {
        queryGetterCalls += 1;
        return "query";
      },
    });
    request[Symbol("hostile")] = true;
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest(request))).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:.*own string key/,
    );
    expect(queryGetterCalls).toBe(0);
  });

  it("rejects query and limit accessors without invoking getters", async () => {
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
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(
      searcher.search(runtimeRequest(queryAccessor)),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_REQUEST:.*query/);
    await expect(
      searcher.search(runtimeRequest(limitAccessor)),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_REQUEST:.*limit/);
    expect(queryGetterCalls).toBe(0);
    expect(limitGetterCalls).toBe(0);
  });

  it.each([
    { name: "numeric query", value: 1 },
    { name: "null query", value: null },
    { name: "symbol query", value: Symbol("query") },
    { name: "coercible query", value: { toString: () => "query" } },
  ])("rejects a $name without coercion", async ({ value }) => {
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(
      searcher.search(runtimeRequest({ query: value, limit: 1 })),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_REQUEST:.*query/);
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
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(
      searcher.search(runtimeRequest({ query: "query", limit: value })),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_REQUEST:.*limit/);
  });

  it("does not broadly validate or clone trusted typed dependencies", async () => {
    const base = existingSemanticCoreDependencies();
    const dependencies = Object.assign(
      Object.create({ inheritedTrustedMarker: true }),
      base,
      { extraTrustedMarker: true },
    ) as KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>;
    const searcher = createExistingSemanticSearcher(dependencies);

    await expect(
      searcher.search({ query: "query", limit: 1 }),
    ).resolves.toEqual([]);
    expect(Object.getPrototypeOf(dependencies)).not.toBe(Object.prototype);
    expect(dependencies).toHaveProperty("extraTrustedMarker", true);
  });
});

describe("existing semantic search adapter result-container security", () => {
  it.each([
    { name: "null", value: null },
    { name: "plain object", value: { 0: persistedKecSemanticResult() } },
    { name: "string", value: "result" },
  ])("rejects a non-array $name result", async ({ value }) => {
    await expect(
      searcherReturning(value).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*array/);
  });

  it("rejects an own symbol before own string keys or indices", async () => {
    let indexGetterCalls = 0;
    const results: unknown[] = [];
    results.length = 1;
    Object.defineProperty(results, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        indexGetterCalls += 1;
        return persistedKecSemanticResult();
      },
    });
    results[Symbol("hostile")] = true;

    await expect(
      searcherReturning(results).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*symbol/);
    expect(indexGetterCalls).toBe(0);
  });

  it.each(["extra", "01", "-1", "1.0"])(
    "rejects the noncanonical own array key %s",
    async (key) => {
      const results = [persistedKecSemanticResult()] as unknown[] &
        Record<string, unknown>;
      Object.defineProperty(results, key, {
        configurable: true,
        enumerable: true,
        value: true,
      });

      await expect(
        searcherReturning(results).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*array key/);
    },
  );

  it("checks extra own string keys before dense indices", async () => {
    const results: unknown[] & Record<string, unknown> = [] as unknown[] &
      Record<string, unknown>;
    results.length = 1;
    results.extra = true;

    await expect(
      searcherReturning(results).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*array key/);
  });

  it("rejects a sparse result array", async () => {
    const results = new Array<PersistedKecSemanticResult>(2);
    results[1] = persistedKecSemanticResult();

    await expect(
      searcherReturning(results).search({ query: "query", limit: 2 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*dense/);
  });

  it("rejects an inherited index without reading it", async () => {
    let inheritedGetterCalls = 0;
    const inheritedArrayPrototype = Object.create(Array.prototype);
    Object.defineProperty(inheritedArrayPrototype, "0", {
      configurable: true,
      get: () => {
        inheritedGetterCalls += 1;
        return persistedKecSemanticResult();
      },
    });
    const results = new Array<PersistedKecSemanticResult>(1);
    Object.setPrototypeOf(results, inheritedArrayPrototype);

    await expect(
      searcherReturning(results).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*dense/);
    expect(inheritedGetterCalls).toBe(0);
  });

  it("rejects index accessors and setter-only indices without invocation", async () => {
    let getterCalls = 0;
    const getterResults: unknown[] = [];
    getterResults.length = 1;
    Object.defineProperty(getterResults, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return persistedKecSemanticResult();
      },
    });
    const setterResults: unknown[] = [];
    setterResults.length = 1;
    Object.defineProperty(setterResults, "0", {
      configurable: true,
      enumerable: true,
      set: () => {},
    });

    await expect(
      searcherReturning(getterResults).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*data descriptor/);
    await expect(
      searcherReturning(setterResults).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*data descriptor/);
    expect(getterCalls).toBe(0);
  });
});

describe("existing semantic search adapter persisted-row security", () => {
  it("accepts a null-prototype row with null-prototype locator and metadata", async () => {
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
      similarity: 0.5,
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
        semanticScore: 0.5,
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
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*plain object/);
  });

  it("rejects row extra keys and symbols before reading chunkId", async () => {
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
    symbolRow[Symbol("hostile") as unknown as string] = true;

    await expect(
      searcherReturning([extraRow]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*own string key/);
    await expect(
      searcherReturning([symbolRow]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*symbol/);
    expect(chunkIdGetterCalls).toBe(0);
  });

  it.each([
    { name: "missing", value: undefined, mode: "missing" },
    { name: "empty", value: "", mode: "value" },
    { name: "number", value: 1, mode: "value" },
    { name: "null", value: null, mode: "value" },
  ])(
    "reports a $name chunkId with its dedicated prefix",
    async ({ value, mode }) => {
      const row = cloneRow();
      if (mode === "missing") {
        delete row.chunkId;
      } else {
        row.chunkId = value;
      }

      await expect(
        searcherReturning([row]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_SEMANTIC_CHUNK_ID:/);
    },
  );

  it("reports inherited and accessor chunkIds without invoking getters", async () => {
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
      ).rejects.toThrow(/^MISSING_SEMANTIC_CHUNK_ID:/);
      await expect(
        searcherReturning([setterRow]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_SEMANTIC_CHUNK_ID:/);
      await expect(
        searcherReturning([inheritedRow]).search({ query: "query", limit: 1 }),
      ).rejects.toThrow(/^MISSING_SEMANTIC_CHUNK_ID:/);
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
    { field: "text", value: { toString: () => "text" } },
    { field: "similarity", value: Number.NaN },
    { field: "similarity", value: Number.POSITIVE_INFINITY },
    { field: "similarity", value: Number.NEGATIVE_INFINITY },
  ])("rejects invalid $field values", async ({ field, value }) => {
    const row = cloneRow({ [field]: value });

    await expect(
      searcherReturning([row]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(new RegExp(`^INVALID_SEMANTIC_SEARCH_RESULT:.*${field}`));
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
    const row = cloneRow({ locator });

    await expect(
      searcherReturning([row]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(new RegExp(`^INVALID_SEMANTIC_SEARCH_RESULT:.*${field}`));
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
    const row = cloneRow({ metadata });

    await expect(
      searcherReturning([row]).search({ query: "query", limit: 1 }),
    ).rejects.toThrow(new RegExp(`^INVALID_SEMANTIC_SEARCH_RESULT:.*${field}`));
  });

  it("rejects nested extra keys, symbols, and accessors without execution", async () => {
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
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*locator/);
    await expect(
      searcherReturning([cloneRow({ metadata: metadataSymbol })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*metadata/);
    await expect(
      searcherReturning([cloneRow({ locator: locatorAccessor })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*locator.page/);
    await expect(
      searcherReturning([cloneRow({ metadata: metadataAccessor })]).search({
        query: "query",
        limit: 1,
      }),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_RESULT:.*metadata.clause/);
    expect(pageGetterCalls).toBe(0);
    expect(clauseGetterCalls).toBe(0);
  });

  it("validates every row in input order before returning any projection", async () => {
    const first = persistedKecSemanticResult({
      chunkId: "valid-first",
    });
    const second = persistedKecSemanticResult({
      chunkId: "",
    });
    const source = [first, second];
    const firstDescriptors = Object.getOwnPropertyDescriptors(first);

    await expect(
      searcherReturning(source).search({ query: "query", limit: 2 }),
    ).rejects.toThrow(/^MISSING_SEMANTIC_CHUNK_ID:/);
    expect(Object.getOwnPropertyDescriptors(first)).toEqual(firstDescriptors);
    expect(Object.isFrozen(first)).toBe(false);
    expect(Object.isFrozen(source)).toBe(false);
  });
});
