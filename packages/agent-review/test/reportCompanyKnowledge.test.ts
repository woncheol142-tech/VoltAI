import { describe, expect, it } from "vitest";

import { buildMarkdownReport, createReviewReport } from "../src/index.js";
import { companyResult, reviewPromptInput } from "./helpers/companyReviewFixtures.js";

describe("ReviewReport Company Knowledge", () => {
  it("normalizes Company citations to required arrays and preserves their stable identity", () => {
    const result = companyResult();
    const report = createReviewReport(
      reviewPromptInput({ companyResults: [result, { ...result }] }),
    );

    expect(report.companyCitations).toEqual([
      {
        id: "company:company-row-1",
        sourceType: "company",
        standardId: "CS-ELEC-001",
        title: "Electrical Design Standard",
        section: "Grounding",
        sourcePath: "standards/electrical-standard.pdf",
        page: 2,
        excerpt: "Cable grounding shall follow the company standard.",
      },
    ]);
    expect(report.itemReviews[0]?.companyCitations).toEqual([]);
  });

  it("adds a Company section and an item-level Company section only when citations exist", () => {
    const result = companyResult();
    const markdown = buildMarkdownReport(
      reviewPromptInput({
        companyResults: [result],
        itemReviews: [
          {
            ...reviewPromptInput().itemReviews[0]!,
            companyResults: [result],
          },
        ],
      }),
    );

    expect(markdown).toContain("# 관련 사내 표준");
    expect(markdown).toContain("- 관련 사내 표준 검색 결과");
    expect(markdown).toContain("CS-ELEC-001");
    expect(markdown).toContain("Electrical Design Standard");
    expect(markdown).toContain("p.2");
  });

  it("keeps KEC and Company citations when their excerpts match", () => {
    const sharedText = "Cable grounding requirement.";
    const report = createReviewReport(
      reviewPromptInput({
        companyResults: [companyResult({ text: sharedText })],
      }),
    );

    expect(report.kecCitations).toHaveLength(1);
    expect(report.companyCitations).toHaveLength(1);
    expect(report.kecCitations[0]?.excerpt).toBe(sharedText);
    expect(report.companyCitations[0]?.excerpt).toBe(sharedText);
  });

  it("keeps existing Markdown byte-for-byte when Company Knowledge is absent", () => {
    const markdown = buildMarkdownReport(reviewPromptInput());

    expect(markdown).toBe(
      [
        "# 프로젝트 개요",
        "",
        "- 프로젝트 경로: /project",
        "- 검토 파일 수: 1",
        "",
        "# 주요 설계 내용",
        "",
        "- docs/spec.pdf: 1 pages, Cable grounding design evidence.",
        "",
        "# 관련 KEC 조항",
        "",
        "- KEC 232.5 p.1: Cable grounding requirement.",
        "",
        "# 항목별 검토",
        "",
        "## 케이블",
        "",
        "- 발견 근거",
        "  - docs/spec.pdf p.1: Cable grounding design evidence.",
        "- 관련 KEC 검색 결과",
        "  - KEC 232.5 p.1: Cable grounding requirement.",
        "- 확인 필요사항",
        "  - 추가 확인 필요사항이 없습니다.",
        "",
        "# 잠재 위험",
        "",
        "- KEC 근거와 설계 자료의 일치 여부를 상세 검토해야 합니다.",
        "",
        "# 확인 필요사항",
        "",
        "- 추가 확인 필요사항이 없습니다.",
        "",
        "# 검토 의견",
        "",
        "- 본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다.",
      ].join("\n"),
    );
  });
});
