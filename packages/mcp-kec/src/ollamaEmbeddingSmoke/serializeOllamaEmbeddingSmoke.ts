import type { OllamaEmbeddingSmokeResultV1 } from "./types.js";

const INVALID_RESPONSE = "KEC_OLLAMA_EMBEDDING_SMOKE: INVALID_RESPONSE";
const MAX_DIMENSION = 65_536;
const RESULT_KEYS = [
  "schemaVersion",
  "status",
  "provider",
  "observedDimension",
] as const;

function invalidResponse(): Error {
  return new Error(INVALID_RESPONSE);
}

function readResultProperty(
  result: object,
  key: (typeof RESULT_KEYS)[number],
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(result, key);
  } catch {
    throw invalidResponse();
  }
  if (descriptor === undefined || !("value" in descriptor)) {
    throw invalidResponse();
  }
  return descriptor.value;
}

function validateResult(result: OllamaEmbeddingSmokeResultV1): number {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw invalidResponse();
  }

  let names: string[];
  let symbols: symbol[];
  try {
    names = Object.getOwnPropertyNames(result);
    symbols = Object.getOwnPropertySymbols(result);
  } catch {
    throw invalidResponse();
  }
  if (
    names.length !== RESULT_KEYS.length ||
    RESULT_KEYS.some((key) => !names.includes(key)) ||
    symbols.length !== 0
  ) {
    throw invalidResponse();
  }

  if (
    readResultProperty(result, "schemaVersion") !== 1 ||
    readResultProperty(result, "status") !== "READY" ||
    readResultProperty(result, "provider") !== "ollama"
  ) {
    throw invalidResponse();
  }

  const observedDimension = readResultProperty(result, "observedDimension");
  if (
    typeof observedDimension !== "number" ||
    !Number.isSafeInteger(observedDimension) ||
    observedDimension < 1 ||
    observedDimension > MAX_DIMENSION
  ) {
    throw invalidResponse();
  }
  return observedDimension;
}

export function serializeOllamaEmbeddingSmoke(
  result: OllamaEmbeddingSmokeResultV1,
): string {
  const observedDimension = validateResult(result);
  return `${JSON.stringify({
    schemaVersion: 1,
    status: "READY",
    provider: "ollama",
    observedDimension,
  })}\n`;
}
