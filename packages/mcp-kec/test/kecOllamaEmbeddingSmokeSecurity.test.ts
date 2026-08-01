import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeOllamaEmbedding } from "../src/ollamaEmbeddingSmoke/probeOllamaEmbedding.js";
import { readOllamaEmbeddingSmokeConfig } from "../src/ollamaEmbeddingSmoke/readOllamaEmbeddingSmokeConfig.js";
import type {
  OllamaEmbeddingSmokeConfig,
  OllamaEmbeddingSmokeEnvironment,
} from "../src/ollamaEmbeddingSmoke/types.js";
import {
  createFetchRecorder,
  createHostileThrownValue,
  createHostileValue,
  createJsonResponse,
  createRejectedResponse,
  createResponseWithJsonValue,
  redactionSentinels,
  smokeConfig,
  smokeErrors,
} from "./helpers/kecOllamaEmbeddingSmokeFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const sourceRoot = join(packageRoot, "src", "ollamaEmbeddingSmoke");
const expectedProductionFiles = [
  "index.ts",
  "probeOllamaEmbedding.ts",
  "readOllamaEmbeddingSmokeConfig.ts",
  "serializeOllamaEmbeddingSmoke.ts",
  "types.ts",
];

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return error;
  }
}

function fixedMessage(error: unknown): string {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) {
    return "";
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : "";
}

