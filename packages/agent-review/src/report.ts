import type {
  Citation,
  CoverageFinding,
  DesignItemReview,
  KecCitation,
  KecSearchResult,
  ReviewFinding,
  ReviewPromptInput,
  StructuredEvidence,
} from "./ports.js";

export type ReviewReportItem = {
  name: string;
  evidence: StructuredEvidence[];
  kecCitations: KecCitation[];
  findings: ReviewFinding[];
};

export type ReviewReport = {
  project: {
    path: string;
    fileCount: number;
  };
  summary: string[];
  kecCitations: KecCitation[];
  itemReviews: ReviewReportItem[];
  risks: string[];
  findings: ReviewFinding[];
  coverage: CoverageFinding[];
  relations: ReviewFinding[];
  closingComments: string[];
};

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

function createCoverageFinding(finding: ReviewFinding): CoverageFinding | undefined {
  const rowLimitMatch = /^(?<file>.+) \[(?<sheet>.+)\] was limited to (?<reviewed>\d+) rows$/.exec(
    finding.message,
  );

  if (rowLimitMatch?.groups) {
    return {
      id: `coverage:${rowLimitMatch.groups.file}:${rowLimitMatch.groups.sheet}:row-limit`,
      severity: finding.severity,
      file: rowLimitMatch.groups.file,
      reviewed: Number(rowLimitMatch.groups.reviewed),
      reason: "row-limit",
      message: finding.message,
    };
  }

  const pdfLimitMatch = /^(?<file>.+) was limited to (?<reviewed>\d+) characters$/.exec(
    finding.message,
  );

  if (pdfLimitMatch?.groups) {
    return {
      id: `coverage:${pdfLimitMatch.groups.file}:pdf-truncated`,
      severity: finding.severity,
      file: pdfLimitMatch.groups.file,
      reviewed: Number(pdfLimitMatch.groups.reviewed),
      reason: "pdf-truncated",
      message: finding.message,
    };
  }

  const sheetSelectionMatch =
    /^(?<file>.+) has (?<total>\d+) sheets; reviewed first sheet only: (?<sheet>.+)$/.exec(
      finding.message,
    );

  if (sheetSelectionMatch?.groups) {
    return {
      id: `coverage:${sheetSelectionMatch.groups.file}:${sheetSelectionMatch.groups.sheet}:sheet-selection`,
      severity: finding.severity,
      file: sheetSelectionMatch.groups.file,
      reviewed: 1,
      total: Number(sheetSelectionMatch.groups.total),
      reason: "sheet-selection",
      message: finding.message,
    };
  }

  return undefined;
}

function createCoverageFindings(findings: ReviewFinding[]): CoverageFinding[] {
  return findings.flatMap((finding) => {
    const coverage = createCoverageFinding(finding);

    return coverage ? [coverage] : [];
  });
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

function summarizeReportItemReviews(report: ReviewReport): string[] {
  if (report.itemReviews.length === 0) {
    return ["식별된 설계 항목이 없습니다."];
  }

  return report.itemReviews.map((item) => {
    const kecResults =
      item.kecCitations.length > 0
        ? item.kecCitations.map(formatCitation).join("\n  - ")
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

function createReportItem(item: DesignItemReview): ReviewReportItem {
  return {
    name: item.name,
    evidence: item.evidence,
    kecCitations: item.kecResults.map(toKecCitation),
    findings: item.findings,
  };
}

export function createReviewReport(input: ReviewPromptInput): ReviewReport {
  const kecCitations = input.kecResults.map(toKecCitation);

  return {
    project: {
      path: input.projectPath,
      fileCount: input.files.length,
    },
    summary: [...summarizePdf(input), ...summarizeExcel(input)],
    kecCitations,
    itemReviews: input.itemReviews.map(createReportItem),
    risks:
      kecCitations.length > 0
        ? ["KEC 근거와 설계 자료의 일치 여부를 상세 검토해야 합니다."]
        : [],
    findings: input.findings,
    coverage: createCoverageFindings(input.findings),
    relations: input.itemReviews.flatMap((item) => item.findings),
    closingComments: ["본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다."],
  };
}

export function serializeMarkdownReport(report: ReviewReport): string {
  const findings = report.findings.map((finding) => `${finding.severity}: ${finding.message}`);

  return [
    "# 프로젝트 개요",
    "",
    `- 프로젝트 경로: ${report.project.path}`,
    `- 검토 파일 수: ${report.project.fileCount}`,
    "",
    "# 주요 설계 내용",
    "",
    bulletList(report.summary, "읽을 수 있는 PDF/Excel 설계 자료가 없습니다."),
    "",
    "# 관련 KEC 조항",
    "",
    bulletList(report.kecCitations.map(formatCitation), "검색된 KEC 조항이 없습니다."),
    "",
    "# 항목별 검토",
    "",
    summarizeReportItemReviews(report).join("\n\n"),
    "",
    "# 잠재 위험",
    "",
    bulletList(
      report.risks,
      "자동 식별된 잠재 위험이 없습니다.",
    ),
    "",
    "# 확인 필요사항",
    "",
    bulletList(findings, "추가 확인 필요사항이 없습니다."),
    "",
    "# 검토 의견",
    "",
    bulletList(report.closingComments, "본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다."),
  ].join("\n");
}

export function buildMarkdownReport(input: ReviewPromptInput): string {
  return serializeMarkdownReport(createReviewReport(input));
}

export class MockReviewLlm {
  async generateReview(input: ReviewPromptInput): Promise<string> {
    return buildMarkdownReport(input);
  }
}
