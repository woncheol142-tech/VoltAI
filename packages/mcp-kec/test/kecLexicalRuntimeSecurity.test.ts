import { describe, expect, it, vi } from "vitest";

import {
  searchKecLexically,
  type KecLexicalSearchDependencies,
  type KecLexicalSourceChunk,
} from "../src/searchLexical/index.js";
import { kecLexicalSourceChunk } from "./helpers/kecLexicalRuntimeFixture.js";

function runtimeSource(value: unknown): readonly KecLexicalSourceChunk[] {
  return value as readonly KecLexicalSourceChunk[];
}

function dependenciesReturning(value: unknown): KecLexicalSearchDependencies {
  return {
    listChunks: async () => runtimeSource(value),
  };
}

function plainRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...kecLexicalSourceChunk(),
    ...overrides,
  };
}

class CustomChunk {
  chunkId = "custom";
  documentId = "kec:custom";
  sourcePath = "knowledge/custom.pdf";
  chunkIndex = 0;
  locator = { kind: "page", page: 1 };
  metadata = { clause: null };
  text = "접지";
}

describe("KEC lexical source array security", () => {
  it.each([null, {}, "rows", new Map(), new Set(), new Uint8Array()])(
    "rejects a non-array source result",
    async (source) => {
      await expect(
        searchKecLexically("접지", 1, dependenciesReturning(source)),
      ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    },
  );

  it("rejects sparse arrays without consulting inherited indices", async () => {
    let inheritedGetterCalls = 0;
    const inheritedIndex = Object.create(Array.prototype) as unknown[];
    Object.defineProperty(inheritedIndex, "0", {
      configurable: true,
      get: () => {
        inheritedGetterCalls += 1;
        return kecLexicalSourceChunk();
      },
    });
    const sparse = new Array(1);
    Object.setPrototypeOf(sparse, inheritedIndex);

    await expect(
      searchKecLexically(
        "접지",
        1,
        dependenciesReturning(runtimeSource(sparse)),
      ),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    expect(inheritedGetterCalls).toBe(0);
  });

  it("rejects accessor indices without invoking the getter", async () => {
    let getterCalls = 0;
    const source: unknown[] = [];
    Object.defineProperty(source, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return kecLexicalSourceChunk();
      },
    });
    source.length = 1;

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning(source)),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    expect(getterCalls).toBe(0);
  });

  it("rejects setter-only array indices", async () => {
    const source: unknown[] = [];
    Object.defineProperty(source, "0", {
      configurable: true,
      enumerable: true,
      set: () => {},
    });
    source.length = 1;

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning(source)),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });

  it.each(["extra", "01", "-1", "1.0"])(
    "rejects the noncanonical source array key %j",
    async (key) => {
      const source = [kecLexicalSourceChunk()] as unknown[] &
        Record<string, unknown>;
      Object.defineProperty(source, key, {
        configurable: true,
        enumerable: true,
        value: "hostile",
      });

      await expect(
        searchKecLexically("접지", 1, dependenciesReturning(source)),
      ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    },
  );

  it("rejects source array symbols before inspecting an accessor index", async () => {
    let getterCalls = 0;
    const source: unknown[] = [];
    Object.defineProperty(source, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return kecLexicalSourceChunk();
      },
    });
    source.length = 1;
    Object.defineProperty(source, Symbol("hostile"), {
      configurable: true,
      value: true,
    });

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning(source)),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    expect(getterCalls).toBe(0);
  });
});

