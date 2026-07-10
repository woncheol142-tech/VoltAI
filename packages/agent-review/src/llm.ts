import type { ReviewLlm, ReviewPromptInput } from "./ports.js";
import {
  createReviewReport,
  formatCitation,
  MockReviewLlm,
  type ReviewReport,
} from "./report.js";

export type ReviewPrompt = {
  system: string;
  user: string;
};

export type ReviewPromptBuilder = {
  buildPrompt: (report: ReviewReport) => ReviewPrompt;
};

export type ReviewLlmProviderName = "ollama" | "glm" | "openai" | "openrouter";

export type ReviewLlmProvider = {
  name: ReviewLlmProviderName;
  model?: string;
  generate: (prompt: ReviewPrompt) => Promise<string>;
};

type GlmEnvironment = ReviewLlmEnvironment & {
  ZAI_API_KEY?: string;
  ZAI_BASE_URL?: string;
  REVIEW_LLM_TIMEOUT_MS?: string;
  REVIEW_LLM_MAX_ATTEMPTS?: string;
  REVIEW_LLM_RETRY_DELAY_MS?: string;
};

export type GlmReviewLlmProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
};

type ResolvedGlmReviewLlmProviderOptions = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  fetch: typeof fetch;
};

type TimeoutSignal = {
  signal: AbortSignal;
  cleanup: () => void;
};

class GlmReviewError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class MarkdownReviewPromptBuilder implements ReviewPromptBuilder {
  buildPrompt(report: ReviewReport): ReviewPrompt {
    const summary = report.summary.length > 0 ? report.summary.join("\n") : "No project summary.";
    const citations =
      report.kecCitations.length > 0
        ? report.kecCitations.map(formatCitation).join("\n")
        : "No KEC citations.";
    const findings =
      report.findings.length > 0
        ? report.findings.map((finding) => `${finding.severity}: ${finding.message}`).join("\n")
        : "No findings.";

    return {
      system:
        "You are VoltAI, an electrical engineering review assistant. Return a markdown review report.",
      user: [
        `Project: ${report.project.path}`,
        "",
        "Project summary:",
        summary,
        "",
        "KEC citations:",
        citations,
        "",
        "Findings:",
        findings,
      ].join("\n"),
    };
  }
}

export class UnsupportedReviewLlmProvider implements ReviewLlmProvider {
  constructor(
    readonly name: ReviewLlmProviderName,
    readonly model?: string,
  ) {}

