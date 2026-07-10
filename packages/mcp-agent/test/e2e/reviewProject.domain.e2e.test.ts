import { existsSync } from "node:fs";

import {
  reviewProject,
  serializeMarkdownReport,
  type ReviewReport,
} from "@voltai/agent-review";
import { SqliteVectorStore } from "@voltai/mcp-kec";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalReviewPorts } from "../../src/ports/localReviewPorts.js";
import {
  createCapturingMockReviewLlm,
  createReviewFixture,
  normalizeMarkdown,
  withE2eEnvironment,
  type ReviewFixture,
} from "./helpers/reviewFixture.js";
import { prepareDeterministicKecStore } from "./helpers/kecFixture.js";

const requiredReportSections = [
  "# 프로젝트 개요",
  "# 주요 설계 내용",
  "# 관련 KEC 조항",
  "# 항목별 검토",
  "# 잠재 위험",
  "# 확인 필요사항",
  "# 검토 의견",
];

type DomainReviewRun = {
  markdown: string;
  report: ReviewReport;
};

function createPorts(fixture: ReviewFixture, llm: ReturnType<typeof createCapturingMockReviewLlm>) {
  return createLocalReviewPorts(fixture.projectRoot, {
    embeddingProvider: fixture.embeddingProvider,
    vectorStoreFactory: () => new SqliteVectorStore(fixture.kecDbPath),
    llm,
  });
}

async function runDomainReview(fixture: ReviewFixture): Promise<DomainReviewRun> {
  const llm = createCapturingMockReviewLlm();
  const ports = createPorts(fixture, llm);
  const markdown = await reviewProject({ projectPath: fixture.projectRoot }, ports);

  if (!llm.report) {
    throw new Error("Capturing MockReviewLlm did not receive a ReviewReport input");
  }

  return { markdown, report: llm.report };
}

function expectRequiredSections(markdown: string): void {
  for (const section of requiredReportSections) {
    expect(markdown.includes(section)).toBe(true);
  }
}

describe("review project domain E2E", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects generated project files to typed evidence, ReviewReport, and deterministic markdown", async () => {
    const fixture = await createReviewFixture();
    const fetchSpy = vi.fn(async () => {
      throw new Error("E2E tests must not make network requests");
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await withE2eEnvironment(fixture, async () => {
        await prepareDeterministicKecStore(fixture);

        const inspectionLlm = createCapturingMockReviewLlm();
        const inspectionPorts = createPorts(fixture, inspectionLlm);

        try {
          const files = await inspectionPorts.listProjectFiles(fixture.projectRoot);
          expect(files.map((file) => file.relativePath)).toEqual([
            "docs/electrical-spec.pdf",
            "estimates/load-schedule.xlsx",
            "knowledge/kec-source.pdf",
          ]);

          const pdf = await inspectionPorts.readPdf("docs/electrical-spec.pdf");
          expect(pdf.pages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ page: 1, text: expect.stringContaining("cable") }),
              expect.objectContaining({ page: 2, text: expect.stringContaining("grounding") }),
            ]),
          );

          const excel = await inspectionPorts.readExcel("estimates/load-schedule.xlsx", {
            sheetName: "Summary",
            maxRows: 50,
          });
          expect(excel.sheetName).toBe("Summary");
          expect(excel.rows?.length).toBe(50);
          expect(excel.totalRows).toBeGreaterThan(50);
        } finally {
          await inspectionPorts.close?.();
        }

        const first = await runDomainReview(fixture);
        const second = await runDomainReview(fixture);

        const evidence = first.report.itemReviews.flatMap((item) => item.evidence);
        const pdfEvidence = evidence.find(
          (item) => item.sourceType === "pdf" && item.sourcePath === "docs/electrical-spec.pdf",
        );
        const excelEvidence = evidence.find(
          (item) =>
            item.sourceType === "excel" &&
            item.sourcePath === "estimates/load-schedule.xlsx" &&
            item.sheetName === "Summary" &&
            item.rowIndex === 2,
        );

        expect(pdfEvidence).toEqual(
          expect.objectContaining({
            id: "pdf:docs/electrical-spec.pdf:p1:1",
            sourceType: "pdf",
            sourcePath: "docs/electrical-spec.pdf",
            page: 1,
          }),
        );
        expect(excelEvidence).toEqual(
          expect.objectContaining({
            id: "excel:estimates/load-schedule.xlsx:Summary:r2",
            sourceType: "excel",
            sourcePath: "estimates/load-schedule.xlsx",
            sheetName: "Summary",
            rowIndex: 2,
          }),
        );
        expect(
          first.report.kecCitations.some(
            (citation) =>
              citation.sourcePath === "knowledge/kec-source.pdf" &&
              citation.label === "KEC 232.5" &&
              citation.page === 1,
          ),
        ).toBe(true);
        expect(first.report.coverage.some((finding) => finding.reason === "sheet-selection")).toBe(
          true,
        );
        expect(first.report.coverage.some((finding) => finding.reason === "row-limit")).toBe(true);
        expect(first.report.itemReviews.some((item) => item.name === "케이블")).toBe(true);
        expect(first.report.itemReviews.some((item) => item.name === "전압강하")).toBe(true);
        expect(
          first.report.relations.some((finding) => finding.message.includes("케이블과 전압강하")),
        ).toBe(true);
        expect(serializeMarkdownReport(first.report) === first.markdown).toBe(true);
        expectRequiredSections(first.markdown);
        expect(normalizeMarkdown(first.markdown, fixture.projectRoot)).toBe(
          normalizeMarkdown(second.markdown, fixture.projectRoot),
        );
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    } finally {
      await fixture.cleanup();
    }

    expect(existsSync(fixture.projectRoot)).toBe(false);
  });

  it("restores managed environment values after E2E isolation", async () => {
    const fixture = await createReviewFixture();
    const originalModel = process.env.REVIEW_LLM_MODEL;
    process.env.REVIEW_LLM_MODEL = "outside-e2e-model";

    try {
      await withE2eEnvironment(fixture, async () => {
        expect(process.env.PROJECT_ROOT === fixture.projectRoot).toBe(true);
        expect(process.env.KEC_DB_PATH === fixture.kecDbPath).toBe(true);
        expect(process.env.REVIEW_LLM_MODEL).toBeUndefined();
      });

      expect(process.env.PROJECT_ROOT === fixture.projectRoot).toBe(false);
      expect(process.env.KEC_DB_PATH === fixture.kecDbPath).toBe(false);
      expect(process.env.REVIEW_LLM_MODEL).toBe("outside-e2e-model");
    } finally {
      if (originalModel === undefined) {
        delete process.env.REVIEW_LLM_MODEL;
      } else {
        process.env.REVIEW_LLM_MODEL = originalModel;
      }

      await fixture.cleanup();
    }

    expect(existsSync(fixture.projectRoot)).toBe(false);
  });
});
