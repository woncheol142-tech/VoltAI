import { ElectricalRelationshipType } from "../drawingElectricalRelationships/types.js";
import {
  canonicalizeRelationshipCandidate,
  createRelationshipCandidateId,
} from "./candidate.js";
import type {
  RelationshipCandidate,
  RelationshipCandidateConflict,
  RelationshipResolutionResult,
} from "./types.js";
import { validateRelationshipInferenceInput } from "./validateRelationshipInferenceInput.js";

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(codepointCompare);
}

function semanticGroupKey(candidate: RelationshipCandidate): string {
  if (candidate.relationshipType === ElectricalRelationshipType.CONTAINS) {
    return `containment\u0000${candidate.sourceObjectId}\u0000${candidate.targetObjectId}`;
  }
  if (candidate.relationshipType === ElectricalRelationshipType.BELONGS_TO) {
    return `containment\u0000${candidate.targetObjectId}\u0000${candidate.sourceObjectId}`;
  }
  if (
    candidate.relationshipType === ElectricalRelationshipType.CONNECTED_TO ||
    candidate.relationshipType === ElectricalRelationshipType.CONNECTED_VIA
  ) {
    return `connectivity\u0000${candidate.sourceObjectId}\u0000${candidate.targetObjectId}`;
  }
  return `${candidate.relationshipType}\u0000${candidate.sourceObjectId}\u0000${candidate.targetObjectId}`;
}

function compareBeforeLexical(
  left: RelationshipCandidate,
  right: RelationshipCandidate,
): number {
  return right.priority - left.priority ||
    Number(right.hardGatePassed) - Number(left.hardGatePassed) ||
    right.rawConfidence - left.rawConfidence ||
    right.spatialSpecificity - left.spatialSpecificity ||
    Number(right.relationshipType !== ElectricalRelationshipType.UNKNOWN) -
      Number(left.relationshipType !== ElectricalRelationshipType.UNKNOWN);
}

function compareCandidates(
  left: RelationshipCandidate,
  right: RelationshipCandidate,
): number {
  return compareBeforeLexical(left, right) ||
    codepointCompare(left.ruleId, right.ruleId) ||
    codepointCompare(left.candidateId, right.candidateId);
}

function conflictCompare(
  left: RelationshipCandidateConflict,
  right: RelationshipCandidateConflict,
): number {
  return codepointCompare(left.winnerId ?? "", right.winnerId ?? "") ||
    codepointCompare(left.loserId, right.loserId) ||
    codepointCompare(left.reason, right.reason);
}

function mergeEvidence(
  winner: RelationshipCandidate,
  group: readonly RelationshipCandidate[],
): RelationshipCandidate {
  const merged = {
    ...winner,
    evidenceIds: canonical(group.flatMap((candidate) => candidate.evidenceIds)),
    confidenceComponents: { ...winner.confidenceComponents },
    attributes: structuredClone(winner.attributes),
    diagnostics: structuredClone(winner.diagnostics),
  };
  return {
    ...merged,
    candidateId: createRelationshipCandidateId(merged),
  };
}

function isIncompatibleTie(group: readonly RelationshipCandidate[]): boolean {
  if (group.length < 2) return false;
  const relationshipTypes = new Set(group.map((candidate) => candidate.relationshipType));
  return relationshipTypes.size > 1 &&
    group.every((candidate) =>
      compareBeforeLexical(candidate, group[0]) === 0 &&
      compareBeforeLexical(group[0], candidate) === 0
    );
}

export function resolveRelationshipCandidates(
  values: readonly unknown[],
  document: unknown,
): RelationshipResolutionResult {
  validateRelationshipInferenceInput(document);
  const candidates = values.map((value) =>
    canonicalizeRelationshipCandidate(value, document)
  );
  const selectedCandidates: RelationshipCandidate[] = [];
  const excludedCandidates: RelationshipCandidate[] = [];
  const conflicts: RelationshipCandidateConflict[] = [];
  const warnings: string[] = [];
  const groups = new Map<string, RelationshipCandidate[]>();

  for (const candidate of candidates) {
    if (
      !candidate.hardGatePassed ||
      candidate.rawConfidence < 0.6 ||
      candidate.relationshipType === ElectricalRelationshipType.UNKNOWN
    ) {
      excludedCandidates.push(candidate);
      continue;
    }
    const key = semanticGroupKey(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  for (const [key, unsortedGroup] of [...groups.entries()].sort(([left], [right]) =>
    codepointCompare(left, right)
  )) {
    const group = [...unsortedGroup].sort(compareCandidates);
    if (isIncompatibleTie(group)) {
      const warning = `AMBIGUOUS_RELATIONSHIP ${key.replaceAll("\u0000", " ")}`;
      warnings.push(warning);
      for (const candidate of group) {
        excludedCandidates.push(candidate);
        conflicts.push({
          winnerId: null,
          loserId: candidate.candidateId,
          reason: "AMBIGUOUS_RELATIONSHIP",
        });
      }
      continue;
    }
    const winner = group[0]!;
    const mergedWinner = mergeEvidence(winner, group);
    selectedCandidates.push(mergedWinner);
    for (const loser of group.slice(1)) {
      excludedCandidates.push(loser);
      conflicts.push({
        winnerId: mergedWinner.candidateId,
        loserId: loser.candidateId,
        reason: "RELATIONSHIP_CONFLICT",
      });
    }
  }

  selectedCandidates.sort((left, right) =>
    codepointCompare(left.candidateId, right.candidateId)
  );
  excludedCandidates.sort((left, right) =>
    codepointCompare(left.candidateId, right.candidateId)
  );
  conflicts.sort(conflictCompare);
  return {
    selectedCandidates,
    excludedCandidates,
    conflicts,
    warnings: canonical(warnings),
  };
}
