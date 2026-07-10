import type {
  Citation,
  CoverageFinding,
  KecCitation,
  KecSearchResult,
  ReviewFinding,
  ReviewPromptInput,
} from "./ports.js";

function bulletList(items: string[], fallback: string): string {
  if (items.length === 0) {
    return `- ${fallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function summarizePdf(input: ReviewPromptInput): string[] {
  return input.pdfs.map(
    (pdf) => `${pdf.relativePath}: ${pdf.pageCount} pages, ${pdf.text.slice(0, 120)}`,
  );
}

function summarizeExcel(input: ReviewPromptInput): string[] {
  return input.excels.map((excel) => {
    const rowCount = excel.rows?.length ?? 0;
    return `${excel.relativePath}: sheets ${excel.sheets.join(", ")}${rowCount ? `, ${rowCount} rows sampled` : ""}`;
  });
}

function summarizeKec(input: ReviewPromptInput): string[] {
  return input.kecResults.map((result) => formatCitation(toKecCitation(result)));
}

export function toKecCitation(result: KecSearchResult): KecCitation {
  const label = result.clause ?? "Unknown clause";

  return {
    id: `kec:${result.sourcePath}:p${result.page}:${label}`,
    sourceType: "kec",
    sourcePath: result.sourcePath,
    page: result.page,
    label,
    excerpt: result.text,
  };
}

export function coverageFindingToReviewFinding(finding: CoverageFinding): ReviewFinding {
  return {
    severity: finding.severity,
    message: finding.message,
  };
}

export function formatCitation(citation: Citation): string {
  if (citation.sourceType === "excel") {
    const location = [
      citation.sheetName,
      `row ${citation.rowIndex}`,
    ]
      .filter((part) => part !== undefined)
      .join(" ");
    const suffix = location ? ` [${location}]` : "";

    return `${citation.sourcePath}${suffix}: ${citation.excerpt}`;
  }

  if (citation.sourceType === "pdf") {
    return `${citation.sourcePath} p.${citation.page}: ${citation.excerpt}`;
  }

  if (citation.sourceType === "kec") {
    return `${citation.label} p.${citation.page}: ${citation.excerpt}`;
  }

  return `${citation.sourcePath}: ${citation.excerpt}`;
}

function summarizeItemReviews(input: ReviewPromptInput): string[] {
  if (input.itemReviews.length === 0) {
    return ["식별된 설계 항목이 없습니다."];
  }

  return input.itemReviews.map((item) => {
    const kecResults =
      item.kecResults.length > 0
        ? item.kecResults
            .map((result) => formatCitation(toKecCitation(result)))
            .join("\n  - ")
        : "검색된 KEC 조항이 없습니다.";
    const findings =
      item.findings.length > 0
        ? item.findings.map((finding) => `${finding.severity}: ${finding.message}`).join("\n  - ")
        : "추가 확인 필요사항이 없습니다.";

    return [
      `## ${item.name}`,
      "",
      "- 발견 근거",
      `  - ${item.evidence.map(formatCitation).join("\n  - ")}`,
      "- 관련 KEC 검색 결과",
      `  - ${kecResults}`,
      "- 확인 필요사항",
      `  - ${findings}`,
    ].join("\n");
  });
}

export function buildMarkdownReport(input: ReviewPromptInput): string {
  const designItems = [...summarizePdf(input), ...summarizeExcel(input)];
  const findings = input.findings.map((finding) => `${finding.severity}: ${finding.message}`);

  return [
    "# 프로젝트 개요",
    "",
    `- 프로젝트 경로: ${input.projectPath}`,
    `- 검토 파일 수: ${input.files.length}`,
    "",
    "# 주요 설계 내용",
    "",
    bulletList(designItems, "읽을 수 있는 PDF/Excel 설계 자료가 없습니다."),
    "",
    "# 관련 KEC 조항",
    "",
    bulletList(summarizeKec(input), "검색된 KEC 조항이 없습니다."),
    "",
    "# 항목별 검토",
    "",
    summarizeItemReviews(input).join("\n\n"),
    "",
    "# 잠재 위험",
    "",
    bulletList(
      input.kecResults.length > 0
        ? ["KEC 근거와 설계 자료의 일치 여부를 상세 검토해야 합니다."]
        : [],
      "자동 식별된 잠재 위험이 없습니다.",
    ),
    "",
    "# 확인 필요사항",
    "",
    bulletList(findings, "추가 확인 필요사항이 없습니다."),
    "",
    "# 검토 의견",
    "",
    "- 본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다.",
  ].join("\n");
}

export class MockReviewLlm {
  async generateReview(input: ReviewPromptInput): Promise<string> {
    return buildMarkdownReport(input);
  }
}
