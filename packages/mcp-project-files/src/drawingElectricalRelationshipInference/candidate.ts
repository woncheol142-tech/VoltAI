import { createHash } from "node:crypto";

import { ElectricalRelationshipType } from "../drawingElectricalRelationships/types.js";
import {
  computeRelationshipConfidence,
} from "./confidence.js";
import { createRelationshipEvidenceIndex } from "./createRelationshipEvidenceIndex.js";
import type {
  RelationshipCandidate,
  RelationshipConfidenceComponents,
  RelationshipEvidenceIndex,
} from "./types.js";
import { validateRelationshipInferenceInput } from "./validateRelationshipInferenceInput.js";

const RELATIONSHIP_TYPES = new Set<string>(Object.values(ElectricalRelationshipType));
const SYMMETRIC_TYPES = new Set<ElectricalRelationshipType>([
  ElectricalRelationshipType.CONNECTED_TO,
  ElectricalRelationshipType.CONNECTED_VIA,
]);
const EVIDENCE_NAMESPACES = new Set([
  "primitive",
  "text",
  "spatial",
  "graph-edge",
] as const);

type EvidenceNamespace = "primitive" | "text" | "spatial" | "graph-edge";

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(values: readonly string[]): string[] {
  return [...values].sort(codepointCompare);
}

type RelationshipCandidateInput = Omit<RelationshipCandidate, "candidateId"> & {
  candidateId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonSafe(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) return false;
  } else if (!isPlainObject(value)) {
    return false;
  }
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonSafe(entry, ancestors))
    : Object.values(value).every((entry) => isJsonSafe(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function requireNonemptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Relationship candidate ${name} must be a non-empty string`);
  }
}

function requireFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Relationship candidate ${name} must be finite`);
  }
}

function requireUnitInterval(value: number, name: string): void {
  if (value < 0 || value > 1) {
    throw new Error(`Relationship candidate ${name} must be within 0..1`);
  }
}

function parseEvidenceReference(evidenceId: string): {
  namespace: EvidenceNamespace;
  id: string;
} {
  const separator = evidenceId.indexOf(":");
  const namespace = evidenceId.slice(0, separator) as EvidenceNamespace;
  const id = evidenceId.slice(separator + 1);
  if (
    separator <= 0 ||
    !EVIDENCE_NAMESPACES.has(namespace) ||
    id.length === 0 ||
    id.includes("\u0000")
  ) {
    throw new Error(
      "Relationship candidate evidence must use a canonical namespace",
    );
  }
  return { namespace, id };
}

export function connectedViaObjectId(candidate: unknown): string | undefined {
  if (!isRecord(candidate) ||
      candidate.relationshipType !== ElectricalRelationshipType.CONNECTED_VIA) {
    return undefined;
  }
  if (!isRecord(candidate.attributes)) {
    throw new Error("CONNECTED_VIA attributes must contain viaObjectId");
  }
  if (Object.hasOwn(candidate.attributes, "viaObjectIds")) {
    throw new Error("CONNECTED_VIA must use only the scalar viaObjectId authority");
  }
  requireNonemptyString(candidate.attributes.viaObjectId, "viaObjectId");
  return candidate.attributes.viaObjectId;
}

function validateComponents(value: unknown): asserts value is RelationshipConfidenceComponents {
  if (!isRecord(value)) {
    throw new Error("Relationship candidate confidence components are required");
  }
  for (const name of ["endpoint", "ruleMatch", "evidence", "consistency"] as const) {
    const score = value[name];
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(`Relationship candidate ${name} confidence component is invalid`);
    }
  }
}

function canonicalEndpoints(candidate: Pick<
  RelationshipCandidate,
  "sourceObjectId" | "targetObjectId" | "relationshipType"
>): [string, string] {
  if (
    SYMMETRIC_TYPES.has(candidate.relationshipType) &&
    codepointCompare(candidate.sourceObjectId, candidate.targetObjectId) > 0
  ) {
    return [candidate.targetObjectId, candidate.sourceObjectId];
  }
  return [candidate.sourceObjectId, candidate.targetObjectId];
}

