import {
  ElectricalRelationshipType,
  type ElectricalRelationshipDocument,
} from "./types.js";

export type ElectricalRelationshipValidationIssue = {
  severity: "error";
  code: string;
  message: string;
  relationshipId: string | null;
};

export type ElectricalRelationshipValidationResult = {
  valid: boolean;
  issues: ElectricalRelationshipValidationIssue[];
};

const RELATIONSHIP_TYPES = Object.values(ElectricalRelationshipType);
const RELATIONSHIP_TYPE_SET = new Set<unknown>(RELATIONSHIP_TYPES);

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issueComparator(
  left: ElectricalRelationshipValidationIssue,
  right: ElectricalRelationshipValidationIssue,
): number {
  return codepointCompare(left.code, right.code) ||
    codepointCompare(left.relationshipId ?? "", right.relationshipId ?? "") ||
    codepointCompare(left.message, right.message);
}

function addIssue(
  issues: ElectricalRelationshipValidationIssue[],
  code: string,
  message: string,
  relationshipId: string | null = null,
): void {
  issues.push({ severity: "error", code, message, relationshipId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDenseArray(value: readonly unknown[]): boolean {
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isJsonSafe(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    if (!isDenseArray(value)) return false;
  } else if (!isPlainObject(value)) {
    return false;
  }
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonSafe(entry, ancestors))
    : Object.entries(value).every(([, entry]) => isJsonSafe(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function validateStringArray(
  value: unknown,
  invalidCode: string,
  duplicateCode: string,
  label: string,
  issues: ElectricalRelationshipValidationIssue[],
  relationshipId: string | null = null,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    addIssue(issues, invalidCode, `${label} must contain non-empty strings`, relationshipId);
    return [];
  }
  if (new Set(value).size !== value.length) {
    addIssue(issues, duplicateCode, `${label} must not contain duplicates`, relationshipId);
  }
  return value;
}

function validateDocumentIdentity(
  document: Record<string, unknown>,
  issues: ElectricalRelationshipValidationIssue[],
): void {
  if (document.schemaVersion !== 1) {
    addIssue(issues, "INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  }
  if (typeof document.source !== "string" || document.source.trim().length === 0) {
    addIssue(issues, "INVALID_SOURCE", "Document source is required");
  }
  if (
    typeof document.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(document.sourceSha256)
  ) {
    addIssue(issues, "INVALID_SOURCE_SHA256", "sourceSha256 must be 64 hex chars");
  }
  if (!Number.isInteger(document.page) || (document.page as number) < 1) {
    addIssue(issues, "INVALID_PAGE", "Document page must be a positive integer");
  }
}

function validateRelationship(
  value: unknown,
  objectIds: ReadonlySet<string>,
  issues: ElectricalRelationshipValidationIssue[],
): { id: string; type: ElectricalRelationshipType | null } {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_RELATIONSHIP", "Relationship must be an object");
    return { id: "", type: null };
  }
  const relationshipId = typeof value.relationshipId === "string"
    ? value.relationshipId
    : "";
  if (relationshipId.length === 0) {
    addIssue(
      issues,
      "INVALID_RELATIONSHIP_ID",
      "Relationship ID is required",
    );
  }
  if (
    typeof value.sourceObjectId !== "string" ||
    !objectIds.has(value.sourceObjectId)
  ) {
    addIssue(
      issues,
      "DANGLING_SOURCE_OBJECT_REFERENCE",
      "Relationship source object does not exist",
      relationshipId,
    );
  }
  if (
    typeof value.targetObjectId !== "string" ||
    !objectIds.has(value.targetObjectId)
  ) {
    addIssue(
      issues,
      "DANGLING_TARGET_OBJECT_REFERENCE",
      "Relationship target object does not exist",
      relationshipId,
    );
  }
  const relationshipType = RELATIONSHIP_TYPE_SET.has(value.relationshipType)
    ? value.relationshipType as ElectricalRelationshipType
    : null;
  if (relationshipType === null) {
    addIssue(
      issues,
      "INVALID_RELATIONSHIP_TYPE",
      "Relationship type is invalid",
      relationshipId,
    );
  }
  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    Object.is(value.confidence, -0)
  ) {
    addIssue(
      issues,
      "INVALID_RELATIONSHIP_CONFIDENCE",
      "Relationship confidence must be finite and within 0..1",
      relationshipId,
    );
  }
  validateStringArray(
    value.evidenceIds,
    "INVALID_EVIDENCE_IDS",
    "DUPLICATE_EVIDENCE_ID",
    "Relationship evidence IDs",
    issues,
    relationshipId,
  );
  for (const [field, fieldValue] of [
    ["attributes", value.attributes],
    ["diagnostics", value.diagnostics],
  ] as const) {
    if (!isRecord(fieldValue) || !isJsonSafe(fieldValue)) {
      addIssue(
        issues,
        `INVALID_RELATIONSHIP_${field.toUpperCase()}`,
        `Relationship ${field} must be a JSON-safe object`,
        relationshipId,
      );
    }
  }
  return { id: relationshipId, type: relationshipType };
}

function validateStatistics(
  value: unknown,
  relationships: readonly { type: ElectricalRelationshipType | null }[],
  issues: ElectricalRelationshipValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, "INVALID_RELATIONSHIP_STATISTICS", "Statistics are required");
    return;
  }
  if (
    !Number.isInteger(value.relationshipCount) ||
    value.relationshipCount !== relationships.length
  ) {
    addIssue(
      issues,
      "RELATIONSHIP_COUNT_MISMATCH",
      "Statistics relationshipCount does not match relationships",
    );
  }
  if (!isRecord(value.relationshipCountByType)) {
    addIssue(
      issues,
      "RELATIONSHIP_TYPE_STATISTICS_MISMATCH",
      "relationshipCountByType is invalid",
    );
    return;
  }
  let mismatch = false;
  for (const type of RELATIONSHIP_TYPES) {
    const expected = relationships.filter((relationship) => relationship.type === type).length;
    const actual = value.relationshipCountByType[type];
    if (!Number.isInteger(actual) || actual !== expected) mismatch = true;
  }
  if (mismatch) {
    addIssue(
      issues,
      "RELATIONSHIP_TYPE_STATISTICS_MISMATCH",
      "relationshipCountByType does not match relationships",
    );
  }
}

export function validateElectricalRelationshipDocument(
  documentValue: unknown,
): ElectricalRelationshipValidationResult {
  const issues: ElectricalRelationshipValidationIssue[] = [];
  if (!isRecord(documentValue)) {
    addIssue(issues, "INVALID_RELATIONSHIP_DOCUMENT", "Document must be an object");
    return { valid: false, issues };
  }
  validateDocumentIdentity(documentValue, issues);
  const objectIdValues = validateStringArray(
    documentValue.objectIds,
    "INVALID_OBJECT_IDS",
    "DUPLICATE_OBJECT_ID",
    "Object registry IDs",
    issues,
  );
  const objectIds = new Set(objectIdValues);
  if (!Array.isArray(documentValue.relationships)) {
    addIssue(issues, "INVALID_RELATIONSHIPS", "Relationships must be an array");
    return { valid: false, issues: issues.sort(issueComparator) };
  }
  const relationships = documentValue.relationships.map((relationship) =>
    validateRelationship(relationship, objectIds, issues)
  );
  const relationshipIds = relationships.map(({ id }) => id).filter((id) => id.length > 0);
  if (new Set(relationshipIds).size !== relationshipIds.length) {
    addIssue(
      issues,
      "DUPLICATE_RELATIONSHIP_ID",
      "Relationship IDs must be unique",
    );
  }
  if (
    !Number.isInteger(documentValue.relationshipCount) ||
    documentValue.relationshipCount !== relationships.length
  ) {
    addIssue(
      issues,
      "RELATIONSHIP_COUNT_MISMATCH",
      "Document relationshipCount does not match relationships",
    );
  }
  validateStatistics(documentValue.statistics, relationships, issues);
  if (
    !Array.isArray(documentValue.warnings) ||
    !documentValue.warnings.every((warning) => typeof warning === "string") ||
    new Set(documentValue.warnings).size !== documentValue.warnings.length
  ) {
    addIssue(issues, "INVALID_RELATIONSHIP_WARNINGS", "Warnings must be unique strings");
  }
  issues.sort(issueComparator);
  return { valid: issues.length === 0, issues };
}

export function validateElectricalRelationships(document: unknown): void {
  const result = validateElectricalRelationshipDocument(document);
  if (!result.valid) {
    throw new Error(
      result.issues.map(({ code, message }) => `${code}: ${message}`).join("; "),
    );
  }
}

export type { ElectricalRelationshipDocument };
