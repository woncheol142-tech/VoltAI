import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { extname, isAbsolute, join } from "node:path";

import type {
  DrawingCategory,
  DrawingIndexDocument,
  DrawingIndexRecord,
} from "../drawingIndex/types.js";
import {
  assertProjectRoot,
  isWithinProjectRoot,
} from "../projectPath.js";

const MAX_INDEX_BYTES = 10 * 1024 * 1024;
const DRAWING_NUMBER_PATTERN = /^[A-Z]{1,4}-\d{2,4}[A-Z]?$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "source",
  "sourceSha256",
  "startPage",
  "endPage",
  "drawingCount",
  "drawings",
  "warnings",
  "relativeIndexPath",
]);
const RECORD_FIELDS = new Set([
  "drawingNo",
  "title",
  "category",
  "complex",
  "building",
  "floor",
  "scaleA1",
  "scaleA3",
  "sourceListPage",
  "confidence",
  "rawText",
]);
const DRAWING_CATEGORIES: ReadonlySet<DrawingCategory> = new Set([
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
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) {
    throw new Error(`${label} contains unknown field: ${unknown}`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertNullableString(value: unknown, field: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function validateDrawing(value: unknown, index: number): DrawingIndexRecord {
  if (!isRecord(value)) {
    throw new Error(`drawings[${index}] must be an object`);
  }
  assertKnownFields(value, RECORD_FIELDS, `drawings[${index}]`);
  assertNonEmptyString(value.drawingNo, `drawings[${index}].drawingNo`);
  if (!DRAWING_NUMBER_PATTERN.test(value.drawingNo)) {
    throw new Error(`drawings[${index}].drawingNo is invalid`);
  }
  assertNonEmptyString(value.title, `drawings[${index}].title`);
  if (typeof value.category !== "string" || !DRAWING_CATEGORIES.has(value.category as DrawingCategory)) {
    throw new Error(`drawings[${index}].category is invalid`);
  }
  assertNullableString(value.complex, `drawings[${index}].complex`);
  assertNullableString(value.building, `drawings[${index}].building`);
  assertNullableString(value.floor, `drawings[${index}].floor`);
  assertNullableString(value.scaleA1, `drawings[${index}].scaleA1`);
  assertNullableString(value.scaleA3, `drawings[${index}].scaleA3`);
  assertPositiveInteger(value.sourceListPage, `drawings[${index}].sourceListPage`);
  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error(`drawings[${index}].confidence must be between 0 and 1`);
  }
  if (value.rawText !== undefined && typeof value.rawText !== "string") {
    throw new Error(`drawings[${index}].rawText must be a string`);
  }

  return {
    drawingNo: value.drawingNo,
    title: value.title,
    category: value.category as DrawingCategory,
    complex: value.complex,
    building: value.building,
    floor: value.floor,
    scaleA1: value.scaleA1,
    scaleA3: value.scaleA3,
    sourceListPage: value.sourceListPage,
    confidence: value.confidence,
    ...(value.rawText === undefined ? {} : { rawText: value.rawText }),
  };
}

function validateDocument(value: unknown): DrawingIndexDocument {
  if (!isRecord(value)) {
    throw new Error("Drawing index must be a JSON object");
  }
  assertKnownFields(value, TOP_LEVEL_FIELDS, "Drawing index");
  if (value.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }
  assertNonEmptyString(value.source, "source");
  if (typeof value.sourceSha256 !== "string" || !SHA256_PATTERN.test(value.sourceSha256)) {
    throw new Error("sourceSha256 must be a lowercase 64-character SHA-256 value");
  }
  assertPositiveInteger(value.startPage, "startPage");
  assertPositiveInteger(value.endPage, "endPage");
  if (value.endPage < value.startPage) {
    throw new Error("endPage must be greater than or equal to startPage");
  }
  if (!Array.isArray(value.drawings)) {
    throw new Error("drawings must be an array");
  }
  if (!Number.isInteger(value.drawingCount) || value.drawingCount !== value.drawings.length) {
    throw new Error("drawingCount must equal drawings.length");
  }
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("warnings must be an array of strings");
  }
  if (value.relativeIndexPath !== undefined && typeof value.relativeIndexPath !== "string") {
    throw new Error("relativeIndexPath must be a string");
  }

  return {
    schemaVersion: 1,
    source: value.source,
    sourceSha256: value.sourceSha256,
    startPage: value.startPage,
    endPage: value.endPage,
    drawingCount: value.drawingCount,
    drawings: value.drawings.map(validateDrawing),
    warnings: [...value.warnings],
    ...(value.relativeIndexPath === undefined
      ? {}
      : { relativeIndexPath: value.relativeIndexPath }),
  };
}

function resolveSecureIndexPath(projectRoot: string, indexPath: string): string {
  if (typeof indexPath !== "string" || indexPath.length === 0) {
    throw new Error("indexPath is required");
  }
  if (isAbsolute(indexPath) || indexPath.includes("\\")) {
    throw new Error("indexPath must be a PROJECT_ROOT-relative POSIX path");
  }

  const parts = indexPath.split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== ".volt-ai" ||
    parts[1] !== "indexes" ||
    !parts[2] ||
    parts[2].startsWith(".") ||
    parts.includes("..") ||
    extname(parts[2]).toLowerCase() !== ".json"
  ) {
    throw new Error("indexPath must be .volt-ai/indexes/<non-hidden-file>.json without nesting");
  }

  let current = projectRoot;
  for (const part of parts) {
    current = join(current, part);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      throw new Error("Drawing index file does not exist");
    }
    if (stats.isSymbolicLink()) {
      throw new Error("Drawing index path cannot include a symbolic link");
    }
  }

  const targetStats = lstatSync(current);
  if (!targetStats.isFile()) {
    throw new Error("Drawing index path must reference a regular file");
  }
  const realTarget = realpathSync(current);
  if (!isWithinProjectRoot(projectRoot, realTarget)) {
    throw new Error("Drawing index path must stay within PROJECT_ROOT");
  }

  return current;
}

export function loadDrawingIndex(
  projectRoot: string | undefined,
  indexPath: string,
): DrawingIndexDocument {
  const root = assertProjectRoot(projectRoot);
  const absolutePath = resolveSecureIndexPath(root, indexPath);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const descriptor = openSync(absolutePath, constants.O_RDONLY | noFollow);

  let content: string;
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new Error("Drawing index path must reference a regular file");
    }
    if (stats.size > MAX_INDEX_BYTES) {
      throw new Error("Drawing index exceeds the 10 MiB size limit");
    }
    content = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Drawing index contains malformed JSON");
  }
  return validateDocument(parsed);
}
