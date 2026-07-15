import type {
  DrawingCategory,
  DrawingIndexDocument,
  DrawingIndexRecord,
} from "../drawingIndex/types.js";
import {
  canonicalDrawingNumber,
  normalizeDrawingQuery,
  normalizeDrawingSearchText,
} from "./normalizeDrawingQuery.js";
import type {
  DrawingMatchDiagnostic,
  DrawingQueryUnit,
  DrawingSearchFilters,
  DrawingSearchMatch,
  DrawingSearchOptions,
  DrawingSearchResult,
} from "./types.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const FIELD_ORDER = ["drawingNo", "title", "category", "complex", "building", "floor"];
const CATEGORIES: ReadonlySet<DrawingCategory> = new Set([
  "도면목록", "수변전", "전력간선", "분전반", "MCC", "전등", "전열", "동력",
  "접지", "피뢰", "태양광", "보안등", "조경등", "소방", "기계", "기타",
]);

type RankedDrawing = DrawingSearchMatch & {
  directMatchCount: number;
  metadataExactCount: number;
};

function codepointCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function drawingNumberCompare(left: string, right: string): number {
  const pattern = /^([A-Z]{1,4})-(\d{2,4})([A-Z]?)$/u;
  const leftMatch = pattern.exec(left);
  const rightMatch = pattern.exec(right);
  if (!leftMatch || !rightMatch) return codepointCompare(left, right);
  const prefix = codepointCompare(leftMatch[1], rightMatch[1]);
  if (prefix !== 0) return prefix;
  const number = Number(leftMatch[2]) - Number(rightMatch[2]);
  if (number !== 0) return number;
  const width = leftMatch[2].length - rightMatch[2].length;
  if (width !== 0) return width;
  return codepointCompare(leftMatch[3], rightMatch[3]);
}

function normalizedRecord(record: DrawingIndexRecord) {
  return {
    title: normalizeDrawingSearchText(record.title),
    category: normalizeDrawingSearchText(record.category),
    complex: record.complex === null ? null : normalizeDrawingSearchText(record.complex),
    building: record.building === null ? null : normalizeDrawingSearchText(record.building),
    floor: record.floor === null ? null : normalizeDrawingSearchText(record.floor),
    drawingNo: canonicalDrawingNumber(record.drawingNo) ?? record.drawingNo,
  };
}

function titleStructuralValues(title: string, kind: "complex" | "building" | "floor"): string[] {
  const pattern = kind === "complex"
    ? /\d+단지/gu
    : kind === "building"
      ? /(?<!\d)\d{3}동/gu
      : /지하\d+층|기준(?:\(\d+~\d+\))?층|옥탑지붕층|옥탑층|지붕층|pit층|(?<![\d]|지하)\d+층/giu;
  return title.match(pattern) ?? [];
}

function structuralMatch(
  unit: DrawingQueryUnit,
  record: ReturnType<typeof normalizedRecord>,
): DrawingMatchDiagnostic | null {
  const field = unit.kind as "complex" | "building" | "floor";
  const value = record[field];
  const generalizedBasement = unit.canonical === "지하층";
  const alternatives = unit.alternatives.map(normalizeDrawingSearchText);

  if (value !== null) {
    if (generalizedBasement && value.startsWith("지하")) {
      return {
        field: "floor",
        reason: `floor generalized match: 지하층 → ${value}`,
        strength: 0.66,
        direct: false,
        metadataExact: false,
      };
    }
    const index = alternatives.indexOf(value);
    if (index >= 0) {
      const direct = value === unit.canonical;
      return {
        field,
        reason: direct
          ? `${field} exact match: ${value}`
          : `${field} generalized match: ${unit.canonical} → ${value}`,
        strength: direct ? 0.92 : 0.72,
        direct,
        metadataExact: direct,
      };
    }
    return null;
  }

  const titleValues = titleStructuralValues(record.title, field);
  const titleValue = titleValues.find((candidate) =>
    generalizedBasement ? candidate.startsWith("지하") : alternatives.includes(candidate),
  );
  if (!titleValue) return null;
  return {
    field: "title",
    reason: `${field} title match: ${unit.canonical} → ${titleValue}`,
    strength: generalizedBasement ? 0.52 : 0.62,
    direct: false,
    metadataExact: false,
  };
}

function categoryOrTextMatch(
  unit: DrawingQueryUnit,
  record: ReturnType<typeof normalizedRecord>,
): DrawingMatchDiagnostic | null {
  const alternatives = unit.alternatives.map(normalizeDrawingSearchText);
  let best: DrawingMatchDiagnostic | null = null;

  for (let index = 0; index < alternatives.length; index += 1) {
    const alternative = alternatives[index];
    const direct = index === 0;
    const categoryMatch = record.category === alternative;
    const shadowedByLongerSynonym =
      direct &&
      alternatives.slice(1).some(
        (synonym) => synonym.includes(alternative) && record.title.includes(synonym),
      );
    const titleMatch = !shadowedByLongerSynonym && record.title.includes(alternative);
    let candidate: DrawingMatchDiagnostic | null = null;

    if (categoryMatch) {
      candidate = {
        field: "category",
        reason: direct
          ? `category direct match: ${unit.canonical}`
          : `category synonym match: ${unit.canonical} → ${alternative}`,
        strength: direct ? 0.88 : 0.64,
        direct,
        metadataExact: false,
      };
    } else if (titleMatch) {
      candidate = {
        field: "title",
        reason: direct
          ? `title match: ${unit.canonical}`
          : `title synonym match: ${unit.canonical} → ${alternative}`,
        strength: direct ? 0.78 : 0.58,
        direct,
        metadataExact: false,
      };
    }

    if (candidate && (!best || candidate.strength > best.strength)) best = candidate;
  }
  return best;
}

