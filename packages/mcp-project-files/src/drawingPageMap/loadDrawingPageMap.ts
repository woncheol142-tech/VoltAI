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

import { assertProjectRoot, isWithinProjectRoot } from "../projectPath.js";
import type {
  DrawingPageMapDocument,
  DrawingPageMapping,
  DuplicatePageMatch,
} from "./types.js";

const MAX_PAGE_MAP_BYTES = 10 * 1024 * 1024;
const DRAWING_NUMBER_PATTERN = /^[A-Z]{1,4}-\d{2,4}[A-Z]?$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DOCUMENT_FIELDS = new Set([
  "schemaVersion", "source", "sourceSha256", "indexPath", "indexSourceSha256",
  "startPage", "endPage", "scannedPageCount", "indexedDrawingCount", "mappingCount",
  "unmatchedCount", "coverageRatio", "mappings", "unmatchedDrawingNumbers",
  "duplicatePageMatches", "warnings", "relativePageMapPath",
]);
const MAPPING_FIELDS = new Set([
  "drawingNo", "drawingPage", "detectedTitle", "confidence", "matchMethod", "rawText",
]);
const DUPLICATE_FIELDS = new Set(["drawingNo", "pages"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFields(value: Record<string, unknown>, fields: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find((field) => !fields.has(field));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}

function nonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function positiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function validateMapping(
  value: unknown,
  index: number,
  startPage: number,
  endPage: number,
): DrawingPageMapping {
  if (!isRecord(value)) throw new Error(`mappings[${index}] must be an object`);
  assertFields(value, MAPPING_FIELDS, `mappings[${index}]`);
  nonEmptyString(value.drawingNo, `mappings[${index}].drawingNo`);
  if (!DRAWING_NUMBER_PATTERN.test(value.drawingNo)) {
    throw new Error(`mappings[${index}].drawingNo is invalid`);
  }
  if (!Number.isInteger(value.drawingPage)) {
    throw new Error(`mappings[${index}].drawingPage must be an integer`);
  }
  if ((value.drawingPage as number) < startPage || (value.drawingPage as number) > endPage) {
    throw new Error(`mappings[${index}].drawingPage is outside the page-map range`);
  }
  if (value.detectedTitle !== null && typeof value.detectedTitle !== "string") {
    throw new Error(`mappings[${index}].detectedTitle must be a string or null`);
  }
  if (
    typeof value.confidence !== "number" || !Number.isFinite(value.confidence) ||
    value.confidence < 0 || value.confidence > 1
  ) {
    throw new Error(`mappings[${index}].confidence must be between 0 and 1`);
  }
  if (value.matchMethod !== "title-block-coordinate") {
    throw new Error(`mappings[${index}].matchMethod is invalid`);
  }
  if (value.rawText !== undefined && typeof value.rawText !== "string") {
    throw new Error(`mappings[${index}].rawText must be a string`);
  }
  return {
    drawingNo: value.drawingNo,
    drawingPage: value.drawingPage as number,
    detectedTitle: value.detectedTitle as string | null,
    confidence: value.confidence,
    matchMethod: "title-block-coordinate",
    ...(value.rawText === undefined ? {} : { rawText: value.rawText }),
  };
}

function validateDuplicate(
  value: unknown,
  index: number,
  startPage: number,
  endPage: number,
): DuplicatePageMatch {
  if (!isRecord(value)) throw new Error(`duplicatePageMatches[${index}] must be an object`);
  assertFields(value, DUPLICATE_FIELDS, `duplicatePageMatches[${index}]`);
  nonEmptyString(value.drawingNo, `duplicatePageMatches[${index}].drawingNo`);
  if (!DRAWING_NUMBER_PATTERN.test(value.drawingNo)) {
    throw new Error(`duplicatePageMatches[${index}].drawingNo is invalid`);
  }
  if (!Array.isArray(value.pages) || value.pages.length < 2) {
    throw new Error(`duplicatePageMatches[${index}].pages must contain at least two pages`);
  }
  if (value.pages.some((page) => !Number.isInteger(page) || page < 1)) {
    throw new Error(`duplicatePageMatches[${index}].pages must contain positive integers`);
  }
  if (value.pages.some((page) => page < startPage || page > endPage)) {
    throw new Error(`duplicatePageMatches[${index}].pages are outside the page-map range`);
  }
  for (let item = 1; item < value.pages.length; item += 1) {
    if (value.pages[item]! < value.pages[item - 1]!) {
      throw new Error(`duplicatePageMatches[${index}].pages must be sorted ascending`);
    }
    if (value.pages[item] === value.pages[item - 1]) {
      throw new Error(`duplicatePageMatches[${index}].pages must be unique`);
    }
  }
  return { drawingNo: value.drawingNo, pages: [...value.pages] as number[] };
}

function validateDocument(value: unknown): DrawingPageMapDocument {
  if (!isRecord(value)) throw new Error("Drawing page map must be a JSON object");
  assertFields(value, DOCUMENT_FIELDS, "Drawing page map");
  if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  nonEmptyString(value.source, "source");
  nonEmptyString(value.indexPath, "indexPath");
  if (typeof value.sourceSha256 !== "string" || !SHA256_PATTERN.test(value.sourceSha256)) {
    throw new Error("sourceSha256 must be a lowercase 64-character SHA-256 value");
  }
  if (typeof value.indexSourceSha256 !== "string" || !SHA256_PATTERN.test(value.indexSourceSha256)) {
    throw new Error("indexSourceSha256 must be a lowercase 64-character SHA-256 value");
  }
  positiveInteger(value.startPage, "startPage");
  positiveInteger(value.endPage, "endPage");
  if (value.endPage < value.startPage) throw new Error("endPage must be at least startPage");
  if (value.scannedPageCount !== value.endPage - value.startPage + 1) {
    throw new Error("scannedPageCount must match the page range");
  }
  positiveInteger(value.indexedDrawingCount, "indexedDrawingCount");
  if (!Array.isArray(value.mappings)) throw new Error("mappings must be an array");
  if (value.mappingCount !== value.mappings.length) {
    throw new Error("mappingCount must equal mappings.length");
  }
  if (!Array.isArray(value.unmatchedDrawingNumbers) || value.unmatchedDrawingNumbers.some((item) => typeof item !== "string")) {
    throw new Error("unmatchedDrawingNumbers must be an array of strings");
  }
  if (value.unmatchedCount !== value.unmatchedDrawingNumbers.length) {
    throw new Error("unmatchedCount must equal unmatchedDrawingNumbers.length");
  }
  const expectedCoverage = Math.round(Math.min(1, value.mappings.length / value.indexedDrawingCount) * 1_000_000) / 1_000_000;
  if (typeof value.coverageRatio !== "number" || !Number.isFinite(value.coverageRatio) || value.coverageRatio < 0 || value.coverageRatio > 1 || value.coverageRatio !== expectedCoverage) {
    throw new Error("coverageRatio is inconsistent with mappingCount and indexedDrawingCount");
  }
  if (!Array.isArray(value.duplicatePageMatches)) {
    throw new Error("duplicatePageMatches must be an array");
  }
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("warnings must be an array of strings");
  }
  if (value.relativePageMapPath !== undefined && typeof value.relativePageMapPath !== "string") {
    throw new Error("relativePageMapPath must be a string");
  }
  const startPage = value.startPage;
  const endPage = value.endPage;
  return {
    schemaVersion: 1,
    source: value.source,
    sourceSha256: value.sourceSha256,
    indexPath: value.indexPath,
    indexSourceSha256: value.indexSourceSha256,
    startPage,
    endPage,
    scannedPageCount: value.scannedPageCount as number,
    indexedDrawingCount: value.indexedDrawingCount,
    mappingCount: value.mappingCount as number,
    unmatchedCount: value.unmatchedCount as number,
    coverageRatio: value.coverageRatio,
    mappings: value.mappings.map((mapping, index) =>
      validateMapping(mapping, index, startPage, endPage)
    ),
    unmatchedDrawingNumbers: [...value.unmatchedDrawingNumbers] as string[],
    duplicatePageMatches: value.duplicatePageMatches.map((duplicate, index) =>
      validateDuplicate(duplicate, index, startPage, endPage)
    ),
    warnings: [...value.warnings] as string[],
    ...(value.relativePageMapPath === undefined ? {} : { relativePageMapPath: value.relativePageMapPath }),
  };
}

function resolveSecurePath(projectRoot: string, pageMapPath: string): string {
  if (typeof pageMapPath !== "string" || !pageMapPath || isAbsolute(pageMapPath) || pageMapPath.includes("\\")) {
    throw new Error("pageMapPath must be a PROJECT_ROOT-relative POSIX path");
  }
  const parts = pageMapPath.split("/");
  if (
    parts.length !== 3 || parts[0] !== ".volt-ai" || parts[1] !== "page-maps" ||
    !parts[2] || parts[2].startsWith(".") || parts.includes("..") || extname(parts[2]).toLowerCase() !== ".json"
  ) {
    throw new Error("pageMapPath must be .volt-ai/page-maps/<non-hidden-file>.json without nesting");
  }
  let current = projectRoot;
  for (const part of parts) {
    current = join(current, part);
    let stats;
    try { stats = lstatSync(current); } catch { throw new Error("Drawing page map file does not exist"); }
    if (stats.isSymbolicLink()) throw new Error("Drawing page map path cannot include a symbolic link");
  }
  if (!lstatSync(current).isFile()) throw new Error("Drawing page map path must reference a regular file");
  if (!isWithinProjectRoot(projectRoot, realpathSync(current))) {
    throw new Error("Drawing page map path must stay within PROJECT_ROOT");
  }
  return current;
}

export function loadDrawingPageMap(
  projectRoot: string | undefined,
  pageMapPath: string,
): DrawingPageMapDocument {
  const root = assertProjectRoot(projectRoot);
  const path = resolveSecurePath(root, pageMapPath);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  let content: string;
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("Drawing page map path must reference a regular file");
    if (stats.size > MAX_PAGE_MAP_BYTES) throw new Error("Drawing page map exceeds the 10 MiB size limit");
    content = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("Drawing page map contains malformed JSON"); }
  return validateDocument(parsed);
}
