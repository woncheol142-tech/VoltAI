import { describe, expect, it } from "vitest";

import {
  createDrawingListTextPage,
  createTwoPageDrawingListTextFixture,
  type DrawingListFixturePage,
  type DrawingListFixtureRow,
} from "./helpers/drawingListFixture.js";

type DrawingCategory =
  | "도면목록"
  | "수변전"
  | "전력간선"
  | "분전반"
  | "MCC"
  | "전등"
  | "전열"
  | "동력"
  | "접지"
  | "피뢰"
  | "태양광"
  | "보안등"
  | "조경등"
  | "소방"
  | "기계"
  | "기타";

type DrawingIndexRecord = {
  drawingNo: string;
  title: string;
  category: DrawingCategory;
  complex: string | null;
  building: string | null;
  floor: string | null;
  scaleA1: string | null;
  scaleA3: string | null;
  sourceListPage: number;
  confidence: number;
  rawText?: string;
};

type ParseDrawingListPages = (pages: DrawingListFixturePage[]) => {
  drawings: DrawingIndexRecord[];
  warnings: string[];
};

const parserModulePath = "../src/drawingIndex/parseDrawingList.js";

async function loadParser(): Promise<ParseDrawingListPages> {
  const module = (await import(parserModulePath)) as {
    parseDrawingListPages: ParseDrawingListPages;
  };
  return module.parseDrawingListPages;
}

function completeRow(overrides: Partial<DrawingListFixtureRow> = {}): DrawingListFixtureRow {
  return {
    drawingNo: "E-401",
    title: "1단지 101동 지하2층 전력간선설비 평면도",
    scaleA1: "1/100",
    scaleA3: "1/200",
    row: 1,
    block: "upper",
    ...overrides,
  };
}

async function parseRows(...rows: DrawingListFixtureRow[]) {
  const parseDrawingListPages = await loadParser();
  return parseDrawingListPages([createDrawingListTextPage(1, rows)]);
}

describe("drawing-list parser drawing numbers and normalization", () => {
  it.each(["E-001", "E-154A", "E-454P", "MA-010", "MF-020"])(
    "accepts drawing number %s",
    async (drawingNo) => {
      const result = await parseRows(completeRow({ drawingNo }));

      expect(result.drawings).toHaveLength(1);
      expect(result.drawings[0].drawingNo).toBe(drawingNo);
    },
  );

  it("joins a split drawing prefix and number from the same coordinate row", async () => {
    const result = await parseRows(completeRow({ drawingNo: "E-401" }));

    expect(result.drawings[0].drawingNo).toBe("E-401");
  });

  it("normalizes NFKC drawing text before validation", async () => {
    const result = await parseRows(completeRow({ drawingNo: "Ｅ－４０１" }));

    expect(result.drawings[0].drawingNo).toBe("E-401");
  });

  it("removes NUL characters and collapses whitespace in titles", async () => {
    const result = await parseRows(
      completeRow({ title: "1단지\u0000   101동\n  지하2층   전력간선설비 평면도" }),
    );

    expect(result.drawings[0].title).toBe(
      "1단지 101동 지하2층 전력간선설비 평면도",
    );
  });
});

