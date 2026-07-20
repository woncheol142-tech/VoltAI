import { ElectricalRelationshipType } from "../drawingElectricalRelationships/types.js";
import {
  canonicalizeRelationshipCandidate,
  createRelationshipCandidateId,
} from "./candidate.js";
import { computeRelationshipConfidence } from "./confidence.js";
import {
  createImmutableRelationshipInferenceDocument,
  createRelationshipEvidenceIndex,
} from "./createRelationshipEvidenceIndex.js";
import type {
  RelationshipCandidate,
  RelationshipInferenceContext,
  RelationshipRule,
} from "./types.js";
import { validateRelationshipInferenceInput } from "./validateRelationshipInferenceInput.js";

const RELATIONSHIP_TYPES = new Set<string>(Object.values(ElectricalRelationshipType));

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRelationshipRule(
  value: unknown,
): asserts value is RelationshipRule {
  if (!isRecord(value)) throw new Error("Relationship rule must be an object");
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error("Relationship rule id is required");
  }
  if (!RELATIONSHIP_TYPES.has(String(value.relationshipType))) {
    throw new Error("Relationship rule relationship type is invalid");
  }
  if (typeof value.priority !== "number" || !Number.isFinite(value.priority)) {
    throw new Error("Relationship rule priority must be finite");
  }
  if (typeof value.generate !== "function") {
    throw new Error("Relationship rule generate must be a function");
  }
}

function connectedToCandidates(
  context: RelationshipInferenceContext,
  rule: Pick<RelationshipRule, "id" | "priority">,
): RelationshipCandidate[] {
  return context.document.constructionGraph.edges
    .filter((edge) => edge.type === "endpoint-contact")
    .map((edge) => {
      const source = context.evidenceIndex.objectById.get(edge.objectIds[0])!;
      const target = context.evidenceIndex.objectById.get(edge.objectIds[1])!;
      const confidence = computeRelationshipConfidence({
        sourceConfidence: source.confidence,
        targetConfidence: target.confidence,
        ruleMatchScore: 1,
        evidenceScore: 1,
        consistencyScore: 1,
        hardGatePassed: true,
      });
      const candidateWithoutId = {
        ruleId: rule.id,
        priority: rule.priority,
        sourceObjectId: edge.objectIds[0],
        targetObjectId: edge.objectIds[1],
        relationshipType: ElectricalRelationshipType.CONNECTED_TO,
        hardGatePassed: true,
        spatialSpecificity: 3,
        confidenceComponents: {
          endpoint: confidence.endpointConfidence,
          ruleMatch: 1,
          evidence: 1,
          consistency: 1,
        },
        rawConfidence: confidence.rawConfidence,
        confidence: confidence.confidence,
        evidenceIds: [`graph-edge:${edge.id}`],
        attributes: {},
        diagnostics: { ruleId: rule.id },
      } satisfies Omit<RelationshipCandidate, "candidateId">;
      return {
        candidateId: createRelationshipCandidateId(candidateWithoutId),
        ...candidateWithoutId,
      };
    });
}

export function createConnectedToRelationshipRule(): RelationshipRule {
  const id = "builtin.endpoint-contact.connected-to";
  const priority = 100;
  return {
    id,
    relationshipType: ElectricalRelationshipType.CONNECTED_TO,
    priority,
    generate(context: RelationshipInferenceContext): RelationshipCandidate[] {
      return connectedToCandidates(context, { id, priority });
    },
  } satisfies RelationshipRule;
}

export function runRelationshipRules(
  values: readonly unknown[],
  document: unknown,
): RelationshipCandidate[] {
  validateRelationshipInferenceInput(document);
  const rules = values.map((value) => {
    validateRelationshipRule(value);
    return value;
  });
  const ruleIds = rules.map((rule) => rule.id);
  if (new Set(ruleIds).size !== ruleIds.length) {
    throw new Error("Duplicate relationship rule id");
  }
  const immutableDocument = createImmutableRelationshipInferenceDocument(document);
  const context: RelationshipInferenceContext = Object.freeze({
    document: immutableDocument,
    evidenceIndex: createRelationshipEvidenceIndex(immutableDocument),
  });
  const candidates: RelationshipCandidate[] = [];
  for (const rule of [...rules].sort((left, right) =>
    codepointCompare(left.id, right.id)
  )) {
    const output = rule.generate(context);
    if (!Array.isArray(output)) {
      throw new Error(`Relationship rule ${rule.id} returned malformed candidate output`);
    }
    for (const value of output) {
      let candidate: RelationshipCandidate;
      try {
        candidate = canonicalizeRelationshipCandidate(value, immutableDocument);
      } catch (error) {
        throw new Error(
          `Relationship rule ${rule.id} returned an invalid candidate: ${String(error)}`,
        );
      }
      if (
        candidate.ruleId !== rule.id ||
        candidate.relationshipType !== rule.relationshipType ||
        candidate.priority !== rule.priority
      ) {
        throw new Error(`Relationship rule ${rule.id} candidate metadata mismatch`);
      }
      candidates.push(candidate);
    }
  }
  candidates.sort((left, right) =>
    codepointCompare(left.candidateId, right.candidateId)
  );
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Duplicate relationship candidate id");
  }
  return candidates;
}
