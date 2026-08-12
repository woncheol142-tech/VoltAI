import { rmSync } from "node:fs";

import {
  reviewElectricalRequest,
  type ElectricalReviewPorts,
  type KecSearchResult,
} from "@voltai/agent-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDrawingSearchDocument,
  writeDrawingSearchIndex,
} from "../../../mcp-project-files/test/helpers/drawingSearchFixture.js";
import {
  createValidPageMapDocument,
  roundFixtureCoverage,
  writePageMapFixture,
} from "../../../mcp-project-files/test/helpers/drawingPageMapFixture.js";
import {
  createMultiPageTextPdf,
  createTempPdfProject,
  writeProjectFile,
} from "../../../mcp-project-files/test/helpers/pdfFixture.js";
import {
  createCapturingMockReviewLlm,
  type CapturingMockReviewLlm,
} from "./helpers/reviewFixture.js";

if (typeof reviewElectricalRequest !== "function") {
  throw new TypeError(
    "Task66 API missing: reviewElectricalRequest is not exported",
  );
}

const targetRequest =
  "101동 지하2층 전력간선 관련 도면을 찾아서 KEC 기준으로 검토해줘";
const indexPath = ".volt-ai/indexes/drawing-index.json";
const pageMapPath = ".volt-ai/page-maps/drawing-pages.json";
const sourcePath = "docs/drawing-list.pdf";
const selectedPageText = "SELECTED_PAGE_ONLY feeder cable sizing evidence";
const excludedPageText = "WHOLE_PROJECT_SENTINEL unrelated drawing content";
const fixtureKecResult: KecSearchResult = {
  clause: "FIXTURE-CODE 12.3",
  page: 7,
  text: "Fixture feeder review requirement.",
  similarity: 0.93,
  sourcePath: "knowledge/fixture-code.pdf",
};

type ElectricalFixture = {
  projectRoot: string;
  indexPath: string;
  pageMapPath: string;
  sourcePath: string;
};

const roots: string[] = [];

function createElectricalFixture(): ElectricalFixture {
  const projectRoot = createTempPdfProject();
  roots.push(projectRoot);
  writeProjectFile(
    projectRoot,
    sourcePath,
    createMultiPageTextPdf([
      excludedPageText,
      selectedPageText,
      "UNRELATED_LATE_PAGE_SENTINEL transformer schedule",
    ]),
  );

  const index = createDrawingSearchDocument({ source: sourcePath });
  writeDrawingSearchIndex(projectRoot, index, indexPath);
  const unmatchedDrawingNumbers = index.drawings
    .map((drawing) => drawing.drawingNo)
    .filter((drawingNo) => drawingNo !== "E-401");
  writePageMapFixture(
    projectRoot,
    createValidPageMapDocument({
      source: index.source,
      sourceSha256: index.sourceSha256,
      indexPath,
      indexSourceSha256: index.sourceSha256,
      startPage: 1,
      endPage: 3,
      scannedPageCount: 3,
      indexedDrawingCount: index.drawings.length,
      mappings: [
        {
          drawingNo: "E-401",
          drawingPage: 2,
          detectedTitle: "1단지 101동 지하2층 전력간선설비 평면도",
          confidence: 0.99,
          matchMethod: "title-block-coordinate",
        },
      ],
      mappingCount: 1,
      unmatchedDrawingNumbers,
      unmatchedCount: unmatchedDrawingNumbers.length,
      coverageRatio: roundFixtureCoverage(1 / index.drawings.length),
      duplicatePageMatches: [],
      warnings: [],
    }),
    pageMapPath,
  );

  return { projectRoot, indexPath, pageMapPath, sourcePath };
}

async function createPorts(
  fixture: ElectricalFixture,
  llm: CapturingMockReviewLlm,
): Promise<ElectricalReviewPorts> {
  const { createLocalElectricalReviewPorts } =
    await import("../../src/ports/localElectricalReviewPorts.js");

  return createLocalElectricalReviewPorts(fixture.projectRoot, {
    indexPath: fixture.indexPath,
    pageMapPath: fixture.pageMapPath,
    searchKec: vi.fn(async () => [{ ...fixtureKecResult }]),
    llm,
  });
}

describe("electrical request E2E", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves the literal request to page-scoped drawing and KEC evidence with provenance", async () => {
    const fixture = createElectricalFixture();
    const llm = createCapturingMockReviewLlm();
    const fetchSpy = vi.fn(async () => {
      throw new Error("electrical review E2E must not make network requests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const ports = await createPorts(fixture, llm);

    const result = await reviewElectricalRequest(
      { projectPath: fixture.projectRoot, request: targetRequest },
      ports,
    );

    expect(result.selection).toBe("selected");
    expect(result.drawingQuery).toContain("101동");
    expect(result.drawingQuery).toContain("지하2층");
    expect(result.drawingQuery).toContain("전력간선");
    expect(result.selectedDrawings).toEqual([
      expect.objectContaining({
        drawingNo: "E-401",
        sourcePath: fixture.sourcePath,
        page: 2,
      }),
    ]);
    expect(llm.input?.pdfs).toEqual([
      expect.objectContaining({
        relativePath: fixture.sourcePath,
        text: expect.stringContaining(selectedPageText),
        pages: [
          expect.objectContaining({
            page: 2,
            text: expect.stringContaining(selectedPageText),
          }),
        ],
      }),
    ]);
    expect(llm.input?.pdfs[0]?.text).not.toContain(excludedPageText);
    expect(llm.input?.pdfs[0]?.text).not.toContain(
      "UNRELATED_LATE_PAGE_SENTINEL",
    );
    expect(llm.input?.kecResults).toEqual([{ ...fixtureKecResult }]);
    expect(result.kecCitations).toEqual([
      expect.objectContaining({
        label: "FIXTURE-CODE 12.3",
        sourcePath: "knowledge/fixture-code.pdf",
        page: 7,
      }),
    ]);
    expect(result.markdown).toContain("FIXTURE-CODE 12.3");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ambiguous for the real equal-score drawing search instead of reviewing top-1", async () => {
    const fixture = createElectricalFixture();
    const llm = createCapturingMockReviewLlm();
    const ports = await createPorts(fixture, llm);

    const result = await reviewElectricalRequest(
      { projectPath: fixture.projectRoot, request: "101동 전력간선" },
      ports,
    );

    expect(result.selection).toBe("ambiguous");
    expect(result.selectedDrawings).toEqual([]);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ drawingNo: "E-400", score: 0.9 }),
        expect.objectContaining({ drawingNo: "E-402", score: 0.9 }),
        expect.objectContaining({ drawingNo: "E-401", score: 0.9 }),
      ]),
    );
    expect(llm.input).toBeUndefined();
  });

  it("returns not-found with warnings and no LLM call for an unmatched request", async () => {
    const fixture = createElectricalFixture();
    const llm = createCapturingMockReviewLlm();
    const ports = await createPorts(fixture, llm);

    await expect(
      reviewElectricalRequest(
        {
          projectPath: fixture.projectRoot,
          request: "999동 옥상 태양광 관련 도면을 찾아서 KEC 기준으로 검토해줘",
        },
        ports,
      ),
    ).resolves.toMatchObject({
      selection: "not-found",
      selectedDrawings: [],
      warnings: expect.arrayContaining(["lexical search did not find a match"]),
    });
    expect(llm.input).toBeUndefined();
  });
});