describe("drawing-list parser coordinate mapping", () => {
  it("reconstructs both table blocks without crossing their columns", async () => {
    const parseDrawingListPages = await loadParser();
    const result = parseDrawingListPages([createTwoPageDrawingListTextFixture()[0]]);

    expect(result.drawings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drawingNo: "E-154A",
          title: "1단지 101동 지하2층 전력간선설비 평면도",
          scaleA1: "1/100",
          scaleA3: "1/200",
        }),
        expect.objectContaining({
          drawingNo: "MA-010",
          title: "기계설비 상세도",
          scaleA1: "1/50",
          scaleA3: "1/100",
        }),
      ]),
    );
  });

  it("does not depend on PDF content stream order", async () => {
    const parseDrawingListPages = await loadParser();
    const page = createDrawingListTextPage(1, [completeRow()]);
    const forward = parseDrawingListPages([page]);
    const reversed = parseDrawingListPages([{ ...page, items: [...page.items].reverse() }]);

    expect(reversed).toEqual(forward);
  });

  it("maps scales to A1 and A3 without swapping them", async () => {
    const result = await parseRows(completeRow({ scaleA1: "1/125", scaleA3: "1/250" }));

    expect(result.drawings[0]).toMatchObject({ scaleA1: "1/125", scaleA3: "1/250" });
  });

  it("maps explicit NONE scales to null", async () => {
    const result = await parseRows(completeRow({ scaleA1: "NONE", scaleA3: "NONE" }));

    expect(result.drawings[0]).toMatchObject({ scaleA1: null, scaleA3: null });
  });

  it("keeps a missing scale nullable without inventing a value", async () => {
    const result = await parseRows(completeRow({ scaleA3: undefined }));

    expect(result.drawings[0]).toMatchObject({ scaleA1: "1/100", scaleA3: null });
  });
});

describe("drawing-list title metadata", () => {
  it("extracts complex and building identifiers", async () => {
    const result = await parseRows(completeRow());

    expect(result.drawings[0]).toMatchObject({ complex: "1단지", building: "101동" });
  });

  it.each([
    ["지하2층 전력간선설비 평면도", "지하2층"],
    ["기준(3~10)층 전등설비 평면도", "기준(3~10)층"],
    ["기준층 전등설비 평면도", "기준층"],
    ["옥탑지붕층 피뢰설비 평면도", "옥탑지붕층"],
    ["옥탑층 피뢰설비 평면도", "옥탑층"],
    ["지붕층 접지설비 평면도", "지붕층"],
    ["PIT층 전등설비 평면도", "PIT층"],
    ["12층 전열설비 평면도", "12층"],
  ])("extracts floor from %s", async (title, floor) => {
    const result = await parseRows(completeRow({ title }));

    expect(result.drawings[0].floor).toBe(floor);
  });

  it("does not guess metadata that is absent", async () => {
    const result = await parseRows(completeRow({ title: "옥외 전기설비 상세도" }));

    expect(result.drawings[0]).toMatchObject({ complex: null, building: null, floor: null });
  });
});

describe("drawing-list category classification", () => {
  it.each<[string, DrawingCategory]>([
    ["도면 목록표-1", "도면목록"],
    ["수변전설비 단선결선도", "수변전"],
    ["전력간선설비 평면도", "전력간선"],
    ["분전반 결선도", "분전반"],
    ["MCC 결선도", "MCC"],
    ["전등설비 평면도", "전등"],
    ["전열설비 평면도", "전열"],
    ["동력설비 평면도", "동력"],
    ["접지설비 평면도", "접지"],
    ["피뢰설비 평면도", "피뢰"],
    ["태양광 발전설비 평면도", "태양광"],
    ["보안등설비 평면도", "보안등"],
    ["조경등설비 평면도", "조경등"],
    ["소방설비 평면도", "소방"],
    ["기계설비 상세도", "기계"],
    ["세대 통신설비 참고도", "기타"],
  ])("classifies %s as %s", async (title, category) => {
    const result = await parseRows(completeRow({ title }));

    expect(result.drawings[0].category).toBe(category);
  });

  it.each<[string, DrawingCategory]>([
    ["MCC 분전반 동력 결선도", "MCC"],
    ["보안등 및 전등설비 평면도", "보안등"],
    ["피뢰 및 접지설비 평면도", "피뢰"],
  ])("uses category priority for %s and emits a warning", async (title, category) => {
    const result = await parseRows(completeRow({ title }));

    expect(result.drawings[0].category).toBe(category);
    expect(result.warnings.join("\n")).toMatch(/category|분류/i);
    expect(result.drawings[0].confidence).toBeLessThan(1);
  });
});