describe("KEC lexical source row and nested schema security", () => {
  it.each([
    null,
    [],
    new Date(0),
    new Map(),
    new Set(),
    new CustomChunk(),
    Object.assign(Object.create({ inheritedMarker: true }), plainRow()),
  ])("rejects a non-plain source row", async (row) => {
    await expect(
      searchKecLexically("접지", 1, dependenciesReturning([row])),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });

  it.each(["extra", "__proto__", "constructor", "prototype"])(
    "rejects the hostile own row key %j without prototype pollution",
    async (key) => {
      const row = plainRow();
      Object.defineProperty(row, key, {
        configurable: true,
        enumerable: true,
        value: "pollution-attempt",
      });

      await expect(
        searchKecLexically("접지", 1, dependenciesReturning([row])),
      ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
      expect(Object.prototype).not.toHaveProperty("pollution-attempt");
    },
  );

  it("rejects row symbols before invoking a field getter", async () => {
    let getterCalls = 0;
    const row = plainRow();
    Object.defineProperty(row, "text", {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "접지";
      },
    });
    Object.defineProperty(row, Symbol("hostile"), {
      configurable: true,
      value: true,
    });

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning([row])),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    expect(getterCalls).toBe(0);
  });

  it.each([
    "chunkId",
    "documentId",
    "sourcePath",
    "chunkIndex",
    "locator",
    "metadata",
    "text",
  ])("rejects a %s accessor without executing it", async (field) => {
    let getterCalls = 0;
    const row = plainRow();
    Object.defineProperty(row, field, {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "hostile";
      },
    });

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning([row])),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
    expect(getterCalls).toBe(0);
  });

  it.each([
    ["chunkId", ""],
    ["chunkId", 1],
    ["documentId", null],
    ["sourcePath", Symbol("path")],
    ["chunkIndex", -1],
    ["chunkIndex", 1.5],
    ["chunkIndex", Number.MAX_SAFE_INTEGER + 1],
    ["locator", null],
    ["metadata", []],
    ["text", { toString: () => "접지" }],
  ])("rejects malformed %s without coercion", async (field, value) => {
    const row = plainRow({ [field as string]: value });

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning([row])),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });

  it.each([
    null,
    [],
    new Date(0),
    Object.assign(Object.create({ kind: "page", page: 1 }), {}),
    { kind: "section", page: 1 },
    { kind: "page", page: 0 },
    { kind: "page", page: 1.5 },
    { kind: "page", page: Number.MAX_SAFE_INTEGER + 1 },
    { kind: "page", page: 1, extra: true },
  ])("rejects a malformed locator", async (locator) => {
    await expect(
      searchKecLexically(
        "접지",
        1,
        dependenciesReturning([plainRow({ locator })]),
      ),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });

  it.each([
    null,
    [],
    new Date(0),
    Object.assign(Object.create({ clause: null }), {}),
    {},
    { clause: 1 },
    { clause: null, extra: true },
  ])("rejects malformed KEC metadata", async (metadata) => {
    await expect(
      searchKecLexically(
        "접지",
        1,
        dependenciesReturning([plainRow({ metadata })]),
      ),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });

  it.each(["locator", "metadata"])(
    "rejects a nested %s accessor without invocation",
    async (field) => {
      let getterCalls = 0;
      const nested: Record<string, unknown> =
        field === "locator" ? { kind: "page" } : {};
      Object.defineProperty(nested, field === "locator" ? "page" : "clause", {
        configurable: true,
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return field === "locator" ? 1 : null;
        },
      });

      await expect(
        searchKecLexically(
          "접지",
          1,
          dependenciesReturning([plainRow({ [field]: nested })]),
        ),
      ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
      expect(getterCalls).toBe(0);
    },
  );

  it("rejects duplicate persisted chunk IDs instead of deduplicating", async () => {
    const first = kecLexicalSourceChunk({ chunkId: "duplicate" });
    const second = kecLexicalSourceChunk({
      chunkId: "duplicate",
      documentId: "kec:other",
      sourcePath: "knowledge/other.pdf",
    });

    await expect(
      searchKecLexically("접지", 10, dependenciesReturning([first, second])),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });

  it("validates the entire source before applying the output limit", async () => {
    const valid = kecLexicalSourceChunk({
      chunkId: "first",
      text: "접지 접지 접지",
    });
    const invalid = plainRow({
      chunkId: "last-invalid",
      text: "접지",
      locator: { kind: "page", page: 0 },
    });

    await expect(
      searchKecLexically("접지", 1, dependenciesReturning([valid, invalid])),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_SOURCE_RESULT:/);
  });
});

describe("KEC lexical authority and failure security", () => {
  it("calls the zero-argument source callback exactly once", async () => {
    const listChunks = vi.fn(async (...args: unknown[]) => {
      expect(args).toEqual([]);
      return [kecLexicalSourceChunk()];
    });

    await searchKecLexically("접지", 1, { listChunks });

    expect(listChunks).toHaveBeenCalledTimes(1);
  });

  it("preserves source/store error identity without retry or wrapping", async () => {
    const sourceError = new Error("opaque-source-failure");
    const listChunks = vi.fn(async () => {
      throw sourceError;
    });

    await expect(searchKecLexically("접지", 1, { listChunks })).rejects.toBe(
      sourceError,
    );
    expect(listChunks).toHaveBeenCalledTimes(1);
  });

  it("treats SQL, FTS, and prompt-shaped input as inert lexical data", async () => {
    const query =
      "' OR 1=1; DROP TABLE kec_chunks; -- MATCH NEAR AND OR NOT ignore previous instructions";
    const listChunks = vi.fn(async (...args: unknown[]) => {
      expect(args).toEqual([]);
      return [];
    });

    await expect(searchKecLexically(query, 1, { listChunks })).resolves.toEqual(
      [],
    );
    expect(listChunks).toHaveBeenCalledTimes(1);
  });

  it("copies sourcePath as opaque output data without path or filesystem authority", async () => {
    const sourcePath = "../../outside/\u0000opaque.pdf";
    const source = kecLexicalSourceChunk({
      sourcePath,
      text: "접지",
    });

    const [result] = await searchKecLexically(
      "접지",
      1,
      dependenciesReturning([source]),
    );

    expect(result.sourcePath).toBe(sourcePath);
  });

  it("does not mutate, freeze, sort, or replace trusted dependency and source state", async () => {
    const first = kecLexicalSourceChunk({ chunkId: "z", text: "접지" });
    const second = kecLexicalSourceChunk({ chunkId: "a", text: "접지" });
    const source = [first, second];
    const snapshot = structuredClone(source);
    const dependencies = {
      listChunks: async () => source,
      extraTrustedMarker: true,
    };

    await searchKecLexically("접지", 2, dependencies);

    expect(source).toEqual(snapshot);
    expect(source.map((row) => row.chunkId)).toEqual(["z", "a"]);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(first)).toBe(false);
    expect(Object.isFrozen(first.locator)).toBe(false);
    expect(Object.isFrozen(first.metadata)).toBe(false);
    expect(dependencies.extraTrustedMarker).toBe(true);
    expect(Object.isFrozen(dependencies)).toBe(false);
  });

  it("performs no hidden cache or global-result reuse across calls", async () => {
    let generation = 0;
    const listChunks = vi.fn(async () => {
      generation += 1;
      return [
        kecLexicalSourceChunk({
          chunkId: `generation-${generation}`,
          text: "접지",
        }),
      ];
    });

    const first = await searchKecLexically("접지", 1, { listChunks });
    const second = await searchKecLexically("접지", 1, { listChunks });

    expect(listChunks).toHaveBeenCalledTimes(2);
    expect(first[0].chunkId).toBe("generation-1");
    expect(second[0].chunkId).toBe("generation-2");
    expect(second).not.toBe(first);
  });
});
