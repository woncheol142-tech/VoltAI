import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildMarkdownReport,
  formatCitation,
  toKecCitation,
  type CoverageFinding,
  type ExcelEvidence,
  type PdfEvidence,
  type StructuredEvidence,
} from "../src/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(testDirectory, "..", "src");

describe("typed citation and report model", () => {
  it("declares StructuredEvidence as a discriminated union contract", () => {
    const portsSource = readFileSync(join(sourceDirectory, "ports.ts"), "utf8");

    expect(portsSource).toContain("export type PdfEvidence");
    expect(portsSource).toContain("export type ExcelEvidence");
    expect(portsSource).toContain("export type CadEvidence");
    expect(portsSource).toContain("export type UnknownEvidence");
    expect(portsSource).toContain("export type StructuredEvidence =");
    expect(portsSource).toContain("| PdfEvidence");
    expect(portsSource).toContain("| ExcelEvidence");
    expect(portsSource).toContain("id: string");
    expect(portsSource).toContain('sourceType: "pdf"');
    expect(portsSource).toContain("page: number");
    expect(portsSource).toContain('sourceType: "excel"');
    expect(portsSource).toContain("rowIndex: number");
  });

  it("rejects incomplete discriminated evidence at compile time", () => {
    // @ts-expect-error PdfEvidence requires page.
    const pdfEvidenceWithoutPage: PdfEvidence = {
      id: "pdf:docs/spec.pdf:p3:1",
      sourceType: "pdf",
      sourcePath: "docs/spec.pdf",
      excerpt: "조명 부하 산정을 확인한다.",
    };
    // @ts-expect-error ExcelEvidence requires rowIndex.
    const excelEvidenceWithoutRow: ExcelEvidence = {
      id: "excel:estimate.xlsx:Sheet1:r12",
      sourceType: "excel",
      sourcePath: "estimate.xlsx",
      sheetName: "Sheet1",
      excerpt: "MCCB Main breaker",
    };
    const typedEvidence: StructuredEvidence[] = [
      {
        id: "pdf:docs/spec.pdf:p3:1",
        sourceType: "pdf",
        sourcePath: "docs/spec.pdf",
        page: 3,
        excerpt: "조명 부하 산정을 확인한다.",
      },
      {
        id: "excel:estimate.xlsx:Sheet1:r12",
        sourceType: "excel",
        sourcePath: "estimate.xlsx",
        sheetName: "Sheet1",
        rowIndex: 12,
        excerpt: "MCCB Main breaker",
      },
    ];

    expect(typedEvidence).toHaveLength(2);
    expect(pdfEvidenceWithoutPage).toBeDefined();
    expect(excelEvidenceWithoutRow).toBeDefined();
  });

  it("requires discriminated evidence metadata and stable ids", () => {
    const pdfEvidence: PdfEvidence = {
      id: "pdf:docs/spec.pdf:p3:1",
      sourceType: "pdf",
      sourcePath: "docs/spec.pdf",
      page: 3,
      excerpt: "조명 부하 산정을 확인한다.",
    };
    const excelEvidence: ExcelEvidence = {
      id: "excel:estimate.xlsx:Sheet1:r12",
      sourceType: "excel",
      sourcePath: "estimate.xlsx",
      sheetName: "Sheet1",
      rowIndex: 12,
      excerpt: "MCCB Main breaker",
    };

    expect(formatCitation(pdfEvidence)).toBe("docs/spec.pdf p.3: 조명 부하 산정을 확인한다.");
    expect(formatCitation(excelEvidence)).toBe(
      "estimate.xlsx [Sheet1 row 12]: MCCB Main breaker",
    );
  });

  it("converts KEC search results to typed citations without changing KEC search result shape", () => {
    const citation = toKecCitation({
      clause: "KEC 212.3",
      page: 8,
      text: "Related rule.",
      similarity: 0.86,
      sourcePath: "kec/kec.pdf",
    });

    expect(citation).toEqual({
      id: "kec:kec/kec.pdf:p8:KEC 212.3",
      sourceType: "kec",
      sourcePath: "kec/kec.pdf",
      page: 8,
      label: "KEC 212.3",
      excerpt: "Related rule.",
    });
    expect(formatCitation(citation)).toBe("KEC 212.3 p.8: Related rule.");
  });

  it("models coverage findings as typed structures while preserving markdown output", () => {
    const coverageFinding: CoverageFinding = {
      id: "coverage:estimate/estimate.xlsx:rows",
      severity: "warning",
      file: "estimate/estimate.xlsx",
      reviewed: 50,
      total: 51,
      reason: "row-limit",
      message: "estimate/estimate.xlsx [Summary] was limited to 50 rows",
    };

    expect(coverageFinding.reason).toBe("row-limit");
    expect(coverageFinding.reviewed).toBe(50);
  });

  it("serializes the typed report model to the existing markdown byte-for-byte", () => {
    const report = buildMarkdownReport({
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
          findings: [],
        },
      ],
      findings: [
        {
          severity: "warning",
          message: "estimate/estimate.xlsx [Summary] was limited to 50 rows",
        },
      ],
    });

    expect(report).toBe(
      [
        "# 프로젝트 개요",
        "",
        "- 프로젝트 경로: /project",
        "- 검토 파일 수: 1",
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
        "  - 추가 확인 필요사항이 없습니다.",
        "",
        "# 잠재 위험",
        "",
        "- KEC 근거와 설계 자료의 일치 여부를 상세 검토해야 합니다.",
        "",
        "# 확인 필요사항",
        "",
        "- warning: estimate/estimate.xlsx [Summary] was limited to 50 rows",
        "",
        "# 검토 의견",
        "",
        "- 본 보고서는 수집된 프로젝트 파일과 KEC 검색 결과를 기반으로 생성되었습니다.",
      ].join("\n"),
    );
  });
});
