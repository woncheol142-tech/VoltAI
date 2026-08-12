import { describe, expect, it, vi } from "vitest";

import {
  reviewElectricalRequest,
  type ElectricalReviewPorts,
  type ReviewPromptInput,
} from "../src/index.js";

if (typeof reviewElectricalRequest !== "function") {
  throw new TypeError(
    "Task66 API missing: reviewElectricalRequest is not exported",
  );
}

const targetRequest =
  "101동 지하2층 전력간선 관련 도면을 찾아서 KEC 기준으로 검토해줘";

const selectedCandidate = {
  drawingNo: "E-401",
  title: "1단지 101동 지하2층 전력간선설비 평면도",
  category: "전력간선",
  complex: "1단지",
  building: "101동",
  floor: "지하2층",
  scaleA1: "1/100",
  scaleA3: "1/200",
  sourceListPage: 4,
  confidence: 0.76,
  score: 0.9067,
  matchedFields: ["title", "category", "building", "floor"],
  matchReasons: [
    "building exact match: 101동",
    "floor exact match: 지하2층",
    "category direct match: 전력간선",
  ],
  drawingPage: 42,
  pageMatchConfidence: 0.99,
  pageMatchMethod: "title-block-coordinate",
} as const;

const kecResult = {
  clause: "FIXTURE-CODE 12.3",
  page: 7,
  text: "Fixture feeder review requirement.",
  similarity: 0.93,
  sourcePath: "knowledge/fixture-code.pdf",
} as const;

function uniqueSearchResult(query = "101동 지하2층 전력간선") {
  return {
    sourcePath: "docs/drawing-list.pdf",
    query,
    normalizedQuery: query,
    resultCount: 1,
    totalCandidates: 1,
    results: [{ ...selectedCandidate }],
    warnings: [],
  };
}

function createPorts(overrides: Partial<ElectricalReviewPorts> = {}) {
  const llm = {
    generateReview: vi.fn(async () => "# deterministic electrical review"),
  };
  const ports = {
    searchDrawings: vi.fn(async (query: string) => uniqueSearchResult(query)),
    readDrawingPage: vi.fn(async (sourcePath: string, page: number) => ({
      sourcePath,
      page,
      pageCount: 80,
      text: "SELECTED_DRAWING_PAGE feeder cable evidence",
      warnings: [],
    })),
    searchKec: vi.fn(async () => [{ ...kecResult }]),
    llm,
    ...overrides,
  } satisfies ElectricalReviewPorts;

  return { ports, llm };
}

