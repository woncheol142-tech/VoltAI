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
  timeoutMs?: number;
};

type OllamaEmbeddingResponse = {
  embedding?: unknown;
};

type TimeoutSignal = {
  signal: AbortSignal;
  isTimedOut: () => boolean;
  cleanup: () => void;
};

const defaultOllamaEmbedTimeoutMs = 30_000;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function parsePositiveIntegerEnv(name: string): number | undefined {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function resolveTimeoutMs(optionTimeoutMs: number | undefined): number {
  if (optionTimeoutMs !== undefined) {
    if (!Number.isInteger(optionTimeoutMs) || optionTimeoutMs < 1) {
      throw new Error("timeoutMs must be a positive integer");
    }

    return optionTimeoutMs;
  }

  return parsePositiveIntegerEnv("OLLAMA_EMBED_TIMEOUT_MS") ?? defaultOllamaEmbedTimeoutMs;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createTimeoutSignal(timeoutMs: number): TimeoutSignal {
  if (typeof AbortSignal.timeout === "function") {
    const signal = AbortSignal.timeout(timeoutMs);

    return {
      signal,
      isTimedOut: () => signal.aborted,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
    },
  };
}

export class OllamaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Ollama embedding request timed out after ${timeoutMs}ms`);
    this.name = "OllamaTimeoutError";
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    );
    this.model = options.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
  }

  getMetadata(): EmbeddingProviderMetadata {
    return {
      provider: "ollama",
      model: this.model,
    };
  }

  async embed(text: string): Promise<number[]> {
    let response: Response;
    const timeoutSignal = createTimeoutSignal(this.timeoutMs);

    try {
      response = await this.fetchFn(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: timeoutSignal.signal,
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });
    } catch (error) {
      if (isAbortError(error) && timeoutSignal.isTimedOut()) {
        throw new OllamaTimeoutError(this.timeoutMs);
      }

      const message = error instanceof Error ? error.message : "unknown network error";
      throw new Error(`Ollama embedding request failed: ${message}`);
    } finally {
      timeoutSignal.cleanup();
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
  const provider = process.env.KEC_EMBED_PROVIDER;

  if (provider === undefined || provider.length === 0) {
    throw new Error("KEC_EMBED_PROVIDER is required; set it to placeholder or ollama");
  }

  if (provider === "placeholder") {
    return new LocalPlaceholderEmbeddingProvider();
  }

  if (provider === "ollama") {
    return new OllamaEmbeddingProvider();
  }

  throw new Error("KEC_EMBED_PROVIDER must be placeholder or ollama");
}
