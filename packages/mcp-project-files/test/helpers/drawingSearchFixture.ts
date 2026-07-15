import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  DrawingCategory,
  DrawingIndexDocument,
  DrawingIndexRecord,
} from "../../src/drawingIndex/types.js";

type RecordOverrides = Partial<DrawingIndexRecord> & Pick<DrawingIndexRecord, "drawingNo" | "title">;

const sha256 = "a".repeat(64);

function drawing(overrides: RecordOverrides): DrawingIndexRecord {
  return {
    drawingNo: overrides.drawingNo,
    title: overrides.title,
    category: overrides.category ?? "기타",
    complex: overrides.complex ?? null,
    building: overrides.building ?? null,
    floor: overrides.floor ?? null,
    scaleA1: overrides.scaleA1 ?? "1/100",
    scaleA3: overrides.scaleA3 ?? "1/200",
    sourceListPage: overrides.sourceListPage ?? 2,
    confidence: overrides.confidence ?? 1,
    ...(overrides.rawText === undefined ? {} : { rawText: overrides.rawText }),
  };
}

export function createDrawingSearchRecords(): DrawingIndexRecord[] {
  const core = [
    drawing({
      drawingNo: "E-401",
      title: "1단지 101동 지하2층 전력간선설비 평면도",
      category: "전력간선",
      complex: "1단지",
      building: "101동",
      floor: "지하2층",
      confidence: 0.76,
      sourceListPage: 4,
    }),
    drawing({
      drawingNo: "E-400",
      title: "1단지 101동 지하1층 전력간선설비 평면도",
      category: "전력간선",
      complex: "1단지",
      building: "101동",
      floor: "지하1층",
      sourceListPage: 4,
    }),
    drawing({
      drawingNo: "E-402",
      title: "1단지 101동 1층 전력간선설비 평면도",
      category: "전력간선",
      complex: "1단지",
      building: "101동",
      floor: "1층",
      sourceListPage: 4,
    }),
    drawing({
      drawingNo: "E-399",
      title: "1단지 101동 전력간선설비 참고도",
      category: "전력간선",
      sourceListPage: 4,
    }),
    drawing({
      drawingNo: "E-501",
      title: "2단지 201동 1층 피뢰설비 평면도",
      category: "피뢰",
      complex: "2단지",
      building: "201동",
      floor: "1층",
      sourceListPage: 5,
    }),
    drawing({
      drawingNo: "E-502",
      title: "2단지 201동 2층 피뢰 및 접지설비 평면도",
      category: "피뢰",
      complex: "2단지",
      building: "201동",
      floor: "2층",
      sourceListPage: 5,
      confidence: 0.9,
    }),
    drawing({
      drawingNo: "E-158",
      title: "1단지 분전반 결선도-1",
      category: "분전반",
      complex: "1단지",
      scaleA1: null,
      scaleA3: null,
      sourceListPage: 2,
    }),
    drawing({
      drawingNo: "E-159",
      title: "분전함 시험도",
      category: "기타",
      sourceListPage: 2,
    }),
    drawing({
      drawingNo: "E-160",
      title: "분전함 시험도 상세",
      category: "기타",
      sourceListPage: 2,
    }),
    drawing({
      drawingNo: "E-111",
      title: "1단지 22.9kV 수변전설비 단선결선도",
      category: "수변전",
      complex: "1단지",
      scaleA1: null,
      scaleA3: null,
      sourceListPage: 2,
    }),
    drawing({
      drawingNo: "E-112",
      title: "2단지 22.9kV 수변전설비 단선결선도",
      category: "수변전",
      complex: "2단지",
      scaleA1: null,
      scaleA3: null,
      sourceListPage: 2,
    }),
    drawing({
      drawingNo: "E-410",
      title: "1단지 101동 옥탑층 전등설비 평면도",
      category: "전등",
      complex: "1단지",
      building: "101동",
      floor: "옥탑층",
      sourceListPage: 4,
    }),
    drawing({
      drawingNo: "E-411",
      title: "1단지 101동 옥탑지붕층 전등설비 평면도",
      category: "전등",
      complex: "1단지",
      building: "101동",
      floor: "옥탑지붕층",
      sourceListPage: 4,
    }),
    drawing({
      drawingNo: "E-237",
      title: "129m2 A형 단위세대 전열설비 평면도",
      category: "전열",
      sourceListPage: 3,
    }),
    drawing({
      drawingNo: "E-1203",
      title: "22.9kV 인입장주도",
      category: "기타",
      scaleA1: null,
      scaleA3: null,
      sourceListPage: 9,
      confidence: 0.95,
    }),
    drawing({
      drawingNo: "E-699",
      title: "2단지 201동 옥외 전등설비 평면도",
      category: "전등",
      complex: "2단지",
      building: "201동",
      sourceListPage: 7,
    }),
    drawing({
      drawingNo: "E-700",
      title: "2단지 202동 옥외 전등설비 평면도",
      category: "전등",
      complex: "2단지",
      building: "202동",
      sourceListPage: 7,
    }),
    drawing({
      drawingNo: "MA-010",
      title: "기계 장비일람표",
      category: "기계",
      sourceListPage: 2,
    }),
  ];
  const generalLighting = Array.from({ length: 25 }, (_, index) =>
    drawing({
      drawingNo: `E-${String(800 + index).padStart(3, "0")}`,
      title: `공용부 전등설비 상세도-${index + 1}`,
      category: "전등",
      sourceListPage: 8,
    }),
  );

  return [...core, ...generalLighting];
}

export function createDrawingSearchDocument(
  overrides: Partial<DrawingIndexDocument> = {},
): DrawingIndexDocument {
  const drawings = overrides.drawings ?? createDrawingSearchRecords();

  return {
    schemaVersion: 1,
    source: "docs/drawing-list.pdf",
    sourceSha256: sha256,
    startPage: 2,
    endPage: 9,
    drawingCount: drawings.length,
    drawings,
    warnings: ["fixture indexing warning one", "fixture indexing warning two"],
    ...overrides,
  };
}

export function writeDrawingSearchIndex(
  projectRoot: string,
  document: DrawingIndexDocument = createDrawingSearchDocument(),
  indexPath = ".volt-ai/indexes/drawing-index.json",
): string {
  const absolutePath = join(projectRoot, ...indexPath.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return absolutePath;
}

export const drawingCategories: readonly DrawingCategory[] = [
  "도면목록",
  "수변전",
  "전력간선",
  "분전반",
  "MCC",
  "전등",
  "전열",
  "동력",
  "접지",
  "피뢰",
  "태양광",
  "보안등",
  "조경등",
  "소방",
  "기계",
  "기타",
];
