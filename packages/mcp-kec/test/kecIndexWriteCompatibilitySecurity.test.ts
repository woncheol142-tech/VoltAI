import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  existingIndexState,
  foreignSourcePath,
  incomingEmbeddingState,
  indexMetadata,
  providerMetadata,
  type KecIndexCompatibilityModule,
} from "./helpers/kecIndexWriteCompatibilityFixture.js";

const compatibilityModulePath = fileURLToPath(
  new URL("../src/knowledge/indexCompatibility.ts", import.meta.url),
);

async function loadCompatibilityModule(): Promise<KecIndexCompatibilityModule> {
  return (await import(
    /* @vite-ignore */ compatibilityModulePath
  )) as KecIndexCompatibilityModule;
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }

  throw new Error("Expected compatibility validation to fail");
}

describe("KEC index write compatibility security", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      existing: existingIndexState({
        metadata: null,
        sourcePaths: [foreignSourcePath],
      }),
      incoming: incomingEmbeddingState(),
    },
    {
      existing: existingIndexState({ metadata: null, sourcePaths: [] }),
      incoming: incomingEmbeddingState({ vectors: [[Number.NaN]] }),
    },
    {
      existing: existingIndexState({ metadata: null, sourcePaths: [] }),
      incoming: incomingEmbeddingState({
        providerMetadata: providerMetadata({ provider: "" }),
      }),
    },
  ])(
    "uses the compatibility prefix for guard-generated failures",
    async (testCase) => {
      const { assertKecIndexWriteCompatibility } =
        await loadCompatibilityModule();
      const error = captureError(() =>
        assertKecIndexWriteCompatibility(testCase.existing, testCase.incoming),
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^KEC_INDEX_COMPATIBILITY:/u);
    },
  );

  it("does not disclose vectors, paths, endpoints, environment values, keys, or metadata objects", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();
    const secrets = [
      "987654.123456",
      "/Users/private/project/secret.pdf",
      "https://embedding.internal.example/api",
      "environment-secret-value",
      "api-key-secret-value",
      "full-metadata-secret-value",
    ];
    const error = captureError(() =>
      assertKecIndexWriteCompatibility(
        existingIndexState({
          metadata: indexMetadata({
            embeddingProvider: secrets[5],
            embeddingModel: secrets[4],
          }),
          sourcePaths: [secrets[1], foreignSourcePath],
        }),
        incomingEmbeddingState({
          sourcePath: secrets[1],
          providerMetadata: providerMetadata({
            provider: secrets[2],
            model: secrets[3],
          }),
          vectors: [[Number(secrets[0])]],
        }),
      ),
    );
    const message = (error as Error).message;

    for (const secret of secrets) {
      expect(message).not.toContain(secret);
    }
    expect(message).toMatch(/^KEC_INDEX_COMPATIBILITY:/u);
  });

  it("does not coerce hostile vector or metadata values", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();
    let coercions = 0;
    const hostile = {
      toString: () => {
        coercions += 1;
        throw new Error("hostile toString");
      },
      valueOf: () => {
        coercions += 1;
        throw new Error("hostile valueOf");
      },
      [Symbol.toPrimitive]: () => {
        coercions += 1;
        throw new Error("hostile Symbol.toPrimitive");
      },
    };

    expect(() =>
      assertKecIndexWriteCompatibility(
        existingIndexState({ metadata: null, sourcePaths: [] }),
        incomingEmbeddingState({
          providerMetadata: providerMetadata({
            provider: hostile as unknown as string,
          }),
          vectors: [[hostile as unknown as number]],
        }),
      ),
    ).toThrow(/^KEC_INDEX_COMPATIBILITY:/u);
    expect(coercions).toBe(0);
  });

  it("does not mutate existing state, incoming state, metadata, source paths, or vectors", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();
    const metadata = Object.freeze(indexMetadata());
    const sourcePaths = Object.freeze([foreignSourcePath]);
    const vector = Object.freeze([1, 2, 3]);
    const vectors = Object.freeze([vector]);
    const existing = Object.freeze(
      existingIndexState({ metadata, sourcePaths }),
    );
    const incoming = Object.freeze(incomingEmbeddingState({ vectors }));

    expect(assertKecIndexWriteCompatibility(existing, incoming)).toEqual({
      dimension: 3,
    });
    expect(existing.metadata).toBe(metadata);
    expect(existing.sourcePaths).toBe(sourcePaths);
    expect(incoming.vectors).toBe(vectors);
    expect(incoming.vectors[0]).toBe(vector);
  });

  it("returns deterministic redacted errors for the same invalid input", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();
    const existing = existingIndexState({
      metadata: indexMetadata({ embeddingModel: "other" }),
      sourcePaths: [foreignSourcePath],
    });
    const incoming = incomingEmbeddingState();
    const messages = Array.from({ length: 10 }, () => {
      const error = captureError(() =>
        assertKecIndexWriteCompatibility(existing, incoming),
      );
      return (error as Error).message;
    });

    expect(new Set(messages)).toEqual(
      new Set(["KEC_INDEX_COMPATIBILITY: MODEL_MISMATCH"]),
    );
  });

  it("does not log or contact network while validating", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(
      assertKecIndexWriteCompatibility(
        existingIndexState({ metadata: null, sourcePaths: [] }),
        incomingEmbeddingState(),
      ),
    ).toEqual({ dimension: 3 });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