describe("reviewElectricalRequest", () => {
  it("extracts a bounded drawing query while preserving building, floor, and category intent", async () => {
    const { ports } = createPorts();

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(ports.searchDrawings).toHaveBeenCalledTimes(1);
    const drawingQuery = ports.searchDrawings.mock.calls[0]?.[0];
    expect(drawingQuery).toEqual(expect.any(String));
    expect(drawingQuery).toContain("101동");
    expect(drawingQuery).toContain("지하2층");
    expect(drawingQuery).toContain("전력간선");
    for (const noise of [
      "KEC",
      "kec",
      "기준으로",
      "검토해줘",
      "찾아서",
      "도면을",
    ]) {
      expect(drawingQuery).not.toContain(noise);
    }
    expect(result.selection).toBe("selected");
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({
        drawingNo: "E-401",
        sourcePath: "docs/drawing-list.pdf",
        page: 42,
      }),
    ]);
  });

  it("uses the maximum score and returns ambiguity when unsorted results tie at the maximum", async () => {
    const tiedCandidates = [
      {
        ...selectedCandidate,
        drawingNo: "E-399",
        floor: "지상1층",
        confidence: 1,
        score: 0.75,
      },
      {
        ...selectedCandidate,
        drawingNo: "E-400",
        floor: "지하1층",
        confidence: 1,
        score: 0.9,
      },
      {
        ...selectedCandidate,
        drawingNo: "E-401",
        floor: "지하2층",
        confidence: 0.76,
        score: 0.9,
      },
    ];
    const searchDrawings = vi.fn(async (query: string) => ({
      sourcePath: "docs/drawing-list.pdf",
      query,
      normalizedQuery: query,
      resultCount: tiedCandidates.length,
      totalCandidates: tiedCandidates.length,
      results: tiedCandidates,
      warnings: [],
    }));
    const readDrawingPage = vi.fn();
    const searchKec = vi.fn();
    const llm = { generateReview: vi.fn() };
    const ports = {
      searchDrawings,
      readDrawingPage,
      searchKec,
      llm,
    } satisfies ElectricalReviewPorts;

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: "101동 전력간선" },
      ports,
    );

    expect(result.selection).toBe("ambiguous");
    expect(result.selectedDrawings).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.drawingNo)).toEqual([
      "E-400",
      "E-401",
    ]);
    expect(readDrawingPage).not.toHaveBeenCalled();
    expect(searchKec).not.toHaveBeenCalled();
    expect(llm.generateReview).not.toHaveBeenCalled();
  });

  it("selects a later authoritative maximum instead of the first result", async () => {
    const candidates = [
      {
        ...selectedCandidate,
        drawingNo: "E-400",
        floor: "지하1층",
        score: 0.9,
        drawingPage: 41,
      },
      {
        ...selectedCandidate,
        drawingNo: "E-401",
        score: 0.99,
        drawingPage: 42,
      },
    ];
    const searchDrawings = vi.fn(async (query: string) => ({
      sourcePath: "docs/drawing-list.pdf",
      query,
      normalizedQuery: query,
      resultCount: candidates.length,
      totalCandidates: candidates.length,
      results: candidates,
      warnings: [],
    }));
    const { ports } = createPorts({ searchDrawings });

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: "101동 전력간선" },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.candidates.map((candidate) => candidate.drawingNo)).toEqual([
      "E-401",
    ]);
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({ drawingNo: "E-401", page: 42 }),
    ]);
    expect(ports.readDrawingPage).toHaveBeenCalledWith(
      "docs/drawing-list.pdf",
      42,
    );
  });

  it("returns a non-throwing not-found result and preserves drawing-search diagnostics", async () => {
    const warning = "lexical search did not find a match";
    const searchDrawings = vi.fn(async (query: string) => ({
      sourcePath: "docs/drawing-list.pdf",
      query,
      normalizedQuery: query,
      resultCount: 0,
      totalCandidates: 0,
      results: [],
      warnings: [warning],
    }));
    const readDrawingPage = vi.fn();
    const searchKec = vi.fn();
    const llm = { generateReview: vi.fn() };
    const ports = {
      searchDrawings,
      readDrawingPage,
      searchKec,
      llm,
    } satisfies ElectricalReviewPorts;

    const result = await reviewElectricalRequest(
      {
        projectPath: "/project",
        request: "999동 존재하지 않는 전력간선 도면 검토",
      },
      ports,
    );

    expect(result).toMatchObject({
      selection: "not-found",
      selectedDrawings: [],
      warnings: expect.arrayContaining([warning]),
    });
    expect(result.markdown).toBeUndefined();
    expect(readDrawingPage).not.toHaveBeenCalled();
    expect(searchKec).not.toHaveBeenCalled();
    expect(llm.generateReview).not.toHaveBeenCalled();
  });

  it("completes a uniquely selected review when company knowledge is not configured", async () => {
    const capturedInputs: ReviewPromptInput[] = [];
    const { ports } = createPorts({
      llm: {
        generateReview: vi.fn(async (input: ReviewPromptInput) => {
          capturedInputs.push(input);
          return "# electrical review without company knowledge";
        }),
      },
    });

    expect("searchCompany" in ports).toBe(false);
    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.markdown).toBe(
      "# electrical review without company knowledge",
    );
    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.kecResults).toEqual([{ ...kecResult }]);
  });

  it("retains selected drawing provenance when selected-page evidence cannot be read", async () => {
    const readDrawingPage = vi.fn(async () => {
      throw new Error("fixture page extraction failed");
    });
    const searchKec = vi.fn();
    const llm = { generateReview: vi.fn() };
    const { ports } = createPorts({ readDrawingPage, searchKec, llm });

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({
        drawingNo: "E-401",
        sourcePath: "docs/drawing-list.pdf",
        page: 42,
      }),
    ]);
    expect(result.markdown).toBeUndefined();
    expect(result.warnings.join("\n")).toContain(
      "fixture page extraction failed",
    );
    expect(searchKec).not.toHaveBeenCalled();
    expect(llm.generateReview).not.toHaveBeenCalled();
  });

  it("retains selected drawing provenance and blocks downstream work when the page map is unresolved", async () => {
    const candidate = { ...selectedCandidate, drawingPage: null };
    const searchDrawings = vi.fn(async (query: string) => ({
      sourcePath: "docs/drawing-list.pdf",
      query,
      normalizedQuery: query,
      resultCount: 1,
      totalCandidates: 1,
      results: [candidate],
      warnings: [],
    }));
    const readDrawingPage = vi.fn();
    const searchKec = vi.fn();
    const searchCompany = vi.fn();
    const llm = { generateReview: vi.fn() };
    const { ports } = createPorts({
      searchDrawings,
      readDrawingPage,
      searchKec,
      searchCompany,
      llm,
    });

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({ drawingNo: "E-401", page: null }),
    ]);
    expect(result.markdown).toBeUndefined();
    expect(result.warnings.join("\n")).toContain(
      "drawing E-401 does not have a unique page mapping",
    );
    expect(readDrawingPage).not.toHaveBeenCalled();
    expect(searchKec).not.toHaveBeenCalled();
    expect(searchCompany).not.toHaveBeenCalled();
    expect(llm.generateReview).not.toHaveBeenCalled();
  });

  it("blocks an evidence-free review when the selected page has no readable text", async () => {
    const readDrawingPage = vi.fn(async (sourcePath: string, page: number) => ({
      sourcePath,
      page,
      pageCount: 80,
      text: " \n\t ",
      warnings: [],
    }));
    const searchKec = vi.fn();
    const searchCompany = vi.fn();
    const llm = { generateReview: vi.fn() };
    const { ports } = createPorts({
      readDrawingPage,
      searchKec,
      searchCompany,
      llm,
    });

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({ drawingNo: "E-401", page: 42 }),
    ]);
    expect(result.markdown).toBeUndefined();
    expect(result.warnings.join("\n")).toContain(
      "drawing E-401 page 42 has no readable text",
    );
    expect(searchKec).not.toHaveBeenCalled();
    expect(searchCompany).not.toHaveBeenCalled();
    expect(llm.generateReview).not.toHaveBeenCalled();
  });

  it("continues with selected page evidence and no citations when KEC search fails", async () => {
    const searchKec = vi.fn(async () => {
      throw new Error("fixture KEC unavailable");
    });
    const searchCompany = vi.fn();
    const capturedInputs: ReviewPromptInput[] = [];
    const llm = {
      generateReview: vi.fn(async (input: ReviewPromptInput) => {
        capturedInputs.push(input);
        return "# review with unavailable KEC knowledge";
      }),
    };
    const { ports } = createPorts({ searchKec, searchCompany, llm });

    const result = await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({ drawingNo: "E-401", page: 42 }),
    ]);
    expect(result.warnings).toContain(
      "KEC search: fixture KEC unavailable",
    );
    expect(result.kecCitations).toEqual([]);
    expect(result.markdown).toBe("# review with unavailable KEC knowledge");
    expect(searchCompany).not.toHaveBeenCalled();
    expect(llm.generateReview).toHaveBeenCalledTimes(1);
    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.kecResults).toEqual([]);
    expect(capturedInputs[0]?.companyResults).toEqual([]);
    expect(capturedInputs[0]?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          message: "KEC search: fixture KEC unavailable",
        }),
      ]),
    );
  });

  it("queries KEC with selected drawing identity and bounded page evidence", async () => {
    const searchKec = vi.fn(async () => [{ ...kecResult }]);
    const { ports } = createPorts({ searchKec });

    await reviewElectricalRequest(
      { projectPath: "/project", request: targetRequest },
      ports,
    );

    expect(searchKec).toHaveBeenCalledTimes(1);
    const context = searchKec.mock.calls[0]?.[0];
    expect(context).toEqual(expect.any(String));
    expect(context).toContain("E-401");
    expect(context).toContain("SELECTED_DRAWING_PAGE feeder cable evidence");
  });
});
