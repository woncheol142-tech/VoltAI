import { describe, expect, it, vi } from "vitest";

import {
  MockReviewLlm,
  reviewProject,
  type ReviewProjectPorts,
} from "../src/index.js";

function createPorts(overrides: Partial<ReviewProjectPorts> = {}): ReviewProjectPorts {
  return {
    listProjectFiles: vi.fn().mockResolvedValue([
      {
        name: "panel.pdf",
        relativePath: "docs/panel.pdf",
        extension: ".pdf",
        size: 1024,
        modifiedAt: "2026-07-09T00:00:00.000Z",
      },
      {
        name: "estimate.xlsx",
        relativePath: "estimate/estimate.xlsx",
        extension: ".xlsx",
        size: 2048,
        modifiedAt: "2026-07-09T00:00:00.000Z",
      },
    ]),
    readPdf: vi.fn().mockResolvedValue({
      relativePath: "docs/panel.pdf",
      pageCount: 2,
      text: "Main panel cable sizing and grounding design.",
      pages: [{ page: 1, text: "Main panel cable sizing and grounding design." }],
      truncated: false,
    }),
    readExcel: vi.fn().mockResolvedValue({
      relativePath: "estimate/estimate.xlsx",
      sheets: ["Summary"],
      sheetName: "Summary",
      rows: [["Item", "Qty"], ["Cable", 10]],
    }),
    searchKec: vi.fn().mockResolvedValue([
      {
        clause: "KEC 232.5",
        page: 12,
        text: "Cable sizing shall follow allowable current.",
        similarity: 0.91,
        sourcePath: "kec/kec.pdf",
      },
    ]),
    llm: new MockReviewLlm(),
    ...overrides,
  };
}

