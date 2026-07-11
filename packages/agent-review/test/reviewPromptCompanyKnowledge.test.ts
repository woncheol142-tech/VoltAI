import { describe, expect, it } from "vitest";

import { MarkdownReviewPromptBuilder, createReviewReport } from "../src/index.js";
import { companyResult, reviewPromptInput } from "./helpers/companyReviewFixtures.js";

describe("MarkdownReviewPromptBuilder Company Knowledge", () => {
  it("adds Company Standard citations after the existing KEC block", () => {
    const report = createReviewReport(
      reviewPromptInput({ companyResults: [companyResult()] }),
    );
    const prompt = new MarkdownReviewPromptBuilder().buildPrompt(report);

    expect(prompt.user).toContain("Company standard citations:");
    expect(prompt.user).toContain("CS-ELEC-001");
    expect(prompt.user.indexOf("KEC citations:")).toBeLessThan(
      prompt.user.indexOf("Company standard citations:"),
    );
  });

  it("keeps the legacy prompt byte-for-byte when Company Knowledge is absent", () => {
    const report = createReviewReport(reviewPromptInput());

    expect(new MarkdownReviewPromptBuilder().buildPrompt(report)).toEqual({
      system:
        "You are VoltAI, an electrical engineering review assistant. Return a markdown review report.",
      user: [
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
    });
  });
});