function graphEdgeForEvidence(
  evidenceIndex: RelationshipEvidenceIndex,
  evidenceId: string,
) {
  const reference = parseEvidenceReference(evidenceId);
  return reference.namespace === "graph-edge"
    ? evidenceIndex.graphEdgeById.get(reference.id)
    : undefined;
}

function validateEvidenceOwnership(
  evidenceIds: readonly string[],
  sourceObjectId: string,
  targetObjectId: string,
  evidenceIndex: RelationshipEvidenceIndex,
): void {
  const sourceEvidence = new Set(
    evidenceIndex.evidenceByObjectId.get(sourceObjectId) ?? [],
  );
  const targetEvidence = new Set(
    evidenceIndex.evidenceByObjectId.get(targetObjectId) ?? [],
  );
  for (const evidenceId of evidenceIds) {
    const graphEdge = graphEdgeForEvidence(evidenceIndex, evidenceId);
    if (graphEdge !== undefined) {
      if (
        !graphEdge.objectIds.includes(sourceObjectId) ||
        !graphEdge.objectIds.includes(targetObjectId)
      ) {
        throw new Error(
          "Relationship candidate graph-edge evidence is unrelated to its endpoints",
        );
      }
      continue;
    }
    if (!sourceEvidence.has(evidenceId) && !targetEvidence.has(evidenceId)) {
      throw new Error(
        "Relationship candidate evidence ownership is unrelated to its endpoints",
      );
    }
  }
}

