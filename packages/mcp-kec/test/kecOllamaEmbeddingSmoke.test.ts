import { afterEach, describe, expect, it, vi } from "vitest";

import { probeOllamaEmbedding } from "../src/ollamaEmbeddingSmoke/probeOllamaEmbedding.js";
import { readOllamaEmbeddingSmokeConfig } from "../src/ollamaEmbeddingSmoke/readOllamaEmbeddingSmokeConfig.js";
import { serializeOllamaEmbeddingSmoke } from "../src/ollamaEmbeddingSmoke/serializeOllamaEmbeddingSmoke.js";
import type {
  OllamaEmbeddingSmokeConfig,
  OllamaEmbeddingSmokeEnvironment,
} from "../src/ollamaEmbeddingSmoke/types.js";
import {
  createAbortAwareFetch,
  createFetchRecorder,
  createGetterEmbedding,
  createGetterEmbeddingResponse,
  createInheritedEmbeddingResponse,
  createInheritedIndexEmbedding,
  createJsonResponse,
  createJsonValueResponse,
  createMalformedJsonResponse,
  createNeverResolvingFetch,
  createNeverResolvingJsonResponse,
  createRejectedResponse,
  createResponseWithJsonValue,
  createResponseWithOwnStatus,
  createSizedEmbedding,
  createSparseEmbedding,
  headerValue,
  requestBody,
  smokeConfig,
  smokeEnvironment,
  smokeErrors,
  smokeProbeText,
} from "./helpers/kecOllamaEmbeddingSmokeFixture.js";

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

function errorMessage(error: unknown): unknown {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

async function expectSmokeError(
  operation: Promise<unknown>,
  expected: string,
): Promise<void> {
  const error = await captureError(operation);
  expect(error).toBeInstanceOf(Error);
  expect(errorMessage(error)).toBe(expected);
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Ollama embedding smoke configuration reader", () => {
  it("requires the provider to equal ollama exactly", () => {
    for (const value of [
      undefined,
      "",
      "OLLAMA",
      "placeholder",
      " ollama",
      "ollama ",
    ]) {
      const environment = smokeEnvironment({ KEC_EMBED_PROVIDER: value });
      expect(() =>
        readOllamaEmbeddingSmokeConfig(
          environment as OllamaEmbeddingSmokeEnvironment,
        ),
      ).toThrow(smokeErrors.invalidConfiguration);
    }
  });

  it("applies only the approved defaults when optional properties are absent", () => {
    expect(
      readOllamaEmbeddingSmokeConfig({ KEC_EMBED_PROVIDER: "ollama" }),
    ).toEqual({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      timeoutMs: 30_000,
    });
  });

  it("accepts exact custom values without trimming", () => {
    const config = readOllamaEmbeddingSmokeConfig({
      KEC_EMBED_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "https://ollama.internal:11434/",
      OLLAMA_EMBED_MODEL: " custom-model ",
      OLLAMA_EMBED_TIMEOUT_MS: "45000",
    });

    expect(config).toEqual({
      baseUrl: "https://ollama.internal:11434/",
      model: " custom-model ",
      timeoutMs: 45_000,
    });
  });

  it.each([
    "",
    "relative/path",
    "ftp://localhost:11434",
    "http://user@localhost:11434",
    "http://user:password@localhost:11434",
    "http://localhost:11434?secret=yes",
    "http://localhost:11434#secret",
    "http://localhost:11434/prefix",
    " http://localhost:11434",
    "http://localhost:11434 ",
  ])("rejects invalid base URL %j", (baseUrl) => {
    expect(() =>
      readOllamaEmbeddingSmokeConfig({
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_BASE_URL: baseUrl,
      }),
    ).toThrow(smokeErrors.invalidConfiguration);
  });

  it("rejects an empty model while preserving non-empty bytes", () => {
    expect(() =>
      readOllamaEmbeddingSmokeConfig({
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_EMBED_MODEL: "",
      }),
    ).toThrow(smokeErrors.invalidConfiguration);

    expect(
      readOllamaEmbeddingSmokeConfig({
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_EMBED_MODEL: " model ",
      }).model,
    ).toBe(" model ");
  });

  it.each([
    "",
    "0",
    "-1",
    "120001",
    "1.5",
    "+1",
    "01",
    " 1",
    "1 ",
    "9007199254740992",
    "NaN",
    "Infinity",
  ])("rejects invalid timeout text %j", (timeout) => {
    expect(() =>
      readOllamaEmbeddingSmokeConfig({
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_EMBED_TIMEOUT_MS: timeout,
      }),
    ).toThrow(smokeErrors.invalidConfiguration);
  });

  it("accepts the timeout boundaries", () => {
    expect(
      readOllamaEmbeddingSmokeConfig({
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_EMBED_TIMEOUT_MS: "1",
      }).timeoutMs,
    ).toBe(1);
    expect(
      readOllamaEmbeddingSmokeConfig({
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_EMBED_TIMEOUT_MS: "120000",
      }).timeoutMs,
    ).toBe(120_000);
  });

  it("reads selected own data descriptors without getters or enumeration", () => {
    let getterCalls = 0;
    let enumerationCalls = 0;
    const target = {
      KEC_EMBED_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_EMBED_MODEL: "nomic-embed-text",
      OLLAMA_EMBED_TIMEOUT_MS: "30000",
      UNRELATED_SECRET: "ignored",
    };
    Object.defineProperty(target, "UNRELATED_GETTER", {
      get: () => {
        getterCalls += 1;
        return "secret";
      },
    });
    const environment = new Proxy(target, {
      get: () => {
        getterCalls += 1;
        throw new Error("environment property access is forbidden");
      },
      ownKeys: () => {
        enumerationCalls += 1;
        throw new Error("environment enumeration is forbidden");
      },
    });

    expect(
      readOllamaEmbeddingSmokeConfig(
        environment as OllamaEmbeddingSmokeEnvironment,
      ),
    ).toEqual({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      timeoutMs: 30_000,
    });
    expect(getterCalls).toBe(0);
    expect(enumerationCalls).toBe(0);
  });

  it("rejects selected accessors without invoking them", () => {
    for (const key of [
      "KEC_EMBED_PROVIDER",
      "OLLAMA_BASE_URL",
      "OLLAMA_EMBED_MODEL",
      "OLLAMA_EMBED_TIMEOUT_MS",
    ] as const) {
      let getterCalls = 0;
      const environment: Record<string, unknown> = {
        KEC_EMBED_PROVIDER: "ollama",
      };
      Object.defineProperty(environment, key, {
        configurable: true,
        get: () => {
          getterCalls += 1;
          return key === "KEC_EMBED_PROVIDER" ? "ollama" : "value";
        },
      });

      expect(() =>
        readOllamaEmbeddingSmokeConfig(
          environment as OllamaEmbeddingSmokeEnvironment,
        ),
      ).toThrow(smokeErrors.invalidConfiguration);
      expect(getterCalls).toBe(0);
    }
  });
});

