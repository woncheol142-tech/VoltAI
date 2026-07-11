import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmbeddingProviderFromEnv,
  LocalPlaceholderEmbeddingProvider,
  OllamaEmbeddingProvider,
  OllamaTimeoutError,
} from "../src/knowledge/embedding.js";

const originalEnv = {
  KEC_EMBED_PROVIDER: process.env.KEC_EMBED_PROVIDER,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL,
  OLLAMA_EMBED_TIMEOUT_MS: process.env.OLLAMA_EMBED_TIMEOUT_MS,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("OllamaEmbeddingProvider", () => {
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("calls /api/embeddings with the default nomic-embed-text model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock });

    const embedding = await provider.embed("KEC cable rule");

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: "KEC cable rule",
      }),
    });
  });

  it("uses OLLAMA_BASE_URL and OLLAMA_EMBED_MODEL from the environment", async () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.internal:11434/";
    process.env.OLLAMA_EMBED_MODEL = "custom-embed";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embedding: [1, 2] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock });

    await provider.embed("접지 기준");

    expect(fetchMock).toHaveBeenCalledWith("http://ollama.internal:11434/api/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        model: "custom-embed",
        prompt: "접지 기준",
      }),
    });
  });

  it("returns a clear error when Ollama responds with HTTP failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("model not found", { status: 404 }));
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock });

    await expect(provider.embed("KEC")).rejects.toThrow(
      "Ollama embedding request failed: 404 model not found",
    );
  });

  it("returns a clear error when Ollama response is invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock });

    await expect(provider.embed("KEC")).rejects.toThrow(
      "Ollama embedding response did not include an embedding",
    );
  });

  it("times out a pending Ollama request with a dedicated timeout error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.signal) {
        return Promise.reject(new Error("fetch signal is required"));
      }

      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock, timeoutMs: 25 });

    const embeddingPromise = provider.embed("KEC timeout");
    embeddingPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(25);

    await expect(embeddingPromise).rejects.toBeInstanceOf(OllamaTimeoutError);
    await expect(embeddingPromise).rejects.toMatchObject({
      name: "OllamaTimeoutError",
      message: "Ollama embedding request timed out after 25ms",
    });
  });

  it("uses OLLAMA_EMBED_TIMEOUT_MS when constructor timeoutMs is not provided", async () => {
    process.env.OLLAMA_EMBED_TIMEOUT_MS = "40";
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.signal) {
        return Promise.reject(new Error("fetch signal is required"));
      }

      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock });

    const embeddingPromise = provider.embed("KEC timeout");
    embeddingPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(40);

    await expect(embeddingPromise).rejects.toThrow(
      "Ollama embedding request timed out after 40ms",
    );
  });

  it("prefers constructor timeoutMs over OLLAMA_EMBED_TIMEOUT_MS", async () => {
    process.env.OLLAMA_EMBED_TIMEOUT_MS = "1000";
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.signal) {
        return Promise.reject(new Error("fetch signal is required"));
      }

      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock, timeoutMs: 30 });

    const embeddingPromise = provider.embed("KEC timeout");
    embeddingPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(30);

    await expect(embeddingPromise).rejects.toThrow(
      "Ollama embedding request timed out after 30ms",
    );
  });

  it("does not convert non-timeout AbortError failures into timeout errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("User cancelled", "AbortError"));
    const provider = new OllamaEmbeddingProvider({ fetch: fetchMock, timeoutMs: 1000 });

    let error: unknown;

    try {
      await provider.embed("KEC");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Ollama embedding request failed: User cancelled");
    expect((error as Error).name).not.toBe("OllamaTimeoutError");
  });

  it("cleans up the fallback timer when fetch completes before timeout", async () => {
    const originalTimeout = AbortSignal.timeout;
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    // Force the fallback path so timer cleanup is observable even on Node versions
    // that support AbortSignal.timeout().
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.4, 0.5] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    try {
      const provider = new OllamaEmbeddingProvider({ fetch: fetchMock, timeoutMs: 1000 });

      await expect(provider.embed("fast")).resolves.toEqual([0.4, 0.5]);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(abortSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(AbortSignal, "timeout", {
        configurable: true,
        value: originalTimeout,
      });
    }
  });

  it("creates explicitly selected placeholder or ollama providers without OpenAI API", () => {
    delete process.env.OPENAI_API_KEY;

    process.env.KEC_EMBED_PROVIDER = "placeholder";
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(LocalPlaceholderEmbeddingProvider);

    process.env.KEC_EMBED_PROVIDER = "ollama";
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(OllamaEmbeddingProvider);
  });
});
