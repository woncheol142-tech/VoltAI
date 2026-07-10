import { describe, expect, it, vi } from "vitest";

import {
  createReviewLlmFromEnv,
  FallbackReviewLlm,
  MockReviewLlm,
  RealReviewLlm,
  ReviewLlmProviderError,
  type ReviewLlm,
  type ReviewLlmProviderName,
  type ReviewPromptInput,
} from "../src/index.js";

function createInput(): ReviewPromptInput {
  return {
    projectPath: "/project",
    files: [],
    pdfs: [],
    excels: [],
    kecResults: [],
    itemReviews: [],
    findings: [],
  };
}

function providerError(
  kind: ConstructorParameters<typeof ReviewLlmProviderError>[0]["kind"],
  fallbackAllowed: boolean,
): ReviewLlmProviderError {
  return new ReviewLlmProviderError({
    provider: "glm",
    kind,
    retryable: fallbackAllowed,
    fallbackAllowed,
    message: `GLM ${kind} failure`,
  });
}

function primary(error: Error): ReviewLlm {
  return {
    generateReview: vi.fn().mockRejectedValue(error),
  };
}

describe("FallbackReviewLlm", () => {
  it("uses fail-closed fallback policy by default", async () => {
    const error = providerError("timeout", true);
    const llm = new FallbackReviewLlm({
      primary: primary(error),
      fallback: new MockReviewLlm(),
    });

    await expect(llm.generateReview(createInput())).rejects.toBe(error);
  });

  it("does not fallback when policy is none", async () => {
    const error = providerError("server-error", true);
    const llm = new FallbackReviewLlm({
      primary: primary(error),
      fallback: new MockReviewLlm(),
      policy: "none",
    });

    await expect(llm.generateReview(createInput())).rejects.toBe(error);
  });

  it("uses mock fallback for fallbackAllowed provider failures and marks the output", async () => {
    const llm = new FallbackReviewLlm({
      primary: primary(providerError("timeout", true)),
      fallback: new MockReviewLlm(),
      policy: "mock",
    });

    const output = await llm.generateReview(createInput());

    expect(output).toContain(
      "> ⚠️ GLM provider unavailable. This report was generated using the local mock fallback.",
    );
    expect(output).toContain("# 프로젝트 개요");
    expect(output).toContain("# 주요 설계 내용");
    expect(output).toContain("# 관련 KEC 조항");
    expect(output).toContain("# 항목별 검토");
    expect(output).toContain("# 잠재 위험");
    expect(output).toContain("# 확인 필요사항");
    expect(output).toContain("# 검토 의견");
  });

  it.each([
    "missing-api-key",
    "auth-error",
    "client-error",
    "malformed-response",
  ] as const)("does not fallback for %s", async (kind) => {
    const error = providerError(kind, false);
    const llm = new FallbackReviewLlm({
      primary: primary(error),
      fallback: new MockReviewLlm(),
      policy: "mock",
    });

    await expect(llm.generateReview(createInput())).rejects.toBe(error);
  });

  it.each(["timeout", "network", "rate-limit", "server-error"] as const)(
    "allows fallback for %s",
    async (kind) => {
      const llm = new FallbackReviewLlm({
        primary: primary(providerError(kind, true)),
        fallback: new MockReviewLlm(),
        policy: "mock",
      });

      await expect(llm.generateReview(createInput())).resolves.toContain(
        "local mock fallback",
      );
    },
  );

  it("does not expose API keys or bearer tokens in fallback output", async () => {
    const secret = "zai-secret-should-not-leak";
    const llm = new FallbackReviewLlm({
      primary: primary(
        new ReviewLlmProviderError({
          provider: "glm",
          kind: "network",
          retryable: true,
          fallbackAllowed: true,
          message: "Network failed",
        }),
      ),
      fallback: new MockReviewLlm(),
      policy: "mock",
    });

    const output = await llm.generateReview(createInput());

    expect(output).not.toContain(secret);
    expect(output).not.toContain("Bearer");
  });
});

describe("createReviewLlmFromEnv fallback policy", () => {
  it("keeps mock as the default provider", () => {
    expect(createReviewLlmFromEnv({})).toBeInstanceOf(MockReviewLlm);
  });

  it("returns RealReviewLlm for glm with default none fallback", () => {
    const llm = createReviewLlmFromEnv({
      REVIEW_LLM_PROVIDER: "glm",
      ZAI_API_KEY: "key",
    });

    expect(llm).toBeInstanceOf(RealReviewLlm);
  });

  it("wraps glm with FallbackReviewLlm when REVIEW_LLM_FALLBACK=mock", () => {
    const llm = createReviewLlmFromEnv({
      REVIEW_LLM_PROVIDER: "glm",
      REVIEW_LLM_FALLBACK: "mock",
      ZAI_API_KEY: "key",
    });

    expect(llm).toBeInstanceOf(FallbackReviewLlm);
  });

  it("rejects invalid REVIEW_LLM_FALLBACK values", () => {
    expect(() =>
      createReviewLlmFromEnv({
        REVIEW_LLM_PROVIDER: "glm",
        REVIEW_LLM_FALLBACK: "silent" as "mock",
        ZAI_API_KEY: "key",
      }),
    ).toThrow('Unsupported REVIEW_LLM_FALLBACK "silent"');
  });
});

describe("ReviewLlmProviderError", () => {
  it("classifies fallback allowed failure kinds without secret details", () => {
    const error = new ReviewLlmProviderError({
      provider: "glm" as ReviewLlmProviderName,
      kind: "rate-limit",
      retryable: true,
      fallbackAllowed: true,
      message: "GLM review request failed: HTTP 429",
    });

    expect(error).toMatchObject({
      provider: "glm",
      kind: "rate-limit",
      retryable: true,
      fallbackAllowed: true,
    });
    expect(error.message).not.toContain("ZAI_API_KEY");
    expect(error.message).not.toContain("Bearer");
  });
});