describe("reviewProject", () => {
  it("calls listProjectFiles, readPdf/readExcel, searchKec, and llm in order", async () => {
    const events: string[] = [];
    const ports = createPorts({
      listProjectFiles: vi.fn().mockImplementation(async () => {
        events.push("listProjectFiles");
        return [
          {
            name: "panel.pdf",
            relativePath: "docs/panel.pdf",
            extension: ".pdf",
            size: 1024,
            modifiedAt: "2026-07-09T00:00:00.000Z",
          },
          {
            name: "estimate.xlsx",
            relativePath: "estimate/estimate.xlsx",
            extension: ".xlsx",
            size: 2048,
            modifiedAt: "2026-07-09T00:00:00.000Z",
          },
        ];
      }),
      readPdf: vi.fn().mockImplementation(async () => {
        events.push("readPdf");
        return {
          relativePath: "docs/panel.pdf",
          pageCount: 2,
          text: "Panel cable design.",
          pages: [{ page: 1, text: "Panel cable design." }],
          truncated: false,
        };
      }),
      readExcel: vi.fn().mockImplementation(async () => {
        events.push("readExcel");
        return {
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary"],
          rows: [["Item", "Qty"]],
        };
      }),
      searchKec: vi.fn().mockImplementation(async () => {
        events.push("searchKec");
        return [
          {
            clause: "KEC 232.5",
            page: 12,
            text: "Cable sizing rule.",
            similarity: 0.91,
            sourcePath: "kec/kec.pdf",
          },
        ];
      }),
      llm: {
        generateReview: vi.fn().mockImplementation(async () => {
          events.push("llm");
          return new MockReviewLlm().generateReview({
            projectPath: "/project",
            files: [],
            pdfs: [],
            excels: [],
            kecResults: [],
            itemReviews: [],
            findings: [],
          });
        }),
      },
    });

    await reviewProject({ projectPath: "/project" }, ports);

    expect(events.slice(0, 5)).toEqual([
      "listProjectFiles",
      "readPdf",
      "readExcel",
      "readExcel",
      "searchKec",
    ]);
    expect(events.at(-1)).toBe("llm");
  });

  it("returns a markdown report with required sections", async () => {
    const report = await reviewProject({ projectPath: "/project" }, createPorts());

    expect(report).toContain("# 프로젝트 개요");
    expect(report).toContain("# 주요 설계 내용");
    expect(report).toContain("# 관련 KEC 조항");
    expect(report).toContain("# 잠재 위험");
    expect(report).toContain("# 확인 필요사항");
    expect(report).toContain("# 검토 의견");
  });

  it("creates a report when there are no PDF files", async () => {
    const ports = createPorts({
      listProjectFiles: vi.fn().mockResolvedValue([
        {
          name: "estimate.xlsx",
          relativePath: "estimate/estimate.xlsx",
          extension: ".xlsx",
          size: 2048,
          modifiedAt: "2026-07-09T00:00:00.000Z",
        },
      ]),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("# 검토 의견");
    expect(ports.readPdf).not.toHaveBeenCalled();
  });

  it("creates a report when there are no Excel files", async () => {
    const ports = createPorts({
      listProjectFiles: vi.fn().mockResolvedValue([
        {
          name: "panel.pdf",
          relativePath: "docs/panel.pdf",
          extension: ".pdf",
          size: 1024,
          modifiedAt: "2026-07-09T00:00:00.000Z",
        },
      ]),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("# 검토 의견");
    expect(ports.readExcel).not.toHaveBeenCalled();
  });

  it("records individual PDF and Excel read failures in 확인 필요사항", async () => {
    const ports = createPorts({
      readPdf: vi.fn().mockRejectedValue(new Error("PDF is encrypted")),
      readExcel: vi.fn().mockRejectedValue(new Error("Workbook is corrupted")),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("docs/panel.pdf");
    expect(report).toContain("PDF is encrypted");
    expect(report).toContain("estimate/estimate.xlsx");
    expect(report).toContain("Workbook is corrupted");
  });

  it("includes KEC search results in the related KEC section", async () => {
    const report = await reviewProject({ projectPath: "/project" }, createPorts());

    expect(report).toContain("KEC 232.5");
    expect(report).toContain("Cable sizing shall follow allowable current.");
  });

  it("uses the default ingestion policy for Excel first sheet and maxRows 50", async () => {
    const readExcel = vi
      .fn()
      .mockResolvedValueOnce({
        relativePath: "estimate/estimate.xlsx",
        sheets: ["Summary", "Load"],
      })
      .mockResolvedValueOnce({
        relativePath: "estimate/estimate.xlsx",
        sheets: ["Summary", "Load"],
        sheetName: "Summary",
        rows: [["Item", "Qty"], ["Cable", 10]],
      });
    const ports = createPorts({ readExcel });

    await reviewProject({ projectPath: "/project" }, ports);

    expect(readExcel).toHaveBeenNthCalledWith(1, "estimate/estimate.xlsx");
    expect(readExcel).toHaveBeenNthCalledWith(2, "estimate/estimate.xlsx", {
      sheetName: "Summary",
      maxRows: 50,
    });
  });

  it("reports a coverage warning when an Excel workbook has multiple sheets", async () => {
    const ports = createPorts({
      readExcel: vi
        .fn()
        .mockResolvedValueOnce({
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary", "Load"],
        })
        .mockResolvedValueOnce({
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary", "Load"],
          sheetName: "Summary",
          rows: [["Item", "Qty"], ["Cable", 10]],
        }),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("# 확인 필요사항");
    expect(report).toContain(
      "warning: estimate/estimate.xlsx has 2 sheets; reviewed first sheet only: Summary",
    );
  });

  it("reports a coverage warning when Excel rows reach the maxRows limit", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => [`Cable row ${index + 1}`]);
    const ports = createPorts({
      readExcel: vi
        .fn()
        .mockResolvedValueOnce({
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary"],
        })
        .mockResolvedValueOnce({
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary"],
          sheetName: "Summary",
          rows,
          totalRows: 51,
        }),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain(
      "warning: estimate/estimate.xlsx [Summary] was limited to 50 rows",
    );
  });

  it("does not report an Excel row limit warning when totalRows equals reviewed rows", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => [`Cable row ${index + 1}`]);
    const ports = createPorts({
      readExcel: vi
        .fn()
        .mockResolvedValueOnce({
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary"],
        })
        .mockResolvedValueOnce({
          relativePath: "estimate/estimate.xlsx",
          sheets: ["Summary"],
          sheetName: "Summary",
          rows,
          totalRows: 50,
        }),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).not.toContain(
      "warning: estimate/estimate.xlsx [Summary] was limited to 50 rows",
    );
  });

  it("passes PDF maxCharsPerFile policy to readPdf and reports coverage warning", async () => {
    const readPdf = vi.fn().mockResolvedValue({
      relativePath: "docs/panel.pdf",
      pageCount: 2,
      text: "Panel cable design.",
      pages: [{ page: 1, text: "Panel cable design." }],
      truncated: true,
    });
    const ports = createPorts({ readPdf });

    const report = await reviewProject(
      {
        projectPath: "/project",
        ingestionPolicy: {
          excel: {
            sheetSelection: "first",
            maxRowsPerSheet: 50,
          },
          pdf: {
            maxCharsPerFile: 20,
          },
          coverageWarnings: true,
        },
      },
      ports,
    );

    expect(readPdf).toHaveBeenCalledWith("docs/panel.pdf", { maxChars: 20 });
    expect(report).toContain("warning: docs/panel.pdf was limited to 20 characters");
    expect(report).toContain("# 프로젝트 개요");
    expect(report).toContain("# 주요 설계 내용");
    expect(report).toContain("# 관련 KEC 조항");
    expect(report).toContain("# 항목별 검토");
    expect(report).toContain("# 잠재 위험");
    expect(report).toContain("# 확인 필요사항");
    expect(report).toContain("# 검토 의견");
  });

  it("does not report a PDF coverage warning when maxChars does not truncate the PDF", async () => {
    const readPdf = vi.fn().mockResolvedValue({
      relativePath: "docs/panel.pdf",
      pageCount: 2,
      text: "Panel cable design.",
      pages: [{ page: 1, text: "Panel cable design." }],
      truncated: false,
    });
    const ports = createPorts({ readPdf });

    const report = await reviewProject(
      {
        projectPath: "/project",
        ingestionPolicy: {
          excel: {
            sheetSelection: "first",
            maxRowsPerSheet: 50,
          },
          pdf: {
            maxCharsPerFile: 20,
          },
          coverageWarnings: true,
        },
      },
      ports,
    );

    expect(report).not.toContain("warning: docs/panel.pdf was limited to 20 characters");
  });

  it("searches KEC for each discovered design item and renders item reviews", async () => {
    const searchKec = vi
      .fn()
      .mockResolvedValueOnce([
        {
          clause: "KEC 232.5",
          page: 12,
          text: "Cable sizing shall follow allowable current.",
          similarity: 0.91,
          sourcePath: "kec/kec.pdf",
        },
      ])
      .mockResolvedValueOnce([
        {
          clause: "KEC 140",
          page: 4,
          text: "Grounding shall be verified.",
          similarity: 0.88,
          sourcePath: "kec/kec.pdf",
        },
      ])
      .mockResolvedValueOnce([
        {
          clause: "KEC 212.3",
          page: 8,
          text: "Breaker protection shall be coordinated.",
          similarity: 0.86,
          sourcePath: "kec/kec.pdf",
        },
      ])
      .mockResolvedValueOnce([
        {
          clause: "KEC 212.3",
          page: 8,
          text: "Breaker protection shall be coordinated.",
          similarity: 0.86,
          sourcePath: "kec/kec.pdf",
        },
      ]);
    const ports = createPorts({
      readPdf: vi.fn().mockResolvedValue({
        relativePath: "docs/panel.pdf",
        pageCount: 2,
        text: "케이블 포설 및 접지 계획을 검토한다.",
        pages: [{ page: 1, text: "케이블 포설 및 접지 계획을 검토한다." }],
        truncated: false,
      }),
      readExcel: vi.fn().mockResolvedValue({
        relativePath: "estimate/estimate.xlsx",
        sheets: ["Summary"],
        sheetName: "Summary",
        rows: [["Item", "Description"], ["MCCB", "Main breaker"]],
      }),
      searchKec,
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(searchKec).toHaveBeenCalledWith("케이블 KEC 기준");
    expect(searchKec).toHaveBeenCalledWith("접지 KEC 기준");
    expect(searchKec).toHaveBeenCalledWith("차단기 KEC 기준");
    expect(report).toContain("# 항목별 검토");
    expect(report).toContain("## 케이블");
    expect(report).toContain("발견 근거");
    expect(report).toContain("docs/panel.pdf p.1: 케이블 포설 및 접지 계획을 검토한다.");
    expect(report).toContain("estimate/estimate.xlsx [Summary row 2]: MCCB Main breaker");
    expect(report).toContain("관련 KEC 검색 결과");
    expect(report).toContain("확인 필요사항");
    expect(report).toContain("KEC 232.5");
    expect(report).toContain("KEC 140");
    expect(report).toContain("KEC 212.3");
  });

  it("records item-level KEC search failures in that item's 확인 필요사항", async () => {
    const ports = createPorts({
      readPdf: vi.fn().mockResolvedValue({
        relativePath: "docs/panel.pdf",
        pageCount: 2,
        text: "케이블 포설 계획을 검토한다.",
        pages: [{ page: 1, text: "케이블 포설 계획을 검토한다." }],
        truncated: false,
      }),
      readExcel: vi.fn().mockResolvedValue({
        relativePath: "estimate/estimate.xlsx",
        sheets: ["Summary"],
        rows: [],
      }),
      searchKec: vi.fn().mockRejectedValue(new Error("KEC index missing")),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("## 케이블");
    expect(report).toContain("KEC index missing");
  });

  it("renders human-readable PDF and Excel citations from structured evidence", async () => {
    const ports = createPorts({
      readPdf: vi.fn().mockResolvedValue({
        relativePath: "docs/spec.pdf",
        pageCount: 3,
        text: "조명 부하 산정을 확인한다.",
        pages: [{ page: 3, text: "조명 부하 산정을 확인한다." }],
        truncated: false,
      }),
      readExcel: vi.fn().mockResolvedValue({
        relativePath: "estimate.xlsx",
        sheets: ["Sheet1"],
        sheetName: "Sheet1",
        rows: Array.from({ length: 12 }, (_, index) =>
          index === 11 ? ["MCCB", "Main breaker"] : [`Row ${index + 1}`],
        ),
      }),
      searchKec: vi.fn().mockResolvedValue([
        {
          clause: "KEC 212.3",
          page: 8,
          text: "Related rule.",
          similarity: 0.86,
          sourcePath: "kec/kec.pdf",
        },
      ]),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("docs/spec.pdf p.3: 조명 부하 산정을 확인한다.");
    expect(report).toContain("estimate.xlsx [Sheet1 row 12]: MCCB Main breaker");
    expect(report).toContain("# 프로젝트 개요");
    expect(report).toContain("# 주요 설계 내용");
    expect(report).toContain("# 관련 KEC 조항");
    expect(report).toContain("# 항목별 검토");
    expect(report).toContain("# 잠재 위험");
    expect(report).toContain("# 확인 필요사항");
    expect(report).toContain("# 검토 의견");
  });

  it("renders relation-based comments in related item reviews", async () => {
    const ports = createPorts({
      readPdf: vi.fn().mockResolvedValue({
        relativePath: "docs/panel.pdf",
        pageCount: 2,
        text: "케이블 포설과 전압강하 계산을 함께 검토한다.",
        pages: [{ page: 1, text: "케이블 포설과 전압강하 계산을 함께 검토한다." }],
        truncated: false,
      }),
      readExcel: vi.fn().mockResolvedValue({
        relativePath: "estimate/estimate.xlsx",
        sheets: ["Summary"],
        rows: [["Item", "Description"], ["MCCB", "Load calculation for panel"]],
      }),
      searchKec: vi.fn().mockResolvedValue([
        {
          clause: "KEC 232.5",
          page: 12,
          text: "Related rule.",
          similarity: 0.91,
          sourcePath: "kec/kec.pdf",
        },
      ]),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("## 케이블");
    expect(report).toContain("## 전압강하");
    expect(report).toContain("케이블과 전압강하가 함께 발견되어 전압강하 계산 근거 확인 필요");
    expect(report).toContain("severity: high");
    expect(report).toContain("confidence: high");
    expect(report).toContain("proximity: same-excerpt");
    expect(report).toContain("## 차단기");
    expect(report).toContain("## 부하");
    expect(report).toContain("차단기와 부하가 함께 발견되어 차단기 정격 선정 근거 확인 필요");
    expect(report).toContain("proximity: same-row");
    expect(report).toContain("## 분전반");
    expect(report).toContain("분전반과 차단기가 함께 발견되어 보호기기 배치 및 정격 협조 확인 필요");
  });

  it("uses a mock LLM and does not require OpenAI API", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const report = await reviewProject({ projectPath: "/project" }, createPorts());

      expect(report).toContain("# 프로젝트 개요");
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });

  it("rejects missing projectPath with a clear error", async () => {
    await expect(reviewProject({ projectPath: "" }, createPorts())).rejects.toThrow(
      "projectPath is required",
    );
  });

  it("creates a report when no design item candidates are found", async () => {
    const ports = createPorts({
      readPdf: vi.fn().mockResolvedValue({
        relativePath: "docs/notes.pdf",
        pageCount: 1,
        text: "General project notes only.",
        pages: [{ page: 1, text: "General project notes only." }],
        truncated: false,
      }),
      readExcel: vi.fn().mockResolvedValue({
        relativePath: "estimate/notes.xlsx",
        sheets: ["Notes"],
        rows: [["General notes"]],
      }),
    });

    const report = await reviewProject({ projectPath: "/project" }, ports);

    expect(report).toContain("# 항목별 검토");
    expect(report).toContain("식별된 설계 항목이 없습니다.");
  });
});