export function createRelationshipCandidateId(candidate: unknown): string {
  if (!isRecord(candidate)) throw new Error("Relationship candidate is invalid");
  requireNonemptyString(candidate.ruleId, "ruleId");
  requireNonemptyString(candidate.sourceObjectId, "sourceObjectId");
  requireNonemptyString(candidate.targetObjectId, "targetObjectId");
  if (!RELATIONSHIP_TYPES.has(String(candidate.relationshipType))) {
    throw new Error("Relationship candidate relationshipType is invalid");
  }
  if (!Array.isArray(candidate.evidenceIds) ||
      !candidate.evidenceIds.every((value) => typeof value === "string")) {
    throw new Error("Relationship candidate evidenceIds are invalid");
  }
  const relationshipType = candidate.relationshipType as ElectricalRelationshipType;
  const viaObjectId = connectedViaObjectId(candidate);
  const [sourceObjectId, targetObjectId] = canonicalEndpoints({
    sourceObjectId: candidate.sourceObjectId,
    targetObjectId: candidate.targetObjectId,
    relationshipType,
  });
  const identity = JSON.stringify({
    ruleId: candidate.ruleId,
    relationshipType,
    sourceObjectId,
    targetObjectId,
    ...(viaObjectId === undefined ? {} : { viaObjectId }),
    evidenceIds: canonical(candidate.evidenceIds as string[]),
  });
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

export function validateRelationshipCandidate(
  value: unknown,
  document: unknown,
): asserts value is RelationshipCandidateInput {
  validateRelationshipInferenceInput(document);
  if (!isRecord(value)) throw new Error("Relationship candidate must be an object");
  if (value.candidateId !== undefined) {
    requireNonemptyString(value.candidateId, "candidateId");
  }
  requireNonemptyString(value.ruleId, "ruleId");
  requireNonemptyString(value.sourceObjectId, "sourceObjectId");
  requireNonemptyString(value.targetObjectId, "targetObjectId");
  requireFinite(value.priority, "priority");
  requireFinite(value.spatialSpecificity, "spatialSpecificity");
  if (!RELATIONSHIP_TYPES.has(String(value.relationshipType))) {
    throw new Error("Relationship candidate relationshipType is invalid");
  }
  if (value.sourceObjectId === value.targetObjectId) {
    throw new Error("Relationship candidate source and target must be distinct; self relation rejected");
  }
  if (typeof value.hardGatePassed !== "boolean") {
    throw new Error("Relationship candidate hardGatePassed must be boolean");
  }
  const objects = new Map(document.objects.map((object) => [object.id, object]));
  const source = objects.get(value.sourceObjectId);
  const target = objects.get(value.targetObjectId);
  if (!source) throw new Error("Relationship candidate source object reference is missing");
  if (!target) throw new Error("Relationship candidate target object reference is missing");

  if (!Array.isArray(value.evidenceIds) ||
      !value.evidenceIds.every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error("Relationship candidate evidenceIds are invalid");
  }
  if (new Set(value.evidenceIds).size !== value.evidenceIds.length) {
    throw new Error("Relationship candidate evidenceIds contain duplicates");
  }
  for (const evidenceId of value.evidenceIds) {
    parseEvidenceReference(evidenceId);
  }
  const evidenceIndex = createRelationshipEvidenceIndex(document);
  const knownEvidence = new Set(evidenceIndex.evidenceIds);
  if (value.evidenceIds.some((id) => !knownEvidence.has(id))) {
    throw new Error("Relationship candidate evidence reference is missing");
  }
  validateEvidenceOwnership(
    value.evidenceIds,
    value.sourceObjectId,
    value.targetObjectId,
    evidenceIndex,
  );
  if (!isRecord(value.attributes) || !isJsonSafe(value.attributes)) {
    throw new Error("Relationship candidate attributes must be a JSON-safe plain object");
  }
  if (!isRecord(value.diagnostics) || !isJsonSafe(value.diagnostics)) {
    throw new Error("Relationship candidate diagnostics must be a JSON-safe plain object");
  }
  const viaObjectId = connectedViaObjectId(value);
  if (viaObjectId !== undefined) {
    if (!objects.has(viaObjectId)) {
      throw new Error("CONNECTED_VIA viaObjectId reference is missing");
    }
    if (viaObjectId === value.sourceObjectId || viaObjectId === value.targetObjectId) {
      throw new Error("CONNECTED_VIA viaObjectId must be distinct from both endpoints");
    }
  }
  validateComponents(value.confidenceComponents);
  requireFinite(value.rawConfidence, "raw confidence");
  requireFinite(value.confidence, "public confidence");
  requireUnitInterval(value.rawConfidence, "raw confidence");
  requireUnitInterval(value.confidence, "public confidence");
  const computed = computeRelationshipConfidence({
    sourceConfidence: source.confidence,
    targetConfidence: target.confidence,
    ruleMatchScore: value.confidenceComponents.ruleMatch,
    evidenceScore: value.confidenceComponents.evidence,
    consistencyScore: value.confidenceComponents.consistency,
    hardGatePassed: value.hardGatePassed,
  });
  if (value.confidenceComponents.endpoint !== computed.endpointConfidence) {
    throw new Error("Relationship candidate endpoint confidence mismatches object confidence");
  }
  if (value.rawConfidence !== computed.rawConfidence) {
    throw new Error("Relationship candidate raw confidence mismatches components");
  }
  if (value.confidence !== computed.confidence) {
    throw new Error("Relationship candidate public confidence rounding mismatch");
  }
  const canonicalId = createRelationshipCandidateId(value);
  if (value.candidateId !== undefined && value.candidateId !== canonicalId) {
    throw new Error("Relationship candidate ID mismatches canonical identity");
  }
}

export function canonicalizeRelationshipCandidate(
  value: unknown,
  document: unknown,
): RelationshipCandidate {
  validateRelationshipCandidate(value, document);
  const [sourceObjectId, targetObjectId] = canonicalEndpoints(value);
  const evidenceIds = canonical(value.evidenceIds);
  const candidateId = createRelationshipCandidateId({
    ...value,
    sourceObjectId,
    targetObjectId,
    evidenceIds,
  });
  return {
    ...value,
    candidateId,
    sourceObjectId,
    targetObjectId,
    evidenceIds,
    confidenceComponents: { ...value.confidenceComponents },
    attributes: structuredClone(value.attributes),
    diagnostics: structuredClone(value.diagnostics),
  };
}
