import { describe, expect, it, vi } from "vitest";

import {
  createReviewLlmFromEnv,
  createReviewLlmProviderFromEnv,
  createReviewReport,
  MarkdownReviewPromptBuilder,
  MockReviewLlm,
  RealReviewLlm,
  serializeMarkdownReport,
  type ReviewLlmProvider,
  type ReviewPrompt,
  type ReviewPromptInput,
} from "../src/index.js";

function createPromptInput(): ReviewPromptInput {
  return {
    projectPath: "/project",
    files: [
      {
        name: "spec.pdf",
        relativePath: "docs/spec.pdf",
        extension: ".pdf",
        size: 100,
        modifiedAt: "2026-07-09T00:00:00.000Z",
      },
    ],
    pdfs: [
      {
        relativePath: "docs/spec.pdf",
        pageCount: 3,
        text: "조명 부하 산정을 확인한다.",
        pages: [{ page: 3, text: "조명 부하 산정을 확인한다." }],
        truncated: false,
      },
    ],
    excels: [],
    kecResults: [
      {
        clause: "KEC 212.3",
        page: 8,
        text: "Related rule.",
        similarity: 0.86,
        sourcePath: "kec/kec.pdf",
      },
    ],
    itemReviews: [
      {
        name: "조명",
        evidence: [
          {
            id: "pdf:docs/spec.pdf:p3:1",
            sourceType: "pdf",
            sourcePath: "docs/spec.pdf",
            page: 3,
            excerpt: "조명 부하 산정을 확인한다.",
          },
        ],
        kecResults: [
          {
            clause: "KEC 212.3",
            page: 8,
            text: "Related rule.",
            similarity: 0.86,
            sourcePath: "kec/kec.pdf",
          },
        ],
        findings: [
          {
            severity: "warning",
            message: "조명 부하 산정 근거 확인 필요",
          },
        ],
      },
    ],
    findings: [
      {
        severity: "warning",
        message: "docs/spec.pdf was limited to 100 characters",
      },
    ],
  };
}

describe("Review LLM adapter architecture", () => {
  it("keeps mock as the default provider and preserves markdown output", async () => {
    const llm = createReviewLlmFromEnv({});
    const output = await llm.generateReview(createPromptInput());

    expect(llm).toBeInstanceOf(MockReviewLlm);
    expect(output).toBe(serializeMarkdownReport(createReviewReport(createPromptInput())));
    expect(output).toContain("# 프로젝트 개요");
  });

  it("uses mock provider when REVIEW_LLM_PROVIDER=mock", async () => {
    const llm = createReviewLlmFromEnv({ REVIEW_LLM_PROVIDER: "mock" });
    const output = await llm.generateReview(createPromptInput());

    expect(llm).toBeInstanceOf(MockReviewLlm);
    expect(output).toContain("# 검토 의견");
  });

  it.each(["openai", "glm", "ollama", "openrouter"] as const)(
    "creates a RealReviewLlm skeleton for %s",
    (providerName) => {
      const llm = createReviewLlmFromEnv({
        REVIEW_LLM_PROVIDER: providerName,
        REVIEW_LLM_MODEL: "test-model",
      });
      const provider = createReviewLlmProviderFromEnv({
        REVIEW_LLM_PROVIDER: providerName,
        REVIEW_LLM_MODEL: "test-model",
      });

      expect(llm).toBeInstanceOf(RealReviewLlm);
      expect(provider).toMatchObject({
        name: providerName,
        model: "test-model",
      });
    },
  );

  it("skeleton providers fail clearly without performing HTTP calls", async () => {
    const provider = createReviewLlmProviderFromEnv({
      REVIEW_LLM_PROVIDER: "openai",
      REVIEW_LLM_MODEL: "gpt-test",
    });

    await expect(provider.generate({ system: "system", user: "user" })).rejects.toThrow(
      'Review LLM provider "openai" is not implemented yet',
    );
  });

  it("builds prompts from ReviewReport with summary, citations, and findings", () => {
    const report = createReviewReport(createPromptInput());
    const prompt = new MarkdownReviewPromptBuilder().buildPrompt(report);

    expect(prompt.system).toContain("VoltAI");
    expect(prompt.user).toContain("docs/spec.pdf: 3 pages, 조명 부하 산정을 확인한다.");
    expect(prompt.user).toContain("KEC 212.3 p.8: Related rule.");
    expect(prompt.user).toContain("warning: docs/spec.pdf was limited to 100 characters");
  });

  it("RealReviewLlm calls builder before provider and returns provider markdown", async () => {
    const prompt: ReviewPrompt = {
      system: "system prompt",
      user: "user prompt",
    };
    const builder = {
      buildPrompt: vi.fn(() => prompt),
    };
    const provider: ReviewLlmProvider = {
      name: "openai",
      model: "test-model",
      generate: vi.fn().mockResolvedValue("# 프로젝트 개요\n\nreal output"),
    };
    const llm = new RealReviewLlm(builder, provider);

    await expect(llm.generateReview(createPromptInput())).resolves.toBe(
      "# 프로젝트 개요\n\nreal output",
    );
    expect(builder.buildPrompt).toHaveBeenCalledWith(createReviewReport(createPromptInput()));
    expect(provider.generate).toHaveBeenCalledWith(prompt);
  });
});

