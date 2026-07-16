import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import type { DrawingCategory } from "../drawingIndex/types.js";
import { loadDrawingPageMap } from "../drawingPageMap/loadDrawingPageMap.js";
import { loadDrawingIndex } from "../drawingSearch/loadDrawingIndex.js";
import { searchDrawingIndex } from "../drawingSearch/searchDrawingIndex.js";
import type {
  DrawingSearchFilters,
  DrawingSearchInput,
  DrawingSearchResult,
} from "../drawingSearch/types.js";

const DRAWING_CATEGORIES = [
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
] as const satisfies readonly DrawingCategory[];
const INPUT_FIELDS = new Set(["indexPath", "pageMapPath", "query", "limit", "filters"]);
const FILTER_FIELDS = new Set(["category", "complex", "building", "floor", "drawingNo"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`${label} contains unsupported input field: ${unknown}`);
}

function assertRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function validateFilters(value: unknown): DrawingSearchFilters | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("filters must be an object");
  assertNoUnknownFields(value, FILTER_FIELDS, "filters");

  const filters: DrawingSearchFilters = {};
  if (value.category !== undefined) {
    if (
      typeof value.category !== "string" ||
      !DRAWING_CATEGORIES.includes(value.category as DrawingCategory)
    ) {
      throw new Error("filters.category is invalid");
    }
    filters.category = value.category as DrawingCategory;
  }
  for (const field of ["complex", "building", "floor", "drawingNo"] as const) {
    if (value[field] !== undefined) {
      filters[field] = assertRequiredString(value[field], `filters.${field}`);
    }
  }
  return filters;
}

function validateInput(input: unknown): DrawingSearchInput {
  if (!isRecord(input)) throw new Error("indexPath and query are required");
  assertNoUnknownFields(input, INPUT_FIELDS, "search_drawings input");
  const indexPath = assertRequiredString(input.indexPath, "indexPath");
  const pageMapPath =
    input.pageMapPath === undefined
      ? undefined
      : assertRequiredString(input.pageMapPath, "pageMapPath");
  const query = assertRequiredString(input.query, "query");
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 100)
  ) {
    throw new Error("limit must be an integer between 1 and 100");
  }

  return {
    indexPath,
    ...(pageMapPath === undefined ? {} : { pageMapPath }),
    query,
    ...(input.limit === undefined ? {} : { limit: input.limit as number }),
    ...(input.filters === undefined ? {} : { filters: validateFilters(input.filters) }),
  };
}

export async function searchDrawings(
  projectRoot: string | undefined,
  input: unknown,
): Promise<DrawingSearchResult> {
  const { indexPath, pageMapPath, query, limit, filters } = validateInput(input);
  const document = loadDrawingIndex(projectRoot, indexPath);
  const result = searchDrawingIndex(document, { query, limit, filters });
  if (pageMapPath === undefined) return result;

  const pageMap = loadDrawingPageMap(projectRoot, pageMapPath);
  const normalizePath = (value: string) => value.normalize("NFKC").replaceAll("\\", "/");
  if (
    pageMap.sourceSha256 !== document.sourceSha256 ||
    pageMap.indexSourceSha256 !== document.sourceSha256
  ) {
    throw new Error("Drawing page map source SHA-256 mismatch");
  }
  if (normalizePath(pageMap.source) !== normalizePath(document.source)) {
    throw new Error("Drawing page map source mismatch");
  }
  if (normalizePath(pageMap.indexPath) !== normalizePath(indexPath)) {
    throw new Error("Drawing page map indexPath mismatch");
  }

  const mappings = new Map<string, typeof pageMap.mappings>();
  for (const mapping of pageMap.mappings) {
    const values = mappings.get(mapping.drawingNo) ?? [];
    values.push(mapping);
    mappings.set(mapping.drawingNo, values);
  }
  const duplicateWarnings: string[] = [];
  const results = result.results.map((match) => {
    const matches = mappings.get(match.drawingNo) ?? [];
    if (matches.length === 1) {
      return {
        ...match,
        drawingPage: matches[0]!.drawingPage,
        pageMatchConfidence: matches[0]!.confidence,
        pageMatchMethod: matches[0]!.matchMethod,
      };
    }
    if (matches.length > 1) {
      duplicateWarnings.push(`duplicate drawing ${match.drawingNo} has multiple page mappings`);
    }
    return {
      ...match,
      drawingPage: null,
      pageMatchConfidence: null,
      pageMatchMethod: null,
    };
  });
  return {
    ...result,
    results,
    warnings: [...result.warnings, ...duplicateWarnings.sort()],
  };
}

export function createSearchDrawingsTool(): VoltAiTool<DrawingSearchResult> {
  return {
    name: "search_drawings",
    description:
      "Search a saved drawing-list schema v1 index with deterministic lexical matching and no typo correction.",
    inputSchema: {
      indexPath: z.string().min(1),
      pageMapPath: z.string().min(1).optional(),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      filters: z
        .object({
          category: z.enum(DRAWING_CATEGORIES).optional(),
          complex: z.string().min(1).optional(),
          building: z.string().min(1).optional(),
          floor: z.string().min(1).optional(),
          drawingNo: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    },
    handler: async (input) => searchDrawings(process.env.PROJECT_ROOT, input),
  };
}