function expectRedacted(text: string): void {
  for (const sentinel of redactionSentinels) {
    expect(text).not.toContain(sentinel);
  }
  expect(text).not.toMatch(/https?:\/\//u);
  expect(text).not.toMatch(/\b(?:400|404|500)\b/u);
  expect(text).not.toMatch(/embedding\s*[:=]\s*\[/iu);
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Ollama embedding smoke hostile input safety", () => {
  it.each(["baseUrl", "model", "timeoutMs"] as const)(
    "does not coerce a hostile %s value",
    async (field) => {
      const hostile = createHostileValue();
      const config = {
        ...smokeConfig(),
        [field]: hostile.value,
      } as unknown as OllamaEmbeddingSmokeConfig;
      const recorder = createFetchRecorder(async () => createJsonResponse([1]));

      const error = await captureError(
        probeOllamaEmbedding(config, { fetch: recorder.fetch }),
      );

      expect(fixedMessage(error)).toBe(smokeErrors.invalidConfiguration);
      expect(hostile.calls()).toBe(0);
      expect(recorder.calls).toHaveLength(0);
    },
  );

  it("does not coerce a hostile config container", async () => {
    const hostile = createHostileValue();
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    const error = await captureError(
      probeOllamaEmbedding(hostile.value as OllamaEmbeddingSmokeConfig, {
        fetch: recorder.fetch,
      }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.invalidConfiguration);
    expect(hostile.calls()).toBe(0);
    expect(recorder.calls).toHaveLength(0);
  });

  it("rejects direct config accessors without invoking them", async () => {
    for (const key of ["baseUrl", "model", "timeoutMs"] as const) {
      let getterCalls = 0;
      const config: Record<string, unknown> = {
        baseUrl: "http://localhost:11434",
        model: "nomic-embed-text",
        timeoutMs: 30_000,
      };
      Object.defineProperty(config, key, {
        configurable: true,
        get: () => {
          getterCalls += 1;
          return key === "timeoutMs" ? 30_000 : "hostile";
        },
      });
      const recorder = createFetchRecorder(async () => createJsonResponse([1]));

      const error = await captureError(
        probeOllamaEmbedding(config as OllamaEmbeddingSmokeConfig, {
          fetch: recorder.fetch,
        }),
      );

      expect(fixedMessage(error)).toBe(smokeErrors.invalidConfiguration);
      expect(getterCalls).toBe(0);
      expect(recorder.calls).toHaveLength(0);
    }
  });

  it("rejects inherited direct config fields before fetch", async () => {
    const config = Object.create(smokeConfig()) as OllamaEmbeddingSmokeConfig;
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    const error = await captureError(
      probeOllamaEmbedding(config, { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.invalidConfiguration);
    expect(recorder.calls).toHaveLength(0);
  });

  it("does not coerce hostile environment values or enumerate unrelated keys", () => {
    const hostile = createHostileValue();
    let enumerationCalls = 0;
    const environment = new Proxy(
      {
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_BASE_URL: hostile.value,
        SECRET_API_KEY: "secret-api-key",
      },
      {
        ownKeys: () => {
          enumerationCalls += 1;
          throw new Error("environment enumeration executed");
        },
      },
    );

    expect(() =>
      readOllamaEmbeddingSmokeConfig(
        environment as OllamaEmbeddingSmokeEnvironment,
      ),
    ).toThrow(smokeErrors.invalidConfiguration);
    expect(hostile.calls()).toBe(0);
    expect(enumerationCalls).toBe(0);
  });

  it("does not inspect or coerce hostile thrown values", async () => {
    const hostile = createHostileThrownValue();
    const recorder = createFetchRecorder(async () =>
      Promise.reject(hostile.thrown),
    );

    const error = await captureError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.endpointUnavailable);
    expect(hostile.calls()).toBe(0);
    expect(recorder.calls).toHaveLength(1);
  });

  it("does not coerce hostile JSON roots or embedding values", async () => {
    const hostileRoot = createHostileValue();
    const hostileEmbedding = createHostileValue();

    for (const { hostile, payload } of [
      { hostile: hostileRoot, payload: hostileRoot.value },
      {
        hostile: hostileEmbedding,
        payload: { embedding: hostileEmbedding.value },
      },
    ]) {
      const recorder = createFetchRecorder(async () =>
        createResponseWithJsonValue(payload),
      );

      const error = await captureError(
        probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      );

      expect(fixedMessage(error)).toBe(smokeErrors.invalidResponse);
      expect(hostile.calls()).toBe(0);
    }
  });

  it.each(["root", "embedding"] as const)(
    "normalizes a revoked Proxy %s without leaking a raw error",
    async (location) => {
      const revocable = Proxy.revocable([], {});
      revocable.revoke();
      const payload =
        location === "root" ? revocable.proxy : { embedding: revocable.proxy };
      const recorder = createFetchRecorder(async () =>
        createResponseWithJsonValue(payload),
      );

      const error = await captureError(
        probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      );

      expect(error).toBeInstanceOf(Error);
      expect(fixedMessage(error)).toBe(smokeErrors.invalidResponse);
      expect(fixedMessage(error)).not.toMatch(/TypeError|IsArray|Proxy/iu);
    },
  );

  it("rejects a revoked Proxy vector element without inspecting it", async () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const recorder = createFetchRecorder(async () =>
      createResponseWithJsonValue({ embedding: [revocable.proxy] }),
    );

    const error = await captureError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.invalidResponse);
  });

  it("rejects a custom-prototype JSON object", async () => {
    const payload = Object.create({ safe: true }) as { embedding: number[] };
    Object.defineProperty(payload, "embedding", {
      configurable: true,
      enumerable: true,
      value: [1],
    });
    const recorder = createFetchRecorder(async () =>
      createResponseWithJsonValue(payload),
    );

    const error = await captureError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.invalidResponse);
  });

  it("does not execute response embedding or element getters", async () => {
    let embeddingGetterCalls = 0;
    let elementGetterCalls = 0;
    const payload = {};
    Object.defineProperty(payload, "embedding", {
      get: () => {
        embeddingGetterCalls += 1;
        return [1];
      },
    });
    const embedding = new Array<number>(1);
    Object.defineProperty(embedding, "0", {
      get: () => {
        elementGetterCalls += 1;
        return 1;
      },
    });

    for (const responseValue of [payload, { embedding }]) {
      const recorder = createFetchRecorder(async () =>
        createResponseWithJsonValue(responseValue),
      );
      const error = await captureError(
        probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      );
      expect(fixedMessage(error)).toBe(smokeErrors.invalidResponse);
    }

    expect(embeddingGetterCalls).toBe(0);
    expect(elementGetterCalls).toBe(0);
  });
});

describe("Ollama embedding smoke redaction", () => {
  it("redacts invalid configuration values", async () => {
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));
    const error = await captureError(
      probeOllamaEmbedding(
        {
          baseUrl:
            "http://secret-user:secret-password@secret-host.invalid:43127/secret-path",
          model: "secret-model",
          timeoutMs: 0,
        },
        { fetch: recorder.fetch },
      ),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.invalidConfiguration);
    expectRedacted(fixedMessage(error));
    expect(recorder.calls).toHaveLength(0);
  });

  it("redacts network errors and hostile causes", async () => {
    const failure = new Error("secret-network-message");
    failure.stack = "secret-stack";
    Object.defineProperty(failure, "cause", {
      value: "secret-api-key",
    });
    const recorder = createFetchRecorder(async () => Promise.reject(failure));
    const error = await captureError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.endpointUnavailable);
    expectRedacted(fixedMessage(error));
  });

  it.each([400, 404, 500] as const)(
    "redacts HTTP %i status, status text, and body",
    async (status) => {
      const recorder = createFetchRecorder(async () =>
        createRejectedResponse(status),
      );
      const error = await captureError(
        probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
      );

      expect(fixedMessage(error)).toBe(smokeErrors.requestRejected);
      expectRedacted(fixedMessage(error));
    },
  );

  it("redacts invalid response content and embedding values", async () => {
    const recorder = createFetchRecorder(async () =>
      createResponseWithJsonValue({
        message: "secret-response-body",
        embedding: [0.123456789, Number.POSITIVE_INFINITY],
      }),
    );
    const error = await captureError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.invalidResponse);
    expectRedacted(fixedMessage(error));
  });

  it("uses a fixed internal error without inspecting an invalid fetch result", async () => {
    const recorder = createFetchRecorder(
      async () => undefined as unknown as Response,
    );
    const error = await captureError(
      probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch }),
    );

    expect(fixedMessage(error)).toBe(smokeErrors.internalError);
    expectRedacted(fixedMessage(error));
  });

  it("keeps every approved error literal free of redaction sentinels", () => {
    for (const message of Object.values(smokeErrors)) {
      expectRedacted(message);
    }
  });
});