function matchUnit(
  unit: DrawingQueryUnit,
  record: ReturnType<typeof normalizedRecord>,
): DrawingMatchDiagnostic | null {
  if (unit.kind === "drawingNo") {
    return record.drawingNo === unit.canonical
      ? {
          field: "drawingNo",
          reason: `drawing number exact match: ${unit.canonical}`,
          strength: 1,
          direct: true,
          metadataExact: true,
        }
      : null;
  }
  if (unit.kind === "complex" || unit.kind === "building" || unit.kind === "floor") {
    return structuralMatch(unit, record);
  }
  return categoryOrTextMatch(unit, record);
}

function normalizeFilterValue(value: string): string {
  return normalizeDrawingSearchText(value);
}

function validateFilters(filters: DrawingSearchFilters | undefined): DrawingSearchFilters {
  if (!filters) return {};
  if (filters.category !== undefined && !CATEGORIES.has(filters.category)) {
    throw new Error("filters.category is invalid");
  }
  return { ...filters };
}

function passesFilters(record: DrawingIndexRecord, filters: DrawingSearchFilters): boolean {
  const normalized = normalizedRecord(record);
  if (filters.category !== undefined && record.category !== filters.category) return false;
  if (filters.complex !== undefined && normalized.complex !== normalizeFilterValue(filters.complex)) {
    return false;
  }
  if (filters.building !== undefined && normalized.building !== normalizeFilterValue(filters.building)) {
    return false;
  }
  if (filters.floor !== undefined && normalized.floor !== normalizeFilterValue(filters.floor)) {
    return false;
  }
  if (filters.drawingNo !== undefined) {
    const expected = canonicalDrawingNumber(filters.drawingNo);
    if (!expected || normalized.drawingNo !== expected) return false;
  }
  return true;
}

function scoreRecord(
  record: DrawingIndexRecord,
  units: DrawingQueryUnit[],
  normalizedQuery: string,
): RankedDrawing | null {
  const normalized = normalizedRecord(record);
  const diagnostics: DrawingMatchDiagnostic[] = [];
  for (const unit of units) {
    const diagnostic = matchUnit(unit, normalized);
    if (!diagnostic) return null;
    diagnostics.push(diagnostic);
  }

  let score = diagnostics.reduce((sum, diagnostic) => sum + diagnostic.strength, 0) /
    diagnostics.length;
  if (units.length === 1 && units[0].kind === "drawingNo") score = 1;
  else if (normalized.title === normalizedQuery) score = Math.max(score, 0.96);
  score = Math.round(Math.min(1, Math.max(0, score)) * 10_000) / 10_000;

  const fields = new Set(diagnostics.map((diagnostic) => diagnostic.field));
  const reasons = new Set(diagnostics.map((diagnostic) => diagnostic.reason));
  const { rawText: _rawText, ...publicRecord } = record;
  void _rawText;

  return {
    ...publicRecord,
    score,
    matchedFields: [...fields].sort(
      (left, right) => FIELD_ORDER.indexOf(left) - FIELD_ORDER.indexOf(right),
    ),
    matchReasons: [...reasons],
    directMatchCount: diagnostics.filter((diagnostic) => diagnostic.direct).length,
    metadataExactCount: diagnostics.filter((diagnostic) => diagnostic.metadataExact).length,
  };
}

function compareRanked(left: RankedDrawing, right: RankedDrawing): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.directMatchCount !== right.directMatchCount) {
    return right.directMatchCount - left.directMatchCount;
  }
  if (left.metadataExactCount !== right.metadataExactCount) {
    return right.metadataExactCount - left.metadataExactCount;
  }
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  if (left.sourceListPage !== right.sourceListPage) {
    return left.sourceListPage - right.sourceListPage;
  }
  const drawingNumber = drawingNumberCompare(left.drawingNo, right.drawingNo);
  if (drawingNumber !== 0) return drawingNumber;
  const title = codepointCompare(left.title, right.title);
  if (title !== 0) return title;
  for (const field of ["category", "complex", "building", "floor", "scaleA1", "scaleA3"] as const) {
    const value = codepointCompare(left[field] ?? "", right[field] ?? "");
    if (value !== 0) return value;
  }
  return 0;
}

export function searchDrawingIndex(
  document: DrawingIndexDocument,
  options: DrawingSearchOptions,
): DrawingSearchResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  const filters = validateFilters(options.filters);
  const normalized = normalizeDrawingQuery(options.query);
  const ranked = document.drawings
    .filter((record) => passesFilters(record, filters))
    .map((record) => scoreRecord(record, normalized.units, normalized.normalizedQuery))
    .filter((record): record is RankedDrawing => record !== null)
    .sort(compareRanked);
  const totalCandidates = ranked.length;
  const results = ranked.slice(0, limit).map(({ directMatchCount, metadataExactCount, ...record }) => {
    void directMatchCount;
    void metadataExactCount;
    return record;
  });
  const warnings: string[] = [];
  if (document.warnings.length > 0) {
    warnings.push(`drawing index contains ${document.warnings.length} indexing warnings`);
  }
  if (totalCandidates > limit) {
    warnings.push(`results truncated: showing ${limit} of ${totalCandidates} matches`);
  }
  if (totalCandidates === 0) warnings.push("lexical search did not find a match");

  return {
    query: options.query,
    normalizedQuery: normalized.normalizedQuery,
    resultCount: results.length,
    totalCandidates,
    results,
    warnings,
  };
}
