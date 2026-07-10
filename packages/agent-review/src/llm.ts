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
