import type {
  KecLexicalHit,
  KecLexicalSearcher,
  KecSearchRequest,
} from "../searchFoundation/index.js";
import type { ExistingLexicalSearchAdapterDependencies } from "./types.js";

const requestErrorPrefix = "INVALID_LEXICAL_SEARCH_REQUEST:";
const resultErrorPrefix = "INVALID_LEXICAL_SEARCH_RESULT:";
const chunkIdErrorPrefix = "MISSING_LEXICAL_CHUNK_ID:";

const requestKeys = Object.freeze(["query", "limit"]);
const resultKeys = Object.freeze([
  "chunkId",
  "documentId",
  "sourcePath",
  "locator",
  "metadata",
  "text",
  "lexicalScore",
]);
const locatorKeys = Object.freeze(["kind", "page"]);
const metadataKeys = Object.freeze(["clause"]);

type ValidatedRequest = {
  readonly query: string;
  readonly limit: number;
};

type ValidatedResult = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly lexicalScore: number;
};

function requestError(message: string): Error {
  return new Error(`${requestErrorPrefix} ${message}`);
}

function resultError(message: string): Error {
  return new Error(`${resultErrorPrefix} ${message}`);
}

function chunkIdError(message: string): Error {
  return new Error(`${chunkIdErrorPrefix} ${message}`);
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDataValue(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined && "value" in descriptor;
}

function rejectUnexpectedKeys(
  value: object,
  allowedKeys: readonly string[],
  error: (message: string) => Error,
  context: string,
): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) {
      throw error(`${context} has an unexpected own string key`);
    }
  }
}

function rejectSymbols(
  value: object,
  error: (message: string) => Error,
  context: string,
): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw error(`${context} must not contain a symbol property`);
  }
}

function readRequestField(request: object, field: "query" | "limit"): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(request, field);
  if (!hasDataValue(descriptor)) {
    throw requestError(`${field} must be an own data property`);
  }
  return descriptor.value;
}

function validateRequest(request: KecSearchRequest): ValidatedRequest {
  if (!isPlainObject(request)) {
    throw requestError("request must be a plain object");
  }

  rejectUnexpectedKeys(request, requestKeys, requestError, "request");
  rejectSymbols(request, requestError, "request");

  const query = readRequestField(request, "query");
  if (typeof query !== "string") {
    throw requestError("query must be a string");
  }

  const limit = readRequestField(request, "limit");
  if (typeof limit !== "number") {
    throw requestError("limit must be a number");
  }
  if (!Number.isSafeInteger(limit)) {
    throw requestError("limit must be a safe integer");
  }
  if (limit < 0) {
    throw requestError("limit must be non-negative");
  }

  return { query, limit };
}

function readResultField(
  value: object,
  field: string,
  qualifiedField: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!hasDataValue(descriptor)) {
    throw resultError(`${qualifiedField} must be an own data property`);
  }
  return descriptor.value;
}

function readChunkId(value: object): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, "chunkId");
  if (
    !hasDataValue(descriptor) ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0
  ) {
    throw chunkIdError("chunkId must be a non-empty own string data property");
  }
  return descriptor.value;
}

function validateLocator(value: unknown): { kind: "page"; page: number } {
  if (!isPlainObject(value)) {
    throw resultError("locator must be a plain object");
  }

  rejectUnexpectedKeys(value, locatorKeys, resultError, "locator");
  rejectSymbols(value, resultError, "locator");

  const kind = readResultField(value, "kind", "locator.kind");
  if (kind !== "page") {
    throw resultError('locator.kind must be "page"');
  }

  const page = readResultField(value, "page", "locator.page");
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    throw resultError("locator.page must be a positive safe integer");
  }

  return { kind, page };
}

function validateMetadata(value: unknown): { clause: string | null } {
  if (!isPlainObject(value)) {
    throw resultError("metadata must be a plain object");
  }

  rejectUnexpectedKeys(value, metadataKeys, resultError, "metadata");
  rejectSymbols(value, resultError, "metadata");

  const clause = readResultField(value, "clause", "metadata.clause");
  if (clause !== null && typeof clause !== "string") {
    throw resultError("metadata.clause must be a string or null");
  }

  return { clause };
}

function validateResultRow(value: unknown): ValidatedResult {
  if (!isPlainObject(value)) {
    throw resultError("result row must be a plain object");
  }

  rejectUnexpectedKeys(value, resultKeys, resultError, "result row");
  rejectSymbols(value, resultError, "result row");

  const chunkId = readChunkId(value);

  const documentId = readResultField(value, "documentId", "documentId");
  if (typeof documentId !== "string") {
    throw resultError("documentId must be a string");
  }

  const sourcePath = readResultField(value, "sourcePath", "sourcePath");
  if (typeof sourcePath !== "string") {
    throw resultError("sourcePath must be a string");
  }

  const locator = validateLocator(readResultField(value, "locator", "locator"));
  const metadata = validateMetadata(
    readResultField(value, "metadata", "metadata"),
  );

  const text = readResultField(value, "text", "text");
  if (typeof text !== "string") {
    throw resultError("text must be a string");
  }

  const lexicalScore = readResultField(value, "lexicalScore", "lexicalScore");
  if (
    typeof lexicalScore !== "number" ||
    !Number.isFinite(lexicalScore) ||
    lexicalScore <= 0 ||
    lexicalScore > 1 ||
    Object.is(lexicalScore, -0)
  ) {
    throw resultError("lexicalScore must be finite and in the range (0, 1]");
  }

  return {
    chunkId,
    sourcePath,
    page: locator.page,
    clause: metadata.clause,
    text,
    lexicalScore,
  };
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (key.length === 0) {
    return false;
  }

  const index = Number(key);
  return (
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < length &&
    String(index) === key
  );
}

function validateResults(value: unknown): readonly ValidatedResult[] {
  if (!Array.isArray(value)) {
    throw resultError("runtime result must be an array");
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key !== "length" && !isCanonicalArrayIndex(key, value.length)) {
      throw resultError("result array has an unexpected array key");
    }
  }

  rejectSymbols(value, resultError, "result array");

  const rows: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) {
      throw resultError("result array must be dense");
    }
    if (!hasDataValue(descriptor)) {
      throw resultError("result array index must use a data descriptor");
    }
    rows.push(descriptor.value);
  }

  const validatedResults = rows.map(validateResultRow);
  const chunkIds = new Set<string>();
  for (const result of validatedResults) {
    if (chunkIds.has(result.chunkId)) {
      throw resultError("runtime results must not contain duplicate chunkIds");
    }
    chunkIds.add(result.chunkId);
  }

  return validatedResults;
}

function projectHit(value: ValidatedResult): Readonly<KecLexicalHit> {
  return Object.freeze({
    chunkId: value.chunkId,
    sourcePath: value.sourcePath,
    page: value.page,
    clause: value.clause,
    text: value.text,
    lexicalScore: value.lexicalScore,
  });
}

export function createExistingLexicalSearcher(
  dependencies: ExistingLexicalSearchAdapterDependencies,
): KecLexicalSearcher {
  return {
    async search(request) {
      const validatedRequest = validateRequest(request);

      if (validatedRequest.limit === 0) {
        return Object.freeze([]);
      }

      const source = await dependencies.searchLexically(
        validatedRequest.query,
        validatedRequest.limit,
      );
      const validatedResults = validateResults(source);
      return Object.freeze(validatedResults.map(projectHit));
    },
  };
}
