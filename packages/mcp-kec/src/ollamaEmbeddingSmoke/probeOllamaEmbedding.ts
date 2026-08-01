import type {
  OllamaEmbeddingSmokeConfig,
  OllamaEmbeddingSmokeDependencies,
  OllamaEmbeddingSmokeResultV1,
} from "./types.js";

const ERROR_PREFIX = "KEC_OLLAMA_EMBEDDING_SMOKE: ";
const INVALID_CONFIGURATION = `${ERROR_PREFIX}INVALID_CONFIGURATION`;
const ENDPOINT_UNAVAILABLE = `${ERROR_PREFIX}ENDPOINT_UNAVAILABLE`;
const REQUEST_TIMEOUT = `${ERROR_PREFIX}REQUEST_TIMEOUT`;
const REQUEST_REJECTED = `${ERROR_PREFIX}REQUEST_REJECTED`;
const INVALID_RESPONSE = `${ERROR_PREFIX}INVALID_RESPONSE`;
const INTERNAL_ERROR = `${ERROR_PREFIX}INTERNAL_ERROR`;
const PROBE_TEXT = "volt-ai-ollama-embedding-smoke-v1";
const MAX_TIMEOUT_MS = 120_000;
const MAX_DIMENSION = 65_536;
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

type ValidatedConfig = Readonly<{
  endpoint: string;
  model: string;
  timeoutMs: number;
}>;

function smokeError(message: string): Error {
  return new Error(message);
}

function isArray(value: unknown, errorMessage: string): boolean {
  try {
    return Array.isArray(value);
  } catch {
    throw smokeError(errorMessage);
  }
}

function readOwnDataProperty(
  container: object,
  key: string,
  errorMessage: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(container, key);
  } catch {
    throw smokeError(errorMessage);
  }

  if (descriptor === undefined || !("value" in descriptor)) {
    throw smokeError(errorMessage);
  }
  return descriptor.value;
}

function validateBaseUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /^\s|\s$/u.test(value)
  ) {
    throw smokeError(INVALID_CONFIGURATION);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw smokeError(INVALID_CONFIGURATION);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length !== 0 ||
    parsed.password.length !== 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    parsed.pathname !== "/"
  ) {
    throw smokeError(INVALID_CONFIGURATION);
  }

  return `${parsed.origin}/api/embeddings`;
}

function validateConfig(config: OllamaEmbeddingSmokeConfig): ValidatedConfig {
  if (
    typeof config !== "object" ||
    config === null ||
    isArray(config, INVALID_CONFIGURATION)
  ) {
    throw smokeError(INVALID_CONFIGURATION);
  }

  const baseUrl = readOwnDataProperty(config, "baseUrl", INVALID_CONFIGURATION);
  const model = readOwnDataProperty(config, "model", INVALID_CONFIGURATION);
  const timeoutMs = readOwnDataProperty(
    config,
    "timeoutMs",
    INVALID_CONFIGURATION,
  );

  if (typeof model !== "string" || model.length === 0) {
    throw smokeError(INVALID_CONFIGURATION);
  }
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw smokeError(INVALID_CONFIGURATION);
  }

  return {
    endpoint: validateBaseUrl(baseUrl),
    model,
    timeoutMs,
  };
}

function validateDependencies(
  dependencies: OllamaEmbeddingSmokeDependencies,
): typeof fetch {
  if (
    typeof dependencies !== "object" ||
    dependencies === null ||
    isArray(dependencies, INTERNAL_ERROR)
  ) {
    throw smokeError(INTERNAL_ERROR);
  }

  const fetchValue = readOwnDataProperty(dependencies, "fetch", INTERNAL_ERROR);
  if (typeof fetchValue !== "function") {
    throw smokeError(INTERNAL_ERROR);
  }
  return fetchValue as typeof fetch;
}

function validateResponseStatus(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MIN_HTTP_STATUS ||
    value > MAX_HTTP_STATUS
  ) {
    throw smokeError(INVALID_RESPONSE);
  }
  return value;
}

