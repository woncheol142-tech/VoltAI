export type OllamaEmbeddingSmokeEnvironment = Readonly<{
  KEC_EMBED_PROVIDER?: unknown;
  OLLAMA_BASE_URL?: unknown;
  OLLAMA_EMBED_MODEL?: unknown;
  OLLAMA_EMBED_TIMEOUT_MS?: unknown;
}>;

export type OllamaEmbeddingSmokeConfig = Readonly<{
  baseUrl: string;
  model: string;
  timeoutMs: number;
}>;

export type OllamaEmbeddingSmokeResultV1 = Readonly<{
  schemaVersion: 1;
  status: "READY";
  provider: "ollama";
  observedDimension: number;
}>;

export type OllamaEmbeddingSmokeDependencies = Readonly<{
  fetch: typeof fetch;
}>;
