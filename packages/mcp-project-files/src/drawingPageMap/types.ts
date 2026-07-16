import type { DrawingIndexDocument, DrawingIndexRecord } from "../drawingIndex/types.js";

export type DrawingPageTextItem = {
  str: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
};

export type DrawingPageTextPage = {
  page: number;
  width: number;
  height: number;
  rotation: number;
  originX?: number;
  originY?: number;
  items: readonly DrawingPageTextItem[];
};

export type DrawingPageMapping = {
  drawingNo: string;
  drawingPage: number;
  detectedTitle: string | null;
  confidence: number;
  matchMethod: "title-block-coordinate";
  rawText?: string;
};

export type DrawingPageParseResult = {
  page: number;
  mapping: DrawingPageMapping | null;
  warnings: string[];
};

export type DrawingPageScanResult =
  | {
      page: number;
      status: "processed";
      mapping: DrawingPageMapping | null;
      warnings: string[];
    }
  | { page: number; status: "failed"; message: string };

export type DuplicatePageMatch = {
  drawingNo: string;
  pages: number[];
};

export type DrawingPageMapDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  indexPath: string;
  indexSourceSha256: string;
  startPage: number;
  endPage: number;
  scannedPageCount: number;
  indexedDrawingCount: number;
  mappingCount: number;
  unmatchedCount: number;
  coverageRatio: number;
  mappings: DrawingPageMapping[];
  unmatchedDrawingNumbers: string[];
  duplicatePageMatches: DuplicatePageMatch[];
  warnings: string[];
  relativePageMapPath?: string;
};

export type BuildDrawingPageMapInput = {
  index: DrawingIndexDocument;
  indexPath: string;
  source: string;
  sourceSha256: string;
  startPage: number;
  endPage: number;
  pageResults: readonly DrawingPageScanResult[];
};

export type DrawingPageCandidate = {
  drawing: DrawingIndexRecord;
  normalizedX: number;
  titleSimilarity: number;
  titleExact: boolean;
  zoneStrength: number;
  rawText: string;
};

export type LoadedDrawingPageMap = DrawingPageMapDocument;
