import { describe, expect, expectTypeOf, it } from "vitest";

import * as packageRoot from "../src/index.js";
import * as smokeNamespace from "../src/ollamaEmbeddingSmoke/index.js";
import { probeOllamaEmbedding } from "../src/ollamaEmbeddingSmoke/probeOllamaEmbedding.js";
import { readOllamaEmbeddingSmokeConfig } from "../src/ollamaEmbeddingSmoke/readOllamaEmbeddingSmokeConfig.js";
import { serializeOllamaEmbeddingSmoke } from "../src/ollamaEmbeddingSmoke/serializeOllamaEmbeddingSmoke.js";
import type {
  OllamaEmbeddingSmokeConfig,
  OllamaEmbeddingSmokeDependencies,
  OllamaEmbeddingSmokeEnvironment,
  OllamaEmbeddingSmokeResultV1,
} from "../src/ollamaEmbeddingSmoke/types.js";

type ExpectedEnvironment = Readonly<{
  KEC_EMBED_PROVIDER?: unknown;
  OLLAMA_BASE_URL?: unknown;
  OLLAMA_EMBED_MODEL?: unknown;
  OLLAMA_EMBED_TIMEOUT_MS?: unknown;
}>;

type ExpectedConfig = Readonly<{
  baseUrl: string;
  model: string;
  timeoutMs: number;
}>;

type ExpectedDependencies = Readonly<{
  fetch: typeof fetch;
}>;

type ExpectedResult = Readonly<{
  schemaVersion: 1;
  status: "READY";
  provider: "ollama";
  observedDimension: number;
}>;

describe("Ollama embedding smoke type contracts", () => {
  it("fixes exact environment, config, dependency, and result shapes", () => {
    expectTypeOf<OllamaEmbeddingSmokeEnvironment>().toEqualTypeOf<ExpectedEnvironment>();
    expectTypeOf<OllamaEmbeddingSmokeConfig>().toEqualTypeOf<ExpectedConfig>();
    expectTypeOf<OllamaEmbeddingSmokeDependencies>().toEqualTypeOf<ExpectedDependencies>();
    expectTypeOf<OllamaEmbeddingSmokeResultV1>().toEqualTypeOf<ExpectedResult>();
  });

  it("fixes exact key unions without index signatures", () => {
    expectTypeOf<keyof OllamaEmbeddingSmokeEnvironment>().toEqualTypeOf<
      | "KEC_EMBED_PROVIDER"
      | "OLLAMA_BASE_URL"
      | "OLLAMA_EMBED_MODEL"
      | "OLLAMA_EMBED_TIMEOUT_MS"
    >();
    expectTypeOf<keyof OllamaEmbeddingSmokeConfig>().toEqualTypeOf<
      "baseUrl" | "model" | "timeoutMs"
    >();
    expectTypeOf<
      keyof OllamaEmbeddingSmokeDependencies
    >().toEqualTypeOf<"fetch">();
    expectTypeOf<keyof OllamaEmbeddingSmokeResultV1>().toEqualTypeOf<
      "schemaVersion" | "status" | "provider" | "observedDimension"
    >();
  });

  it("fixes the asynchronous probe signature", () => {
    expectTypeOf(probeOllamaEmbedding).toEqualTypeOf<
      (
        config: OllamaEmbeddingSmokeConfig,
        dependencies: OllamaEmbeddingSmokeDependencies,
      ) => Promise<OllamaEmbeddingSmokeResultV1>
    >();
  });

  it("fixes configuration-reader and serializer signatures", () => {
    expectTypeOf(readOllamaEmbeddingSmokeConfig).toEqualTypeOf<
      (
        environment: OllamaEmbeddingSmokeEnvironment,
      ) => OllamaEmbeddingSmokeConfig
    >();
    expectTypeOf(serializeOllamaEmbeddingSmoke).toEqualTypeOf<
      (result: OllamaEmbeddingSmokeResultV1) => string
    >();
  });

  it("keeps all contract fields readonly and literals fixed", () => {
    const assertReadonly = (
      environment: OllamaEmbeddingSmokeEnvironment,
      config: OllamaEmbeddingSmokeConfig,
      dependencies: OllamaEmbeddingSmokeDependencies,
      result: OllamaEmbeddingSmokeResultV1,
    ): void => {
      // @ts-expect-error smoke environment entries are readonly.
      environment.KEC_EMBED_PROVIDER = "placeholder";
      // @ts-expect-error smoke config is readonly.
      config.baseUrl = "http://changed.invalid";
      // @ts-expect-error dependencies are readonly.
      dependencies.fetch = fetch;
      // @ts-expect-error schemaVersion is readonly and fixed to literal 1.
      result.schemaVersion = 2;
      // @ts-expect-error status is readonly and fixed to READY.
      result.status = "FAILED";
      // @ts-expect-error provider is readonly and fixed to ollama.
      result.provider = "other";
      // @ts-expect-error observedDimension is readonly.
      result.observedDimension = 2;
      // @ts-expect-error the result contract has no optional message field.
      result.message = "not public";
    };

    expectTypeOf(assertReadonly).toBeFunction();
  });

  it("exports only the approved runtime functions from the internal namespace", () => {
    expect(Object.keys(smokeNamespace).sort()).toEqual([
      "probeOllamaEmbedding",
      "readOllamaEmbeddingSmokeConfig",
      "serializeOllamaEmbeddingSmoke",
    ]);
  });

  it("does not expose the smoke core from the package root", () => {
    expect(packageRoot).not.toHaveProperty("probeOllamaEmbedding");
    expect(packageRoot).not.toHaveProperty("readOllamaEmbeddingSmokeConfig");
    expect(packageRoot).not.toHaveProperty("serializeOllamaEmbeddingSmoke");
  });
});