  async generate(prompt: ReviewPrompt): Promise<string> {
    void prompt;
    throw new Error(`Review LLM provider "${this.name}" is not implemented yet`);
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveGlmOptions(
  options: GlmReviewLlmProviderOptions,
  env: GlmEnvironment,
): ResolvedGlmReviewLlmProviderOptions {
  return {
    apiKey: options.apiKey ?? env.ZAI_API_KEY,
    baseUrl: options.baseUrl ?? env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4",
    model: options.model ?? env.REVIEW_LLM_MODEL ?? "glm-5.2",
    timeoutMs:
      options.timeoutMs ?? parsePositiveInteger(env.REVIEW_LLM_TIMEOUT_MS) ?? 60_000,
    maxAttempts:
      options.maxAttempts ?? parsePositiveInteger(env.REVIEW_LLM_MAX_ATTEMPTS) ?? 3,
    retryDelayMs:
      options.retryDelayMs ?? parsePositiveInteger(env.REVIEW_LLM_RETRY_DELAY_MS) ?? 500,
    fetch: options.fetch ?? fetch,
  };
}

function createGlmEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function createTimeoutSignal(timeoutMs: number): TimeoutSignal {
  if (typeof AbortSignal.timeout === "function") {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError" || error.name === "TimeoutError"
    : error instanceof Error && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  if (ms === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatGlmHttpError(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
    const code = typeof error?.code === "string" ? `, code ${error.code}` : "";
    const message = typeof error?.message === "string" ? `, ${error.message}` : "";

    return `GLM review request failed: HTTP ${status}${code}${message}`;
  }

  return `GLM review request failed: HTTP ${status}`;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseGlmContent(body: unknown): string {
  const content = (body as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new GlmReviewError(
      "GLM review response was malformed: choices[0].message.content is required",
      false,
    );
  }

  return content;
}

export class GlmReviewLlmProvider implements ReviewLlmProvider {
  readonly name = "glm";
  readonly model: string;
  private readonly options: ResolvedGlmReviewLlmProviderOptions;

  constructor(
    options: GlmReviewLlmProviderOptions = {},
    env: GlmEnvironment = process.env,
  ) {
    this.options = resolveGlmOptions(options, env);
    this.model = this.options.model;
  }

  async generate(prompt: ReviewPrompt): Promise<string> {
    if (!this.options.apiKey) {
      throw new Error("ZAI_API_KEY is required when REVIEW_LLM_PROVIDER=glm");
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await this.generateOnce(prompt);
      } catch (error) {
        const normalizedError = this.normalizeError(error);
        lastError = normalizedError;

        if (!normalizedError.retryable || attempt >= this.options.maxAttempts) {
          if (attempt > 1 && normalizedError.retryable) {
            throw new Error(
              `GLM review request failed after ${attempt} attempts: ${normalizedError.message}`,
            );
          }

          throw normalizedError;
        }

        await delay(this.options.retryDelayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("GLM review request failed");
  }

  private async generateOnce(prompt: ReviewPrompt): Promise<string> {
    const timeout = createTimeoutSignal(this.options.timeoutMs);

    try {
      const response = await this.options.fetch(createGlmEndpoint(this.options.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          stream: false,
        }),
        signal: timeout.signal,
      });
      const body = await readJsonResponse(response);

      if (!response.ok) {
        throw new GlmReviewError(
          formatGlmHttpError(response.status, body),
          response.status === 429 || response.status >= 500,
        );
      }

      return parseGlmContent(body);
    } finally {
      timeout.cleanup();
    }
  }

  private normalizeError(error: unknown): GlmReviewError {
    if (error instanceof GlmReviewError) {
      return error;
    }

    if (isAbortError(error)) {
      return new GlmReviewError(
        `GLM review request timed out after ${this.options.timeoutMs}ms`,
        true,
      );
    }

    return new GlmReviewError(
      error instanceof Error ? error.message : "GLM review request failed",
      true,
    );
  }
}

export class RealReviewLlm implements ReviewLlm {
  constructor(
    private readonly promptBuilder: ReviewPromptBuilder,
    private readonly provider: ReviewLlmProvider,
  ) {}

  async generateReview(input: ReviewPromptInput): Promise<string> {
    const report = createReviewReport(input);
    const prompt = this.promptBuilder.buildPrompt(report);

    return this.provider.generate(prompt);
  }
}

type ReviewLlmEnvironment = {
  REVIEW_LLM_PROVIDER?: string;
  REVIEW_LLM_MODEL?: string;
};

function isReviewLlmProviderName(value: string): value is ReviewLlmProviderName {
  return value === "ollama" || value === "glm" || value === "openai" || value === "openrouter";
}

export function createReviewLlmProviderFromEnv(
  env: ReviewLlmEnvironment = process.env,
): ReviewLlmProvider {
  const providerName = env.REVIEW_LLM_PROVIDER ?? "mock";

  if (providerName === "mock") {
    throw new Error('Review LLM provider "mock" does not use a provider adapter');
  }

  if (!isReviewLlmProviderName(providerName)) {
    throw new Error(`Unsupported review LLM provider "${providerName}"`);
  }

  if (providerName === "glm") {
    return new GlmReviewLlmProvider({}, env);
  }

  return new UnsupportedReviewLlmProvider(providerName, env.REVIEW_LLM_MODEL);
}

export function createReviewLlmFromEnv(env: ReviewLlmEnvironment = process.env): ReviewLlm {
  const providerName = env.REVIEW_LLM_PROVIDER ?? "mock";

  if (providerName === "mock") {
    return new MockReviewLlm();
  }

  return new RealReviewLlm(
    new MarkdownReviewPromptBuilder(),
    createReviewLlmProviderFromEnv(env),
  );
}
