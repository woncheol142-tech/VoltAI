import type {
  OllamaEmbeddingSmokeConfig,
  OllamaEmbeddingSmokeEnvironment,
} from "./types.js";

type EnvironmentKey = keyof OllamaEmbeddingSmokeEnvironment;

type EnvironmentValue =
  Readonly<{ present: false }> | Readonly<{ present: true; value: unknown }>;

const INVALID_CONFIGURATION =
  "KEC_OLLAMA_EMBEDDING_SMOKE: INVALID_CONFIGURATION";
const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function invalidConfiguration(): Error {
  return new Error(INVALID_CONFIGURATION);
}

function readEnvironmentValue(
  environment: OllamaEmbeddingSmokeEnvironment,
  key: EnvironmentKey,
): EnvironmentValue {
  if (
    typeof environment !== "object" ||
    environment === null ||
    Array.isArray(environment)
  ) {
    throw invalidConfiguration();
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(environment, key);
  } catch {
    throw invalidConfiguration();
  }

  if (descriptor === undefined) {
    return { present: false };
  }
  if (!("value" in descriptor)) {
    throw invalidConfiguration();
  }

  return { present: true, value: descriptor.value };
}

function validateBaseUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /^\s|\s$/u.test(value)
  ) {
    throw invalidConfiguration();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidConfiguration();
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length !== 0 ||
    parsed.password.length !== 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    parsed.pathname !== "/"
  ) {
    throw invalidConfiguration();
  }

  return value;
}

function validateModel(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidConfiguration();
  }
  return value;
}

function parseTimeout(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw invalidConfiguration();
  }

  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) {
    throw invalidConfiguration();
  }
  return timeoutMs;
}

export function readOllamaEmbeddingSmokeConfig(
  environment: OllamaEmbeddingSmokeEnvironment,
): OllamaEmbeddingSmokeConfig {
  const provider = readEnvironmentValue(environment, "KEC_EMBED_PROVIDER");
  if (!provider.present || provider.value !== "ollama") {
    throw invalidConfiguration();
  }

  const baseUrlValue = readEnvironmentValue(environment, "OLLAMA_BASE_URL");
  const modelValue = readEnvironmentValue(environment, "OLLAMA_EMBED_MODEL");
  const timeoutValue = readEnvironmentValue(
    environment,
    "OLLAMA_EMBED_TIMEOUT_MS",
  );

  return Object.freeze({
    baseUrl: baseUrlValue.present
      ? validateBaseUrl(baseUrlValue.value)
      : DEFAULT_BASE_URL,
    model: modelValue.present ? validateModel(modelValue.value) : DEFAULT_MODEL,
    timeoutMs: timeoutValue.present
      ? parseTimeout(timeoutValue.value)
      : DEFAULT_TIMEOUT_MS,
  });
}
