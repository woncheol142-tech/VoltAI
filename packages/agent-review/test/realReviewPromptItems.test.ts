import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewLlmFromEnv,
  createReviewReport,
  MarkdownReviewPromptBuilder,
  MockReviewLlm,
  type ReviewPromptInput,
} from "../src/index.js";
import { companyResult, kecResult, reviewPromptInput } from "./helpers/companyReviewFixtures.js";

function itemPromptInput(): ReviewPromptInput {
  const company = companyResult();

  return reviewPromptInput({
    companyResults: [company],
    itemReviews: [
      {
        name: "케이블",
        evidence: [
          {
            id: "pdf:docs/spec.pdf:p1:1",
            sourceType: "pdf",
            sourcePath: "docs/spec.pdf",
            page: 1,
            excerpt: "Cable grounding design evidence.",
          },
          {
            id: "excel:estimates/load.xlsx:Summary:r12",
            sourceType: "excel",
            sourcePath: "estimates/load.xlsx",
            sheetName: "Summary",
            rowIndex: 12,
            excerpt: "Cable load schedule row.",
          },
        ],
        kecResults: [kecResult(), kecResult()],
        companyResults: [company, { ...company }],
        findings: [
          {
            severity: "warning",
            message: "Cable sizing calculation needs confirmation.",
          },
        ],
      },
    ],
  });
}

describe("RealReviewLlm item review prompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the default builder output byte-for-byte compatible", () => {
    const prompt = new MarkdownReviewPromptBuilder().buildPrompt(
      createReviewReport(reviewPromptInput()),
    );

    expect(prompt.user).toBe(
      [
        "Project: /project",
        "",
        "Project summary:",
        "docs/spec.pdf: 1 pages, Cable grounding design evidence.",
        "",
        "KEC citations:",
        "KEC 232.5 p.1: Cable grounding requirement.",
        "",
        "Findings:",
        "No findings.",
      ].join("\n"),
    );
  });

  it("adds an ordered item block with evidence, KEC, Company, and finding details when opted in", () => {
    const prompt = new MarkdownReviewPromptBuilder({ includeItemReviews: true }).buildPrompt(
      createReviewReport(itemPromptInput()),
    ).user;
    const positions = [
      "Item: 케이블",
      "Evidence:",
      "Item KEC citations:",
      "Item Company citations:",
      "Item findings:",
    ].map((label) => prompt.indexOf(label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(prompt).toContain("docs/spec.pdf p.1: Cable grounding design evidence.");
    expect(prompt).toContain("estimates/load.xlsx [Summary row 12]: Cable load schedule row.");
    expect(prompt).toContain("KEC 232.5 knowledge/kec.pdf p.1: Cable grounding requirement.");
    expect(prompt).toContain(
      "CS-ELEC-001 Electrical Design Standard [Grounding] standards/electrical-standard.pdf p.2",
    );
    expect(prompt).toContain("warning: Cable sizing calculation needs confirmation.");
  });

  it("deduplicates item citations deterministically", () => {
    const prompt = new MarkdownReviewPromptBuilder({ includeItemReviews: true }).buildPrompt(
      createReviewReport(itemPromptInput()),
    ).user;
    const itemBlock = prompt.slice(prompt.indexOf("Item reviews:"));

    expect(itemBlock.match(/KEC 232\.5 knowledge\/kec\.pdf p\.1/g)).toHaveLength(1);
    expect(
      itemBlock.match(/CS-ELEC-001 Electrical Design Standard \[Grounding\]/g),
    ).toHaveLength(1);
  });

  it("keeps opt-in output unchanged when there are no item reviews", () => {
    const report = createReviewReport(reviewPromptInput({ itemReviews: [] }));

    expect(
      new MarkdownReviewPromptBuilder({ includeItemReviews: true }).buildPrompt(report),
    ).toEqual(new MarkdownReviewPromptBuilder().buildPrompt(report));
  });

  it("bounds item detail counts and ignores non-contract raw payload fields", () => {
    const input = itemPromptInput();
    const item = input.itemReviews[0]!;
    item.evidence = Array.from({ length: 4 }, (_, index) => ({
      id: `pdf:docs/spec.pdf:p1:${index + 1}`,
      sourceType: "pdf" as const,
      sourcePath: "docs/spec.pdf",
      page: 1,
      excerpt: `Evidence ${index + 1}`,
      rawPayload: "Bearer secret-token",
    }));
    item.findings = Array.from({ length: 6 }, (_, index) => ({
      severity: "warning" as const,
      message: `Finding ${index + 1}`,
    }));

    const prompt = new MarkdownReviewPromptBuilder({ includeItemReviews: true }).buildPrompt(
      createReviewReport(input),
    ).user;

    expect(prompt).toContain("Evidence 3");
    expect(prompt).not.toContain("Evidence 4");
    expect(prompt).toContain("Finding 5");
    expect(prompt).not.toContain("Finding 6");
    expect(prompt).not.toContain("secret-token");
  });

  it("enables item details in the env-composed RealReviewLlm path only", async () => {
    let requestBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "# GLM review" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const llm = createReviewLlmFromEnv({
      REVIEW_LLM_PROVIDER: "glm",
      REVIEW_LLM_FALLBACK: "none",
      ZAI_API_KEY: "test-key",
      REVIEW_LLM_MAX_ATTEMPTS: "1",
    });

    await expect(llm.generateReview(itemPromptInput())).resolves.toBe("# GLM review");

    const userPrompt = (requestBody as {
      messages: Array<{ role: string; content: string }>;
    }).messages.find((message) => message.role === "user")?.content;
    expect(userPrompt).toContain("Item: 케이블");

    const mockOutput = await new MockReviewLlm().generateReview(itemPromptInput());
    expect(mockOutput).not.toContain("Item KEC citations:");
    expect(mockOutput).toContain("# 항목별 검토");
  });
});
