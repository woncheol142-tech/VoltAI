import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmbeddingProviderFromEnv,
  LocalPlaceholderEmbeddingProvider,
  OllamaEmbeddingProvider,
} from "../src/knowledge/embedding.js";

const originalEnv = {
  KEC_EMBED_PROVIDER: process.env.KEC_EMBED_PROVIDER,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL,
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

  it("creates placeholder or ollama providers from environment without OpenAI API", () => {
    delete process.env.OPENAI_API_KEY;

    delete process.env.KEC_EMBED_PROVIDER;
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(LocalPlaceholderEmbeddingProvider);

    process.env.KEC_EMBED_PROVIDER = "placeholder";
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(LocalPlaceholderEmbeddingProvider);

    process.env.KEC_EMBED_PROVIDER = "ollama";
    expect(createEmbeddingProviderFromEnv()).toBeInstanceOf(OllamaEmbeddingProvider);
  });
});
