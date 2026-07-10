import type { ReviewBenchmarkManifest } from "../helpers/evaluateReview.js";

export const reviewQualityManifest: ReviewBenchmarkManifest = {
  id: "review-quality-v1",
  expectedDesignItems: ["케이블", "전압강하", "분전반", "접지", "차단기", "부하"],
  expectedRelations: [
    {
      id: "cable-voltage-drop",
      message:
        "케이블과 전압강하가 함께 발견되어 전압강하 계산 근거 확인 필요 (severity: high, confidence: high, proximity: same-excerpt)",
    },
    {
      id: "breaker-load",
      message:
        "차단기와 부하가 함께 발견되어 차단기 정격 선정 근거 확인 필요 (severity: high, confidence: high, proximity: same-row)",
    },
    {
      id: "panel-breaker",
      message:
        "분전반과 차단기가 함께 발견되어 보호기기 배치 및 정격 협조 확인 필요 (severity: medium, confidence: medium, proximity: project-level)",
    },
    {
      id: "grounding-panel",
      message:
        "접지와 분전반이 함께 발견되어 분전반 접지 방식 및 접지 저항 기준 확인 필요 (severity: medium, confidence: high, proximity: same-excerpt)",
    },
  ],
  requiredEvidenceIds: [
    "pdf:docs/electrical-spec.pdf:p1:1",
    "pdf:docs/electrical-spec.pdf:p2:1",
    "excel:estimates/load-schedule.xlsx:Summary:r2",
  ],
  expectedCitations: [
    {
      label: "KEC 232.5",
      sourcePath: "knowledge/kec-source.pdf",
      page: 1,
    },
  ],
  expectedCoverageFindings: [
    {
      id: "coverage:estimates/load-schedule.xlsx:Summary:sheet-selection",
      reason: "sheet-selection",
      file: "estimates/load-schedule.xlsx",
      reviewed: 1,
      total: 2,
    },
    {
      id: "coverage:estimates/load-schedule.xlsx:Summary:row-limit",
      reason: "row-limit",
      file: "estimates/load-schedule.xlsx",
      reviewed: 50,
    },
  ],
  forbiddenFindings: ["KEC index missing", "PDF is encrypted", "Workbook is corrupted"],
  forbiddenCitations: ["KEC 999.1"],
  requiredReportSections: [
    "# 프로젝트 개요",
    "# 주요 설계 내용",
    "# 관련 KEC 조항",
    "# 항목별 검토",
    "# 잠재 위험",
    "# 확인 필요사항",
    "# 검토 의견",
  ],
};
