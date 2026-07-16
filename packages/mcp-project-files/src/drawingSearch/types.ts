import type { DrawingCategory, DrawingIndexRecord } from "../drawingIndex/types.js";

export type DrawingSearchFilters = {
  category?: DrawingCategory;
  complex?: string;
  building?: string;
  floor?: string;
  drawingNo?: string;
};

export type DrawingSearchOptions = {
  query: string;
  limit?: number;
  filters?: DrawingSearchFilters;
};

export type DrawingSearchInput = DrawingSearchOptions & {
  indexPath: string;
  pageMapPath?: string;
};

export type DrawingSearchMatch = Omit<DrawingIndexRecord, "rawText"> & {
  score: number;
  matchedFields: string[];
  matchReasons: string[];
  drawingPage?: number | null;
  pageMatchConfidence?: number | null;
  pageMatchMethod?: "title-block-coordinate" | null;
};

export type DrawingSearchResult = {
  query: string;
  normalizedQuery: string;
  resultCount: number;
  totalCandidates: number;
  results: DrawingSearchMatch[];
  warnings: string[];
};

export type DrawingQueryUnitKind =
  | "drawingNo"
  | "complex"
  | "building"
  | "floor"
  | "category"
  | "text";

export type DrawingQueryUnit = {
  canonical: string;
  alternatives: string[];
  kind: DrawingQueryUnitKind;
};

export type NormalizedDrawingQuery = {
  normalizedQuery: string;
  units: DrawingQueryUnit[];
};

export type DrawingMatchDiagnostic = {
  field: "drawingNo" | "title" | "category" | "complex" | "building" | "floor";
  reason: string;
  strength: number;
  direct: boolean;
  metadataExact: boolean;
};