describe("drawing-list parser safety gates and diagnostics", () => {
  it("does not emit a drawing for a number without a title", async () => {
    const result = await parseRows(completeRow({ drawingNo: "E-777", title: "" }));

    expect(result.drawings.some((drawing) => drawing.drawingNo === "E-777")).toBe(false);
    expect(result.warnings.join("\n")).toMatch(/title|제목/i);
  });

  it("does not emit an orphan title without a drawing number", async () => {
    const parseDrawingListPages = await loadParser();
    const page = createDrawingListTextPage(1, [completeRow({ drawingNo: "E-778" })]);
    const orphanPage = {
      ...page,
      items: page.items.filter(
        (item) => !(item.transform[4] === 480 && [753, 747].includes(item.transform[5])),
      ),
    };
    const result = parseDrawingListPages([orphanPage]);

    expect(result.drawings).toHaveLength(0);
    expect(result.warnings.join("\n")).toMatch(/drawing|도면번호/i);
  });

  it("omits rows whose coordinate association is ambiguous", async () => {
    const result = await parseRows(
      completeRow({ drawingNo: "E-990", title: "모호한 제목 A", titleRowOffset: -5 }),
      completeRow({ drawingNo: "E-991", title: "모호한 제목 B", titleRowOffset: 5 }),
    );

    expect(result.drawings).toHaveLength(0);
    expect(result.warnings.join("\n")).toMatch(/ambiguous|모호/i);
  });

  it("keeps duplicate drawing numbers and reports the duplicate", async () => {
    const result = await parseRows(
      completeRow({ drawingNo: "E-001", title: "도면목록표-1", row: 1 }),
      completeRow({ drawingNo: "E-001", title: "도면목록표-2", row: 2 }),
    );

    expect(result.drawings.filter((drawing) => drawing.drawingNo === "E-001")).toHaveLength(2);
    expect(result.warnings.join("\n")).toMatch(/duplicate.*E-001|E-001.*중복/i);
  });

  it("only emits records that pass hard gates with bounded confidence", async () => {
    const result = await parseRows(completeRow(), completeRow({ title: "", row: 2 }));

    expect(result.drawings).toHaveLength(1);
    expect(result.drawings[0].confidence).toBeGreaterThanOrEqual(0.75);
    expect(result.drawings[0].confidence).toBeLessThanOrEqual(1);
  });

  it("sorts warnings deterministically regardless of input page order", async () => {
    const parseDrawingListPages = await loadParser();
    const pages = createTwoPageDrawingListTextFixture();

    const forward = parseDrawingListPages(pages);
    const reversed = parseDrawingListPages([...pages].reverse());

    expect(reversed.warnings).toEqual(forward.warnings);
    expect(parseDrawingListPages(pages).warnings).toEqual(forward.warnings);
  });

  it("returns partial results when one page is not a drawing-list table", async () => {
    const parseDrawingListPages = await loadParser();
    const validPage = createDrawingListTextPage(1, [completeRow()]);
    const invalidPage: DrawingListFixturePage = {
      page: 2,
      items: [
        {
          str: "일반 상세도 페이지",
          transform: [1, 0, 0, 1, 72, 720],
          width: 80,
          height: 8,
        },
      ],
    };
    const result = parseDrawingListPages([validPage, invalidPage]);

    expect(result.drawings).toHaveLength(1);
    expect(result.warnings.join("\n")).toMatch(/page.?2|2페이지/i);
  });

  it("fails when no page in the range contains a drawing-list table", async () => {
    const parseDrawingListPages = await loadParser();

    expect(() =>
      parseDrawingListPages([
        {
          page: 1,
          items: [
            {
              str: "일반 상세도",
              transform: [1, 0, 0, 1, 72, 720],
              width: 50,
              height: 8,
            },
          ],
        },
      ]),
    ).toThrow(/drawing list table|도면 목록표/i);
  });
});
