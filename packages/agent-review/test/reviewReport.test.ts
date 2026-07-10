import { describe, expect, it } from "vitest";

import {
  buildMarkdownReport,
  createReviewReport,
  MockReviewLlm,
  serializeMarkdownReport,
  type ReviewPromptInput,
} from "../src/index.js";

function createReportInput(): ReviewPromptInput {
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
      {
        name: "estimate.xlsx",
        relativePath: "estimate.xlsx",
        extension: ".xlsx",
        size: 200,
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
    excels: [
      {
        relativePath: "estimate.xlsx",
        sheets: ["Sheet1"],
        sheetName: "Sheet1",
        rows: [["MCCB", "Main breaker"]],
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
            message:
              "조명과 부하가 함께 발견되어 조명 부하 산정 근거 확인 필요 (severity: medium, confidence: high, proximity: same-excerpt)",
          },
        ],
      },
    ],
    findings: [
      {
        severity: "warning",
        message: "estimate.xlsx [Sheet1] was limited to 50 rows",
      },
    ],
  };
}

describe("ReviewReport model", () => {
  it("creates a typed ReviewReport before markdown serialization", () => {
    const input = createReportInput();
    const report = createReviewReport(input);

    expect(report.project).toEqual({
      path: "/project",
      fileCount: 2,
    });
    expect(report.summary).toEqual([
      "docs/spec.pdf: 3 pages, 조명 부하 산정을 확인한다.",
      "estimate.xlsx: sheets Sheet1, 1 rows sampled",
    ]);
    expect(report.kecCitations).toEqual([
      {
        id: "kec:kec/kec.pdf:p8:KEC 212.3",
        sourceType: "kec",
        sourcePath: "kec/kec.pdf",
        page: 8,
        label: "KEC 212.3",
        excerpt: "Related rule.",
      },
    ]);
    expect(report.findings).toEqual(input.findings);
    expect(report.coverage).toEqual([
      {
        id: "coverage:estimate.xlsx:Sheet1:row-limit",
        severity: "warning",
        file: "estimate.xlsx",
        reviewed: 50,
        reason: "row-limit",
        message: "estimate.xlsx [Sheet1] was limited to 50 rows",
      },
    ]);
    expect(report.itemReviews[0]).toMatchObject({
      name: "조명",
      evidence: input.itemReviews[0].evidence,
      findings: input.itemReviews[0].findings,
    });
    expect(report.itemReviews[0].kecCitations).toEqual(report.kecCitations);
    expect(report.relations).toEqual(input.itemReviews[0].findings);
    expect(report.risks).toEqual(["KEC 근거와 설계 자료의 일치 여부를 상세 검토해야 합니다."]);
    expect(report.closingComments).toEqual([
      "본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다.",
    ]);
  });

  it("serializes ReviewReport to the existing markdown byte-for-byte", () => {
    const input = createReportInput();

    expect(serializeMarkdownReport(createReviewReport(input))).toBe(buildMarkdownReport(input));
  });

  it("keeps buildMarkdownReport as a compatibility wrapper", () => {
    const input = createReportInput();

    expect(buildMarkdownReport(input)).toBe(
      [
        "# 프로젝트 개요",
        "",
        "- 프로젝트 경로: /project",
        "- 검토 파일 수: 2",
        "",
        "# 주요 설계 내용",
        "",
        "- docs/spec.pdf: 3 pages, 조명 부하 산정을 확인한다.",
        "- estimate.xlsx: sheets Sheet1, 1 rows sampled",
        "",
        "# 관련 KEC 조항",
        "",
        "- KEC 212.3 p.8: Related rule.",
        "",
        "# 항목별 검토",
        "",
        "## 조명",
        "",
        "- 발견 근거",
        "  - docs/spec.pdf p.3: 조명 부하 산정을 확인한다.",
        "- 관련 KEC 검색 결과",
        "  - KEC 212.3 p.8: Related rule.",
        "- 확인 필요사항",
        "  - warning: 조명과 부하가 함께 발견되어 조명 부하 산정 근거 확인 필요 (severity: medium, confidence: high, proximity: same-excerpt)",
        "",
        "# 잠재 위험",
        "",
        "- KEC 근거와 설계 자료의 일치 여부를 상세 검토해야 합니다.",
        "",
        "# 확인 필요사항",
        "",
        "- warning: estimate.xlsx [Sheet1] was limited to 50 rows",
        "",
        "# 검토 의견",
        "",
        "- 본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다.",
      ].join("\n"),
    );
  });

  it("keeps MockReviewLlm output as a markdown string", async () => {
    const output = await new MockReviewLlm().generateReview(createReportInput());

    expect(typeof output).toBe("string");
    expect(output).toContain("# 프로젝트 개요");
    expect(() => JSON.parse(output)).toThrow();
  });
});