describe("Ollama embedding smoke request and side-effect boundaries", () => {
  it("rejects credentialed and path-bearing endpoints before fetch", async () => {
    for (const baseUrl of [
      "http://secret-user:secret-password@secret-host.invalid:43127",
      "http://secret-host.invalid:43127/secret-path",
    ]) {
      const recorder = createFetchRecorder(async () => createJsonResponse([1]));
      const error = await captureError(
        probeOllamaEmbedding(smokeConfig({ baseUrl }), {
          fetch: recorder.fetch,
        }),
      );

      expect(fixedMessage(error)).toBe(smokeErrors.invalidConfiguration);
      expect(recorder.calls).toHaveLength(0);
    }
  });

  it("uses one approved endpoint and no authorization header", async () => {
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    await probeOllamaEmbedding(smokeConfig(), { fetch: recorder.fetch });

    expect(recorder.calls).toHaveLength(1);
    expect(String(recorder.calls[0].input)).toBe(
      "http://localhost:11434/api/embeddings",
    );
    expect(
      new Headers(recorder.calls[0].init?.headers).has("authorization"),
    ).toBe(false);
    expect(recorder.calls[0].init?.redirect).toBe("error");
  });

  it("does not mutate global fetch, config, environment, or process state", async () => {
    const originalFetch = globalThis.fetch;
    const originalExitCode = process.exitCode;
    const config = smokeConfig();
    const configDescriptors = Object.getOwnPropertyDescriptors(config);
    const environment = {
      KEC_EMBED_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://localhost:11434",
    };
    const environmentDescriptors =
      Object.getOwnPropertyDescriptors(environment);
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    readOllamaEmbeddingSmokeConfig(environment);
    await probeOllamaEmbedding(config, { fetch: recorder.fetch });

    expect(globalThis.fetch).toBe(originalFetch);
    expect(process.exitCode).toBe(originalExitCode);
    expect(Object.getOwnPropertyDescriptors(config)).toEqual(configDescriptors);
    expect(Object.getOwnPropertyDescriptors(environment)).toEqual(
      environmentDescriptors,
    );
  });

  it("leaves no pending timers after a completed probe", async () => {
    vi.useFakeTimers();
    const recorder = createFetchRecorder(async () => createJsonResponse([1]));

    await probeOllamaEmbedding(smokeConfig({ timeoutMs: 100 }), {
      fetch: recorder.fetch,
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("reserves exactly the five approved internal production modules", () => {
    expect(existsSync(sourceRoot)).toBe(true);
    expect(
      readdirSync(sourceRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && extname(entry.name) === ".ts")
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(expectedProductionFiles);
  });

  it("adds no filesystem, database, provider, search, MCP, process, logging, or cache authority", () => {
    for (const fileName of expectedProductionFiles) {
      const path = join(sourceRoot, fileName);
      expect(existsSync(path)).toBe(true);
      const source = readFileSync(path, "utf8");
      const displayPath = relative(packageRoot, path);

      expect(source, displayPath).not.toMatch(
        /node:(?:fs|sqlite|child_process)|Sqlite|VectorStore|EmbeddingProvider|createEmbeddingProviderFromEnv|indexKec|searchKec|searchHybrid|runStdioServer|createVoltAiMcpServer|mcp-agent|agent-review/iu,
      );
      expect(source, displayPath).not.toMatch(
        /\b(?:eval|Function)\s*\(|console\.|logger|\.voltai|\.volt-ai|PROJECT_ROOT|KEC_DB_PATH|process\.exit|process\.env|globalThis\.fetch\s*=|\b(?:retry|fallback|cache)\b/iu,
      );
      expect(source, displayPath).not.toMatch(
        /\/api\/(?:tags|pull|show)\b|authorization|api[_-]?key|secret|token/iu,
      );
    }
  });
});
