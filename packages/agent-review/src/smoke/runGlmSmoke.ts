import {
  GlmReviewLlmProvider,
  ReviewLlmProviderError,
  type ReviewPrompt,
} from "../llm.js";

export type GlmSmokeEnvironment = {
  REVIEW_LLM_PROVIDER?: string;
  REVIEW_LLM_MODEL?: string;
  ZAI_API_KEY?: string;
  ZAI_BASE_URL?: string;
  REVIEW_LLM_TIMEOUT_MS?: string;
  REVIEW_LLM_MAX_ATTEMPTS?: string;
  REVIEW_LLM_RETRY_DELAY_MS?: string;
};

export type GlmSmokeResult = {
  status: "passed" | "failed" | "skipped";
  message: string;
};

export type GlmSmokeOptions = {
  env?: GlmSmokeEnvironment;
  fetch?: typeof fetch;
};

const smokePrompt: ReviewPrompt = {
  system: "You are VoltAI. Reply with one short markdown sentence.",
  user: "Return a one-sentence markdown smoke test response for VoltAI.",
};

export async function runGlmSmokeTest(options: GlmSmokeOptions = {}): Promise<GlmSmokeResult> {
  const env = options.env ?? process.env;

  if (env.REVIEW_LLM_PROVIDER !== "glm" || !env.ZAI_API_KEY) {
    return {
      status: "skipped",
      message: "GLM smoke test skipped: set REVIEW_LLM_PROVIDER=glm and ZAI_API_KEY to run.",
    };
  }

  try {
    const provider = new GlmReviewLlmProvider(
      {
        fetch: options.fetch,
        maxAttempts: 1,
      },
      env,
    );
    const response = await provider.generate(smokePrompt);

    if (response.trim().length === 0) {
      return {
        status: "failed",
        message: "GLM smoke test failed: response was empty.",
      };
    }

    if (response.length > 4_000) {
      return {
        status: "failed",
        message: "GLM smoke test failed: response exceeded the expected length limit.",
      };
    }

    return {
      status: "passed",
      message: "GLM smoke test passed: received non-empty markdown response.",
    };
  } catch (error) {
    if (error instanceof ReviewLlmProviderError && error.kind === "malformed-response") {
      return {
        status: "failed",
        message: "GLM smoke test failed: response was empty.",
      };
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return {
      status: "failed",
      message: `GLM smoke test failed: ${message}`,
    };
  }
}