describe("Ollama embedding smoke request and success contract", () => {
  it.each([
    ["http://localhost:11434", "http://localhost:11434/api/embeddings"],
    ["http://localhost:11434/", "http://localhost:11434/api/embeddings"],
  ])("constructs the exact endpoint from %s", async (baseUrl, endpoint) => {
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    await probeOllamaEmbedding(smokeConfig({ baseUrl }), {
      fetch: recorder.fetch,
    });

    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].input).toBe(endpoint);
  });

  it("sends exactly one fixed POST request without credentials or discovery", async () => {
    const recorder = createFetchRecorder(async () =>
      createJsonResponse([0.1, 0.2, 0.3]),
    );

    await probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch });

    expect(recorder.calls).toHaveLength(1);
    const call = recorder.calls[0];
    expect(call.init?.method).toBe("POST");
    expect(call.init?.redirect).toBe("error");
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect(headerValue(call, "content-type")).toBe("application/json");
    expect(headerValue(call, "authorization")).toBeNull();
    expect(requestBody(call)).toEqual({
      model: "nomic-embed-text",
      prompt: smokeProbeText,
    });
    expect(String(call.input)).not.toMatch(/\/api\/(?:tags|pull|show)\b/u);
  });

  it.each([
    { baseUrl: "", model: "model", timeoutMs: 10 },
    { baseUrl: "relative", model: "model", timeoutMs: 10 },
    { baseUrl: "http://localhost:11434/path", model: "model", timeoutMs: 10 },
    { baseUrl: "http://localhost:11434", model: "", timeoutMs: 10 },
    { baseUrl: "http://localhost:11434", model: "model", timeoutMs: 0 },
    { baseUrl: "http://localhost:11434", model: "model", timeoutMs: 120_001 },
    { baseUrl: "http://localhost:11434", model: "model", timeoutMs: 1.5 },
    { baseUrl: "http://localhost:11434", model: "model", timeoutMs: Infinity },
  ])("validates direct config before fetch: $baseUrl", async (config) => {
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    await expectSmokeError(
      probeOllamaEmbedding(config as OllamaEmbeddingSmokeConfig, {
        fetch: recorder.fetch,
      }),
      smokeErrors.invalidConfiguration,
    );
    expect(recorder.calls).toHaveLength(0);
  });

  it.each([
    [createSizedEmbedding(1), 1],
    [createSizedEmbedding(384), 384],
    [createSizedEmbedding(65_536), 65_536],
  ])(
    "accepts a usable vector of dimension %i",
    async (embedding, dimension) => {
      const recorder = createFetchRecorder(async () =>
        createResponseWithJsonValue({ embedding }),
      );

      const result = await probeOllamaEmbedding(smokeConfig(), {
        fetch: recorder.fetch,
      });

      expect(result).toEqual({
        schemaVersion: 1,
        status: "READY",
        provider: "ollama",
        observedDimension: dimension,
      });
      expect(Object.keys(result)).toEqual([
        "schemaVersion",
        "status",
        "provider",
        "observedDimension",
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(result).not.toHaveProperty("embedding");
    },
  );

  it("returns fresh equivalent results without retaining source references", async () => {
    const embedding = [0.25, 0.5];
    const config = smokeConfig();
    const recorder = createFetchRecorder(async () =>
      createResponseWithJsonValue({ embedding }),
    );

    const first = await probeOllamaEmbedding(config, { fetch: recorder.fetch });
    embedding[0] = 99;
    const second = await probeOllamaEmbedding(config, {
      fetch: recorder.fetch,
    });

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).not.toBe(config);
    expect(first).not.toBe(embedding);
    expect(recorder.calls).toHaveLength(2);
  });
});

