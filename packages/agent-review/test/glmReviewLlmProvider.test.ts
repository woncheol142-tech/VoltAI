import { describe, expect, it, vi } from "vitest";

import {
  createReviewLlmFromEnv,
  createReviewLlmProviderFromEnv,
  GlmReviewLlmProvider,
  MockReviewLlm,
  RealReviewLlm,
  UnsupportedReviewLlmProvider,
  type ReviewPrompt,
} from "../src/index.js";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function createPrompt(): ReviewPrompt {
  return {
    system: "system prompt",
    user: "user prompt",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetch(responses: Array<Response | Error>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const response = responses.shift();

    if (response instanceof Error) {
      throw response;
    }

    return response ?? jsonResponse({ choices: [{ message: { content: "# fallback" } }] });
  }) as unknown as typeof fetch;

  return { fetch, calls };
}

describe("GlmReviewLlmProvider", () => {
  it("calls the normalized GLM endpoint with auth and JSON body", async () => {
    const { fetch, calls } = createFetch([
      jsonResponse({ choices: [{ message: { content: "# GLM report" } }] }),
    ]);
    const provider = new GlmReviewLlmProvider({
      apiKey: "test-key",
      baseUrl: "https://api.z.ai/api/paas/v4/",
      model: "glm-custom",
      fetch,
    });

    await expect(provider.generate(createPrompt())).resolves.toBe("# GLM report");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "glm-custom",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
      stream: false,
    });
  });

  it("uses constructor options before env values", async () => {
    const { fetch, calls } = createFetch([
      jsonResponse({ choices: [{ message: { content: "# option report" } }] }),
    ]);
    const provider = new GlmReviewLlmProvider(
      {
        apiKey: "option-key",
        baseUrl: "https://option.example/v4",
        model: "option-model",
        fetch,
      },
      {
        ZAI_API_KEY: "env-key",
        ZAI_BASE_URL: "https://env.example/v4",
        REVIEW_LLM_MODEL: "env-model",
      },
    );

    await provider.generate(createPrompt());

    expect(provider.model).toBe("option-model");
    expect(calls[0].url).toBe("https://option.example/v4/chat/completions");
    expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer option-key" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: "option-model" });
  });

  it("uses default model when model is not configured", () => {
    const provider = new GlmReviewLlmProvider({ apiKey: "key", fetch: vi.fn() as unknown as typeof fetch }, {});

    expect(provider.model).toBe("glm-5.2");
  });

  it("fails before fetch when ZAI_API_KEY is missing", async () => {
    const fetch = vi.fn() as unknown as typeof fetch;
    const provider = new GlmReviewLlmProvider({ fetch }, {});

    await expect(provider.generate(createPrompt())).rejects.toThrow(
      "ZAI_API_KEY is required when REVIEW_LLM_PROVIDER=glm",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed successful responses without retry", async () => {
    const { fetch } = createFetch([jsonResponse({ choices: [{ message: {} }] })]);
    const provider = new GlmReviewLlmProvider({ apiKey: "key", fetch, maxAttempts: 3 }, {});

    await expect(provider.generate(createPrompt())).rejects.toThrow(
      "GLM review response was malformed: choices[0].message.content is required",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP status, business code, and message", async () => {
    const { fetch } = createFetch([
      jsonResponse(
        {
          error: {
            code: "1001",
            message: "Authentication parameter not received",
          },
        },
        401,
      ),
    ]);
    const provider = new GlmReviewLlmProvider({ apiKey: "key", fetch }, {});

    await expect(provider.generate(createPrompt())).rejects.toThrow(
      "GLM review request failed: HTTP 401, code 1001, Authentication parameter not received",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports timeout errors clearly", async () => {
    const fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const provider = new GlmReviewLlmProvider({
      apiKey: "key",
      fetch,
      timeoutMs: 1,
      maxAttempts: 1,
    });

    await expect(provider.generate(createPrompt())).rejects.toThrow(
      "GLM review request timed out after 1ms",
    );
  });

  it("retries timeout and then succeeds", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "# retry ok" } }] })) as unknown as typeof fetch;
    const provider = new GlmReviewLlmProvider({
      apiKey: "key",
      fetch,
      timeoutMs: 10,
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    await expect(provider.generate(createPrompt())).resolves.toBe("# retry ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 429 and HTTP 500 responses", async () => {
    const { fetch } = createFetch([
      jsonResponse({ error: { message: "rate limited" } }, 429),
      jsonResponse({ error: { message: "server error" } }, 500),
      jsonResponse({ choices: [{ message: { content: "# recovered" } }] }),
    ]);
    const provider = new GlmReviewLlmProvider({
      apiKey: "key",
      fetch,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    await expect(provider.generate(createPrompt())).resolves.toBe("# recovered");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry HTTP 400 or 401", async () => {
    for (const status of [400, 401]) {
      const { fetch } = createFetch([jsonResponse({ error: { message: "bad request" } }, status)]);
      const provider = new GlmReviewLlmProvider({
        apiKey: "key",
        fetch,
        maxAttempts: 3,
        retryDelayMs: 0,
      });

      await expect(provider.generate(createPrompt())).rejects.toThrow(
        `GLM review request failed: HTTP ${status}`,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("returns the final retryable error after maxAttempts is exceeded", async () => {
    const { fetch } = createFetch([
      jsonResponse({ error: { message: "server error" } }, 500),
      jsonResponse({ error: { message: "still down" } }, 500),
    ]);
    const provider = new GlmReviewLlmProvider({
      apiKey: "key",
      fetch,
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    await expect(provider.generate(createPrompt())).rejects.toThrow(
      "GLM review request failed: HTTP 500, still down",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("factory returns GLM provider while preserving mock and other skeletons", () => {
    const glm = createReviewLlmProviderFromEnv({
      REVIEW_LLM_PROVIDER: "glm",
      ZAI_API_KEY: "key",
      REVIEW_LLM_MODEL: "glm-env",
    });

    expect(glm).toBeInstanceOf(GlmReviewLlmProvider);
    expect(glm).toMatchObject({ name: "glm", model: "glm-env" });
    expect(createReviewLlmFromEnv({})).toBeInstanceOf(MockReviewLlm);

    for (const providerName of ["ollama", "openai", "openrouter"] as const) {
      expect(
        createReviewLlmProviderFromEnv({ REVIEW_LLM_PROVIDER: providerName }),
      ).toBeInstanceOf(UnsupportedReviewLlmProvider);
    }

    expect(
      createReviewLlmFromEnv({
        REVIEW_LLM_PROVIDER: "glm",
        ZAI_API_KEY: "key",
      }),
    ).toBeInstanceOf(RealReviewLlm);
  });
});

