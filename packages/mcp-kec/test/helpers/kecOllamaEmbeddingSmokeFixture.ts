export const smokeProbeText = "volt-ai-ollama-embedding-smoke-v1";

export const smokeErrors = Object.freeze({
  invalidConfiguration: "KEC_OLLAMA_EMBEDDING_SMOKE: INVALID_CONFIGURATION",
  endpointUnavailable: "KEC_OLLAMA_EMBEDDING_SMOKE: ENDPOINT_UNAVAILABLE",
  requestTimeout: "KEC_OLLAMA_EMBEDDING_SMOKE: REQUEST_TIMEOUT",
  requestRejected: "KEC_OLLAMA_EMBEDDING_SMOKE: REQUEST_REJECTED",
  invalidResponse: "KEC_OLLAMA_EMBEDDING_SMOKE: INVALID_RESPONSE",
  internalError: "KEC_OLLAMA_EMBEDDING_SMOKE: INTERNAL_ERROR",
});

export const redactionSentinels = Object.freeze([
  "secret-host.invalid",
  "43127",
  "/secret-path",
  "secret-user",
  "secret-password",
  "secret-model",
  smokeProbeText,
  "secret-response-body",
  "secret-network-message",
  "secret-status-text",
  "secret-stack",
  "secret-api-key",
  "0.123456789",
]);

export type SmokeConfigFixture = Readonly<{
  baseUrl: string;
  model: string;
  timeoutMs: number;
}>;

export type RecordedFetchCall = Readonly<{
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}>;

export type FetchRecorder = Readonly<{
  fetch: typeof fetch;
  calls: readonly RecordedFetchCall[];
}>;

export function smokeConfig(
  overrides: Partial<SmokeConfigFixture> = {},
): SmokeConfigFixture {
  return Object.freeze({
    baseUrl: overrides.baseUrl ?? "http://localhost:11434",
    model: overrides.model ?? "nomic-embed-text",
    timeoutMs: overrides.timeoutMs ?? 30_000,
  });
}

export function smokeEnvironment(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    KEC_EMBED_PROVIDER: "ollama",
    ...overrides,
  });
}

export function createFetchRecorder(
  implementation: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ) => Promise<Response>,
): FetchRecorder {
  const calls: RecordedFetchCall[] = [];
  const fetchImplementation = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push(Object.freeze({ input, init }));
    return implementation(input, init);
  };

  return Object.freeze({
    fetch: fetchImplementation as typeof fetch,
    calls,
  });
}

export function createJsonResponse(embedding: readonly number[]): Response {
  return new Response(JSON.stringify({ embedding }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function createJsonValueResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function createResponseWithJsonValue(
  value: unknown,
  status = 200,
): Response {
  const response = new Response(null, {
    status,
    statusText: "secret-status-text",
  });
  Object.defineProperty(response, "json", {
    configurable: true,
    value: async () => value,
  });
  return response;
}

export function createResponseWithOwnStatus(
  status: unknown,
  value: unknown = { embedding: [1] },
): Response {
  const response = createResponseWithJsonValue(value);
  Object.defineProperty(response, "status", {
    configurable: true,
    value: status,
  });
  return response;
}

export function createRejectedResponse(status: 400 | 404 | 500): Response {
  return new Response("secret-response-body", {
    status,
    statusText: "secret-status-text",
  });
}

export function createMalformedJsonResponse(): Response {
  return new Response('{"embedding":[1,', {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function createNeverResolvingFetch(): FetchRecorder {
  return createFetchRecorder(
    async () => new Promise<Response>(() => undefined),
  );
}

export function createAbortAwareFetch(): FetchRecorder {
  return createFetchRecorder(async (_input, init) => {
    if (!init?.signal) {
      throw new Error("AbortSignal required by fixture");
    }

    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => {
          reject(new DOMException("secret abort reason", "AbortError"));
        },
        { once: true },
      );
    });
  });
}

export function createNeverResolvingJsonResponse(): Response {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, "json", {
    configurable: true,
    value: async () => new Promise<unknown>(() => undefined),
  });
  return response;
}

export function createSparseEmbedding(): number[] {
  const embedding = new Array<number>(2);
  embedding[1] = 1;
  return embedding;
}

export function createInheritedIndexEmbedding(): number[] {
  const embedding = new Array<number>(1);
  const prototype = Object.create(Array.prototype) as number[];
  Object.defineProperty(prototype, "0", {
    configurable: true,
    enumerable: true,
    value: 1,
    writable: true,
  });
  Object.setPrototypeOf(embedding, prototype);
  return embedding;
}

export function createGetterEmbedding(): Readonly<{
  embedding: number[];
  getterCalls: () => number;
}> {
  let calls = 0;
  const embedding = new Array<number>(1);
  Object.defineProperty(embedding, "0", {
    configurable: true,
    enumerable: true,
    get: () => {
      calls += 1;
      return 1;
    },
  });

  return Object.freeze({ embedding, getterCalls: () => calls });
}

export function createInheritedEmbeddingResponse(): object {
  return Object.create({ embedding: [1] }) as object;
}

export function createGetterEmbeddingResponse(): Readonly<{
  value: object;
  getterCalls: () => number;
}> {
  let calls = 0;
  const value = {};
  Object.defineProperty(value, "embedding", {
    configurable: true,
    enumerable: true,
    get: () => {
      calls += 1;
      return [1];
    },
  });

  return Object.freeze({ value, getterCalls: () => calls });
}

export function createSizedEmbedding(length: number): number[] {
  return new Array<number>(length).fill(0.25);
}

export function createHostileValue(): Readonly<{
  value: object;
  calls: () => number;
}> {
  let calls = 0;
  const invoked = (): never => {
    calls += 1;
    throw new Error("hostile coercion executed");
  };
  const value = {
    toString: invoked,
    valueOf: invoked,
    [Symbol.toPrimitive]: invoked,
  };

  return Object.freeze({ value, calls: () => calls });
}

export function createHostileThrownValue(): Readonly<{
  thrown: object;
  calls: () => number;
}> {
  let calls = 0;
  const thrown = {};

  for (const key of ["message", "stack", "cause"] as const) {
    Object.defineProperty(thrown, key, {
      configurable: true,
      get: () => {
        calls += 1;
        throw new Error(`hostile ${key} getter executed`);
      },
    });
  }

  Object.defineProperty(thrown, Symbol.toPrimitive, {
    configurable: true,
    value: () => {
      calls += 1;
      throw new Error("hostile thrown coercion executed");
    },
  });

  return Object.freeze({ thrown, calls: () => calls });
}

export function requestBody(call: RecordedFetchCall): unknown {
  if (typeof call.init?.body !== "string") {
    throw new Error("Fixture expected a string request body");
  }

  return JSON.parse(call.init.body) as unknown;
}

export function headerValue(
  call: RecordedFetchCall,
  name: string,
): string | null {
  return new Headers(call.init?.headers).get(name);
}