describe("Ollama embedding smoke response rejection", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["fractional", 200.5],
    ["string", "200"],
  ])("rejects malformed $0 response status", async (_name, status) => {
    const response = createResponseWithOwnStatus(status);
    const jsonSpy = vi.spyOn(response, "json");
    const recorder = createFetchRecorder(async () => response);

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );

    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing response status", async () => {
    const response = Object.create(Response.prototype) as Response;
    Object.defineProperty(response, "json", {
      configurable: true,
      value: async () => ({ embedding: [1] }),
    });
    const recorder = createFetchRecorder(async () => response);

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );
  });

  it("rejects an inherited response status", async () => {
    const response = createResponseWithJsonValue({ embedding: [1] });
    const prototype = Object.create(Response.prototype) as object;
    Object.defineProperty(prototype, "status", {
      configurable: true,
      value: 200,
    });
    Object.setPrototypeOf(response, prototype);
    const recorder = createFetchRecorder(async () => response);

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );
  });

  it("rejects an accessor-backed status without invoking it", async () => {
    let getterCalls = 0;
    const response = createResponseWithJsonValue({ embedding: [1] });
    Object.defineProperty(response, "status", {
      configurable: true,
      get: () => {
        getterCalls += 1;
        return 200;
      },
    });
    const recorder = createFetchRecorder(async () => response);

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );
    expect(getterCalls).toBe(0);
  });

  it.each([200, 299])("accepts valid HTTP status %i", async (status) => {
    const recorder = createFetchRecorder(async () =>
      createResponseWithOwnStatus(status),
    );

    await expect(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    ).resolves.toMatchObject({ status: "READY" });
  });

  it("maps HTTP 300 to request rejected without reading JSON", async () => {
    const response = createResponseWithOwnStatus(300);
    const jsonSpy = vi.spyOn(response, "json");
    const recorder = createFetchRecorder(async () => response);

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.requestRejected,
    );
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it.each([400, 404, 500] as const)(
    "maps HTTP %i to a fixed request rejection without reading JSON",
    async (status) => {
      const response = createRejectedResponse(status);
      const jsonSpy = vi.spyOn(response, "json");
      const textSpy = vi.spyOn(response, "text");
      const recorder = createFetchRecorder(async () => response);

      await expectSmokeError(
        probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
        smokeErrors.requestRejected,
      );

      expect(recorder.calls).toHaveLength(1);
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(textSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["malformed JSON", createMalformedJsonResponse()],
    ["JSON null", createJsonValueResponse(null)],
    ["primitive JSON", createJsonValueResponse("embedding")],
    ["array root", createJsonValueResponse([[1]])],
    ["missing embedding", createJsonValueResponse({ ok: true })],
    [
      "inherited embedding",
      createResponseWithJsonValue(createInheritedEmbeddingResponse()),
    ],
    ["null embedding", createJsonValueResponse({ embedding: null })],
    ["string embedding", createJsonValueResponse({ embedding: "1,2" })],
    [
      "object embedding",
      createJsonValueResponse({ embedding: { 0: 1, length: 1 } }),
    ],
    [
      "typed embedding",
      createResponseWithJsonValue({ embedding: new Float32Array([1]) }),
    ],
    ["empty embedding", createJsonValueResponse({ embedding: [] })],
    [
      "sparse embedding",
      createResponseWithJsonValue({ embedding: createSparseEmbedding() }),
    ],
    [
      "inherited numeric index",
      createResponseWithJsonValue({
        embedding: createInheritedIndexEmbedding(),
      }),
    ],
    ["non-number", createResponseWithJsonValue({ embedding: [1, "2"] })],
    ["NaN", createResponseWithJsonValue({ embedding: [Number.NaN] })],
    [
      "Infinity",
      createResponseWithJsonValue({ embedding: [Number.POSITIVE_INFINITY] }),
    ],
    [
      "-Infinity",
      createResponseWithJsonValue({ embedding: [Number.NEGATIVE_INFINITY] }),
    ],
    [
      "oversized",
      createResponseWithJsonValue({ embedding: createSizedEmbedding(65_537) }),
    ],
  ])("rejects $0 as an invalid response", async (_name, response) => {
    const recorder = createFetchRecorder(async () => response);

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );
    expect(recorder.calls).toHaveLength(1);
  });

  it("rejects an embedding accessor without invoking it", async () => {
    const hostile = createGetterEmbeddingResponse();
    const recorder = createFetchRecorder(async () =>
      createResponseWithJsonValue(hostile.value),
    );

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );
    expect(hostile.getterCalls()).toBe(0);
  });

  it("rejects an element accessor without invoking it", async () => {
    const hostile = createGetterEmbedding();
    const recorder = createFetchRecorder(async () =>
      createResponseWithJsonValue({ embedding: hostile.embedding }),
    );

    await expectSmokeError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      smokeErrors.invalidResponse,
    );
    expect(hostile.getterCalls()).toBe(0);
  });
});

