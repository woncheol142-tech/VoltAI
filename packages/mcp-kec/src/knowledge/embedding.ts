export type EmbeddingProviderMetadata = {
  provider: string;
  model: string;
};

export type EmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
  getMetadata: () => EmbeddingProviderMetadata;
};

export class LocalPlaceholderEmbeddingProvider implements EmbeddingProvider {
  getMetadata(): EmbeddingProviderMetadata {
    return {
      provider: "placeholder",
      model: "local-placeholder",
    };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();

    return [
      normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0,
      normalized.includes("ground") || normalized.includes("접지") ? 1 : 0,
      normalized.includes("breaker") || normalized.includes("차단기") ? 1 : 0,
      normalized.length > 0 ? 1 : 0,
    ];
  }
}

export class LocalHashEmbeddingProvider extends LocalPlaceholderEmbeddingProvider {}

export type OllamaEmbeddingProviderOptions = {
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
};

type OllamaEmbeddingResponse = {
  embedding?: unknown;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    );
    this.model = options.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
    this.fetchFn = options.fetch ?? fetch;
  }

  getMetadata(): EmbeddingProviderMetadata {
    return {
      provider: "ollama",
      model: this.model,
    };
  }

  async embed(text: string): Promise<number[]> {
    let response: Response;

    try {
      response = await this.fetchFn(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown network error";
      throw new Error(`Ollama embedding request failed: ${message}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama embedding request failed: ${response.status}${body ? ` ${body}` : ""}`,
      );
    }

    const json = (await response.json()) as OllamaEmbeddingResponse;

    if (!isNumberArray(json.embedding)) {
      throw new Error("Ollama embedding response did not include an embedding");
    }

    return json.embedding;
  }
}

export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const provider = process.env.KEC_EMBED_PROVIDER ?? "placeholder";

  if (provider === "placeholder") {
    return new LocalPlaceholderEmbeddingProvider();
  }

  if (provider === "ollama") {
    return new OllamaEmbeddingProvider();
  }

  throw new Error("KEC_EMBED_PROVIDER must be placeholder or ollama");
}
