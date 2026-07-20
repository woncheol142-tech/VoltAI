import { createHash } from "node:crypto";

import {
  ElectricalRelationshipType,
  type ElectricalRelationship,
  type ElectricalRelationshipDocument,
  type ElectricalRelationshipStatistics,
} from "../drawingElectricalRelationships/types.js";
import { validateElectricalRelationships } from "../drawingElectricalRelationships/validateElectricalRelationships.js";
import { resolveRelationshipCandidates } from "./resolveRelationshipCandidates.js";
import { connectedViaObjectId } from "./candidate.js";
import {
  createConnectedToRelationshipRule,
  runRelationshipRules,
} from "./rules.js";
import type { RelationshipCandidate } from "./types.js";
import { validateRelationshipInferenceInput } from "./validateRelationshipInferenceInput.js";

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(codepointCompare);
}

function relationshipId(
  sourceSha256: string,
  page: number,
  candidate: RelationshipCandidate,
): string {
  const viaObjectId = connectedViaObjectId(candidate);
  return createHash("sha256")
    .update(JSON.stringify({
      sourceSha256,
      page,
      relationshipType: candidate.relationshipType,
      sourceObjectId: candidate.sourceObjectId,
      targetObjectId: candidate.targetObjectId,
      ...(viaObjectId === undefined ? {} : { viaObjectId }),
    }))
    .digest("hex")
    .slice(0, 24);
}

function relationshipFromCandidate(
  sourceSha256: string,
  page: number,
  candidate: RelationshipCandidate,
): ElectricalRelationship {
  return {
    relationshipId: relationshipId(sourceSha256, page, candidate),
    sourceObjectId: candidate.sourceObjectId,
    targetObjectId: candidate.targetObjectId,
    relationshipType: candidate.relationshipType,
    confidence: candidate.confidence,
    evidenceIds: canonical(candidate.evidenceIds),
    attributes: structuredClone(candidate.attributes),
    diagnostics: structuredClone(candidate.diagnostics),
  };
}

function emptyTypeCounts(): ElectricalRelationshipStatistics["relationshipCountByType"] {
  return {
    [ElectricalRelationshipType.CONNECTED_TO]: 0,
    [ElectricalRelationshipType.CONNECTED_VIA]: 0,
    [ElectricalRelationshipType.CONTAINS]: 0,
    [ElectricalRelationshipType.BELONGS_TO]: 0,
    [ElectricalRelationshipType.REFERENCES]: 0,
    [ElectricalRelationshipType.UNKNOWN]: 0,
  };
}

export function inferElectricalRelationships(
  input: unknown,
  rules: readonly unknown[] = [createConnectedToRelationshipRule()],
): ElectricalRelationshipDocument {
  validateRelationshipInferenceInput(input);
  const candidates = runRelationshipRules(rules, input);
  const resolution = resolveRelationshipCandidates(candidates, input);
  const relationships = resolution.selectedCandidates
    .filter((candidate) =>
      candidate.relationshipType !== ElectricalRelationshipType.UNKNOWN
    )
    .map((candidate) => relationshipFromCandidate(
      input.sourceSha256,
      input.page,
      candidate,
    ))
    .sort((left, right) =>
      codepointCompare(left.relationshipId, right.relationshipId)
    );
  const relationshipCountByType = emptyTypeCounts();
  for (const relationship of relationships) {
    relationshipCountByType[relationship.relationshipType] += 1;
  }
  const document: ElectricalRelationshipDocument = {
    schemaVersion: 1,
    source: input.source,
    sourceSha256: input.sourceSha256,
    page: input.page,
    objectIds: canonical(input.objects.map((object) => object.id)),
    relationshipCount: relationships.length,
    relationships,
    statistics: {
      relationshipCount: relationships.length,
      relationshipCountByType,
    },
    warnings: canonical(resolution.warnings),
  };
  validateElectricalRelationships(document);
  return document;
}