describe("Ollama embedding smoke timeout and network failures", () => {
  it("times out an unresolved fetch without retry", async () => {
    vi.useFakeTimers();
    const recorder = createNeverResolvingFetch();
    const operation = probeOllamaEmbedding(smokeConfig({ timeoutMs: 25 }), {
      fetch: recorder.fetch,
    });
    operation.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(25);
    await expectSmokeError(operation, smokeErrors.requestTimeout);
    expect(recorder.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps timeout ownership through unresolved JSON consumption", async () => {
    vi.useFakeTimers();
    const recorder = createFetchRecorder(async () =>
      createNeverResolvingJsonResponse(),
    );
    const operation = probeOllamaEmbedding(smokeConfig({ timeoutMs: 30 }), {
      fetch: recorder.fetch,
    });
    operation.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(30);
    await expectSmokeError(operation, smokeErrors.requestTimeout);
    expect(recorder.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("classifies smoke-owned abort rejection as timeout", async () => {
    vi.useFakeTimers();
    const recorder = createAbortAwareFetch();
    const operation = probeOllamaEmbedding(smokeConfig({ timeoutMs: 35 }), {
      fetch: recorder.fetch,
    });
    operation.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(35);
    await expectSmokeError(operation, smokeErrors.requestTimeout);
    expect(recorder.calls).toHaveLength(1);
  });

  it("clears the timer after success before the deadline", async () => {
    vi.useFakeTimers();
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    await expect(
      probeOllamaEmbedding(smokeConfig({ timeoutMs: 100 }), {
        fetch: recorder.fetch,
      }),
    ).resolves.toMatchObject({ status: "READY" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer after HTTP, JSON, and network failures", async () => {
    vi.useFakeTimers();
    const recorders = [
      createFetchRecorder(async () => createRejectedResponse(500)),
      createFetchRecorder(async () => createMalformedJsonResponse()),
      createFetchRecorder(async () => {
        throw new Error("secret-network-message");
      }),
    ];

    for (const recorder of recorders) {
      await captureError(
        probeOllamaEmbedding(smokeConfig({ timeoutMs: 100 }), {
          fetch: recorder.fetch,
        }),
      );
      expect(recorder.calls).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each([
    ["Error rejection", new Error("secret-network-message")],
    ["non-Error rejection", "secret-network-message"],
    ["non-smoke abort", new DOMException("secret abort reason", "AbortError")],
  ])(
    "maps $0 to endpoint unavailable without retry",
    async (_name, failure) => {
      const recorder = createFetchRecorder(async () => Promise.reject(failure));

      await expectSmokeError(
        probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
        smokeErrors.endpointUnavailable,
      );
      expect(recorder.calls).toHaveLength(1);
    },
  );
});

describe("Ollama embedding smoke serialization", () => {
  it("emits exact compact JSON with one LF and stable key order", () => {
    const result = Object.freeze({
      schemaVersion: 1 as const,
      status: "READY" as const,
      provider: "ollama" as const,
      observedDimension: 768,
    });
    const originalDescriptors = Object.getOwnPropertyDescriptors(result);

    const first = serializeOllamaEmbeddingSmoke(result);
    const second = serializeOllamaEmbeddingSmoke(result);

    expect(first).toBe(
      '{"schemaVersion":1,"status":"READY","provider":"ollama","observedDimension":768}\n',
    );
    expect(second).toBe(first);
    expect(first).not.toContain("\r");
    expect(first).not.toContain("  ");
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(Object.getOwnPropertyDescriptors(result)).toEqual(
      originalDescriptors,
    );
  });
});