function readResponseStatus(response: Response): number {
  let ownDescriptor: PropertyDescriptor | undefined;
  try {
    ownDescriptor = Object.getOwnPropertyDescriptor(response, "status");
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }

  if (ownDescriptor !== undefined) {
    if (!("value" in ownDescriptor)) {
      throw smokeError(INVALID_RESPONSE);
    }
    return validateResponseStatus(ownDescriptor.value);
  }

  let prototype: object | null;
  let statusDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(response) as object | null;
    statusDescriptor = Object.getOwnPropertyDescriptor(
      Response.prototype,
      "status",
    );
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }
  if (prototype !== Response.prototype) {
    throw smokeError(INVALID_RESPONSE);
  }
  if (statusDescriptor?.get === undefined) {
    throw smokeError(INTERNAL_ERROR);
  }

  try {
    return validateResponseStatus(statusDescriptor.get.call(response));
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }
}

function readJsonFunction(response: Response): () => Promise<unknown> {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(response, "json");
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }

  if (descriptor !== undefined) {
    if (!("value" in descriptor) || typeof descriptor.value !== "function") {
      throw smokeError(INVALID_RESPONSE);
    }
    return descriptor.value as () => Promise<unknown>;
  }

  return Response.prototype.json;
}

function assertResponse(value: unknown): Response {
  if (value === undefined || value === null) {
    throw smokeError(INTERNAL_ERROR);
  }

  let isResponse = false;
  try {
    isResponse = value instanceof Response;
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }
  if (!isResponse) {
    throw smokeError(INVALID_RESPONSE);
  }
  return value as Response;
}

function readEmbedding(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    isArray(value, INVALID_RESPONSE)
  ) {
    throw smokeError(INVALID_RESPONSE);
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw smokeError(INVALID_RESPONSE);
  }

  return readOwnDataProperty(value, "embedding", INVALID_RESPONSE);
}

function validateEmbedding(value: unknown): number {
  if (!isArray(value, INVALID_RESPONSE)) {
    throw smokeError(INVALID_RESPONSE);
  }

  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    throw smokeError(INVALID_RESPONSE);
  }
  if (
    prototype !== Array.prototype ||
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number"
  ) {
    throw smokeError(INVALID_RESPONSE);
  }

  const length = lengthDescriptor.value;
  if (length < 1 || length > MAX_DIMENSION) {
    throw smokeError(INVALID_RESPONSE);
  }

  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      throw smokeError(INVALID_RESPONSE);
    }
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "number" ||
      !Number.isFinite(descriptor.value)
    ) {
      throw smokeError(INVALID_RESPONSE);
    }
  }

  return length;
}

async function executeProbe(
  config: ValidatedConfig,
  fetchFunction: typeof fetch,
  signal: AbortSignal,
  isTimedOut: () => boolean,
): Promise<OllamaEmbeddingSmokeResultV1> {
  let responseValue: unknown;
  try {
    responseValue = await fetchFunction(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      signal,
      body: JSON.stringify({
        model: config.model,
        prompt: PROBE_TEXT,
      }),
    });
  } catch {
    throw smokeError(isTimedOut() ? REQUEST_TIMEOUT : ENDPOINT_UNAVAILABLE);
  }

  if (isTimedOut()) {
    throw smokeError(REQUEST_TIMEOUT);
  }

  const response = assertResponse(responseValue);
  const status = readResponseStatus(response);
  if (status < 200 || status > 299) {
    throw smokeError(REQUEST_REJECTED);
  }

  const jsonFunction = readJsonFunction(response);
  let json: unknown;
  try {
    json = await jsonFunction.call(response);
  } catch {
    throw smokeError(isTimedOut() ? REQUEST_TIMEOUT : INVALID_RESPONSE);
  }

  if (isTimedOut()) {
    throw smokeError(REQUEST_TIMEOUT);
  }

  const observedDimension = validateEmbedding(readEmbedding(json));
  return Object.freeze({
    schemaVersion: 1,
    status: "READY",
    provider: "ollama",
    observedDimension,
  });
}

export async function probeOllamaEmbedding(
  config: OllamaEmbeddingSmokeConfig,
  dependencies: OllamaEmbeddingSmokeDependencies,
): Promise<OllamaEmbeddingSmokeResultV1> {
  const validatedConfig = validateConfig(config);
  const fetchFunction = validateDependencies(dependencies);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(smokeError(REQUEST_TIMEOUT));
    }, validatedConfig.timeoutMs);
  });

  try {
    return await Promise.race([
      executeProbe(
        validatedConfig,
        fetchFunction,
        controller.signal,
        () => timedOut,
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
