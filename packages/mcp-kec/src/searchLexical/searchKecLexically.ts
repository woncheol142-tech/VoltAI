import { scoreKecLexicalChunk } from "./scoreKecLexicalChunk.js";
import { tokenizeKecLexicalText } from "./tokenizeKecLexicalText.js";
import type {
  KecLexicalSearchDependencies,
  KecLexicalSearchResult,
} from "./types.js";

const SOURCE_FIELDS: readonly string[] = Object.freeze([
  "chunkId",
  "documentId",
  "sourcePath",
  "chunkIndex",
  "locator",
  "metadata",
  "text",
]);
const LOCATOR_FIELDS: readonly string[] = Object.freeze(["kind", "page"]);
const METADATA_FIELDS: readonly string[] = Object.freeze(["clause"]);

type ValidatedSourceChunk = {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly chunkIndex: number;
  readonly locatorKind: "page";
  readonly locatorPage: number;
  readonly metadataClause: string | null;
  readonly text: string;
};

function invalidQuery(): never {
  throw new Error("INVALID_KEC_LEXICAL_QUERY: invalid query");
}

function invalidLimit(): never {
  throw new Error("INVALID_KEC_LEXICAL_LIMIT: invalid limit");
}

function invalidSource(): never {
  throw new Error("INVALID_KEC_LEXICAL_SOURCE_RESULT: invalid source result");
}

function invalidScore(): never {
  throw new Error("INVALID_KEC_LEXICAL_SCORE: invalid lexical score");
}

function frozenEmptyResult(): readonly KecLexicalSearchResult[] {
  return Object.freeze([]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(
  value: Record<string, unknown>,
  expectedFields: readonly string[],
): boolean {
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }

  const names = Object.getOwnPropertyNames(value);
  if (names.length !== expectedFields.length) {
    return false;
  }

  const expected = new Set(expectedFields);
  return names.every((name) => expected.has(name));
}

function readDataProperty(
  value: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalidSource();
  }

  return descriptor.value;
}

function validateLocator(value: unknown): {
  readonly kind: "page";
  readonly page: number;
} {
  if (!isPlainRecord(value) || !hasExactFields(value, LOCATOR_FIELDS)) {
    invalidSource();
  }

  const kind = readDataProperty(value, "kind");
  const page = readDataProperty(value, "page");

  if (
    kind !== "page" ||
    typeof page !== "number" ||
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    invalidSource();
  }

  return { kind, page };
}

function validateMetadata(value: unknown): {
  readonly clause: string | null;
} {
  if (!isPlainRecord(value) || !hasExactFields(value, METADATA_FIELDS)) {
    invalidSource();
  }

  const clause = readDataProperty(value, "clause");
  if (clause !== null && typeof clause !== "string") {
    invalidSource();
  }

  return { clause };
}

function validateSourceRow(value: unknown): ValidatedSourceChunk {
  if (!isPlainRecord(value) || !hasExactFields(value, SOURCE_FIELDS)) {
    invalidSource();
  }

  const chunkId = readDataProperty(value, "chunkId");
  const documentId = readDataProperty(value, "documentId");
  const sourcePath = readDataProperty(value, "sourcePath");
  const chunkIndex = readDataProperty(value, "chunkIndex");
  const locatorValue = readDataProperty(value, "locator");
  const metadataValue = readDataProperty(value, "metadata");
  const text = readDataProperty(value, "text");

  if (
    typeof chunkId !== "string" ||
    chunkId.length === 0 ||
    typeof documentId !== "string" ||
    typeof sourcePath !== "string" ||
    typeof chunkIndex !== "number" ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    typeof text !== "string"
  ) {
    invalidSource();
  }

  const locator = validateLocator(locatorValue);
  const metadata = validateMetadata(metadataValue);

  return {
    chunkId,
    documentId,
    sourcePath,
    chunkIndex,
    locatorKind: locator.kind,
    locatorPage: locator.page,
    metadataClause: metadata.clause,
    text,
  };
}

function validateSourceArray(value: unknown): readonly ValidatedSourceChunk[] {
  if (!Array.isArray(value)) {
    invalidSource();
  }

  if (Object.getOwnPropertySymbols(value).length !== 0) {
    invalidSource();
  }

  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalidSource();
  }

  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || !names.includes("length")) {
    invalidSource();
  }

  const nameSet = new Set(names);
  const rows: ValidatedSourceChunk[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!nameSet.has(key)) {
      invalidSource();
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      invalidSource();
    }

    rows.push(validateSourceRow(descriptor.value));
  }

  const seenChunkIds = new Set<string>();
  for (const row of rows) {
    if (seenChunkIds.has(row.chunkId)) {
      invalidSource();
    }
    seenChunkIds.add(row.chunkId);
  }

  return rows;
}

function uniqueTokens(tokens: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }

  return unique;
}

function compareResults(
  left: KecLexicalSearchResult,
  right: KecLexicalSearchResult,
): number {
  if (left.lexicalScore !== right.lexicalScore) {
    return right.lexicalScore - left.lexicalScore;
  }

  if (left.chunkId < right.chunkId) {
    return -1;
  }

  if (left.chunkId > right.chunkId) {
    return 1;
  }

  return 0;
}

function createResult(
  source: ValidatedSourceChunk,
  lexicalScore: number,
): KecLexicalSearchResult {
  const locator = Object.freeze({
    kind: source.locatorKind,
    page: source.locatorPage,
  });
  const metadata = Object.freeze({
    clause: source.metadataClause,
  });

  return Object.freeze({
    chunkId: source.chunkId,
    documentId: source.documentId,
    sourcePath: source.sourcePath,
    locator,
    metadata,
    text: source.text,
    lexicalScore,
  });
}

export async function searchKecLexically(
  query: string,
  limit: number,
  dependencies: KecLexicalSearchDependencies,
): Promise<readonly KecLexicalSearchResult[]> {
  if (typeof query !== "string" || query.length > 4_096) {
    invalidQuery();
  }

  if (typeof limit !== "number" || !Number.isSafeInteger(limit)) {
    invalidLimit();
  }

  if (limit < 0 || limit > 100) {
    invalidLimit();
  }

  const rawQueryTokens = tokenizeKecLexicalText(query);
  if (rawQueryTokens.length > 64) {
    invalidQuery();
  }

  const queryTokens = uniqueTokens(rawQueryTokens);
  if (queryTokens.length === 0 || limit === 0) {
    return frozenEmptyResult();
  }

  const sourceValue: unknown = await dependencies.listChunks();
  const source = validateSourceArray(sourceValue);
  const results: KecLexicalSearchResult[] = [];

  for (const row of source) {
    const textTokens = tokenizeKecLexicalText(row.text);
    const clauseTokens =
      row.metadataClause === null
        ? []
        : tokenizeKecLexicalText(row.metadataClause);
    const lexicalScore = scoreKecLexicalChunk({
      queryTokens,
      textTokens,
      clauseTokens,
    });

    if (lexicalScore === null) {
      continue;
    }

    if (
      typeof lexicalScore !== "number" ||
      !Number.isFinite(lexicalScore) ||
      lexicalScore <= 0 ||
      lexicalScore > 1 ||
      Object.is(lexicalScore, -0)
    ) {
      invalidScore();
    }

    results.push(createResult(row, lexicalScore));
  }

  results.sort(compareResults);
  return Object.freeze(results.slice(0, limit));
}
