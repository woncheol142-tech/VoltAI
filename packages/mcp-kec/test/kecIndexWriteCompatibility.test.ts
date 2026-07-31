import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  existingIndexState,
  foreignSourcePath,
  incomingEmbeddingState,
  incomingSourcePath,
  indexMetadata,
  malformedVectorCases,
  providerMetadata,
  validVectors,
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

describe("KEC index write compatibility behavior", () => {
  it("allows a valid write into an empty index", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(
      assertKecIndexWriteCompatibility(
        existingIndexState({ metadata: null, sourcePaths: [] }),
        incomingEmbeddingState(),
      ),
    ).toEqual({ dimension: 3 });
  });

  it("allows provider, model, and dimension migration when only the replaced source remains", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(
      assertKecIndexWriteCompatibility(
        existingIndexState({
          metadata: indexMetadata({
            embeddingProvider: "placeholder",
            embeddingModel: "legacy-model",
            dimensions: 2,
          }),
          sourcePaths: [incomingSourcePath, incomingSourcePath],
        }),
        incomingEmbeddingState({
          providerMetadata: providerMetadata({
            provider: "ollama",
            model: "new-model",
          }),
          vectors: validVectors(4),
        }),
      ),
    ).toEqual({ dimension: 4 });
  });

  it("allows same-source-only migration even when legacy collection metadata is absent", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(
      assertKecIndexWriteCompatibility(
        existingIndexState({
          metadata: null,
          sourcePaths: [incomingSourcePath],
        }),
        incomingEmbeddingState(),
      ),
    ).toEqual({ dimension: 3 });
  });

  it("allows foreign-source writes only when provider, model, and dimensions match exactly", async () => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(
      assertKecIndexWriteCompatibility(
        existingIndexState({
          metadata: indexMetadata(),
          sourcePaths: [incomingSourcePath, foreignSourcePath],
        }),
        incomingEmbeddingState(),
      ),
    ).toEqual({ dimension: 3 });
  });

  it.each([
    {
      name: "missing metadata",
      metadata: null,
      code: "MISSING_INDEX_METADATA",
    },
    {
      name: "provider mismatch",
      metadata: indexMetadata({ embeddingProvider: "placeholder" }),
      code: "PROVIDER_MISMATCH",
    },
    {
      name: "model mismatch",
      metadata: indexMetadata({ embeddingModel: "other-model" }),
      code: "MODEL_MISMATCH",
    },
    {
      name: "dimension mismatch",
      metadata: indexMetadata({ dimensions: 2 }),
      code: "DIMENSION_MISMATCH",
    },
    {
      name: "zero existing dimension",
      metadata: indexMetadata({ dimensions: 0 }),
      code: "INVALID_INDEX_METADATA",
    },
    {
      name: "negative existing dimension",
      metadata: indexMetadata({ dimensions: -1 }),
      code: "INVALID_INDEX_METADATA",
    },
    {
      name: "fractional existing dimension",
      metadata: indexMetadata({ dimensions: 1.5 }),
      code: "INVALID_INDEX_METADATA",
    },
    {
      name: "unsafe existing dimension",
      metadata: indexMetadata({ dimensions: Number.MAX_SAFE_INTEGER + 1 }),
      code: "INVALID_INDEX_METADATA",
    },
    {
      name: "malformed existing provider",
      metadata: indexMetadata({
        embeddingProvider: 42 as unknown as string,
      }),
      code: "INVALID_INDEX_METADATA",
    },
    {
      name: "malformed existing model",
      metadata: indexMetadata({ embeddingModel: null as unknown as string }),
      code: "INVALID_INDEX_METADATA",
    },
  ])("rejects foreign-source $name", async ({ metadata, code }) => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(() =>
      assertKecIndexWriteCompatibility(
        existingIndexState({
          metadata,
          sourcePaths: [incomingSourcePath, foreignSourcePath],
        }),
        incomingEmbeddingState(),
      ),
    ).toThrow(`KEC_INDEX_COMPATIBILITY: ${code}`);
  });

  it.each(malformedVectorCases())(
    "rejects incoming vectors with $name",
    async ({ vectors }) => {
      const { assertKecIndexWriteCompatibility } =
        await loadCompatibilityModule();

      expect(() =>
        assertKecIndexWriteCompatibility(
          existingIndexState({ metadata: null, sourcePaths: [] }),
          incomingEmbeddingState({
            vectors: vectors as unknown as readonly (readonly number[])[],
          }),
        ),
      ).toThrow("KEC_INDEX_COMPATIBILITY: INVALID_EMBEDDING");
    },
  );

  it.each([
    providerMetadata({ provider: "" }),
    providerMetadata({ model: "" }),
    providerMetadata({ provider: null as unknown as string }),
    providerMetadata({ model: 42 as unknown as string }),
  ])("rejects malformed incoming provider metadata", async (metadata) => {
    const { assertKecIndexWriteCompatibility } =
      await loadCompatibilityModule();

    expect(() =>
      assertKecIndexWriteCompatibility(
        existingIndexState({ metadata: null, sourcePaths: [] }),
        incomingEmbeddingState({ providerMetadata: metadata }),
      ),
    ).toThrow("KEC_INDEX_COMPATIBILITY: INVALID_PROVIDER_METADATA");
  });
});
