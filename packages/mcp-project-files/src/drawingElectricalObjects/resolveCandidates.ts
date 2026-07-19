import { validateElectricalCandidateConfidence } from "./candidate.js";
import type {
  BuildElectricalObjectsInput,
  CandidateConflict,
  CandidateResolution,
  ElectricalObjectCandidate,
} from "./types.js";

const SPATIAL_SPECIFICITY: Readonly<Record<string, number>> = {
  contains: 5,
  inside: 5,
  overlaps: 4,
  touches: 3,
  adjacent: 2,
  nearest: 1,
};

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(
  left: ElectricalObjectCandidate,
  right: ElectricalObjectCandidate,
): number {
  return right.priority - left.priority ||
    Number(right.hardGatePassed) - Number(left.hardGatePassed) ||
    right.confidence - left.confidence ||
    (SPATIAL_SPECIFICITY[right.spatialSpecificity] ?? 0) -
      (SPATIAL_SPECIFICITY[left.spatialSpecificity] ?? 0) ||
    Number(right.exactLexicalMatch) - Number(left.exactLexicalMatch) ||
    left.primaryPrimitiveSourceOrder - right.primaryPrimitiveSourceOrder ||
    compareCodepoints(left.id, right.id);
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(compareCodepoints);
}

function copyCandidate(
  candidate: ElectricalObjectCandidate,
): ElectricalObjectCandidate {
  return {
    ...candidate,
    primaryPrimitiveIds: canonicalStrings(candidate.primaryPrimitiveIds),
    supportingPrimitiveIds: canonicalStrings(candidate.supportingPrimitiveIds),
    contextPrimitiveIds: canonicalStrings(candidate.contextPrimitiveIds),
    labelIds: canonicalStrings(candidate.labelIds),
    sourceRelationIds: canonicalStrings(candidate.sourceRelationIds),
    attributes: { ...candidate.attributes },
    diagnostics: { ...candidate.diagnostics },
  };
}

function intersects(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function conflictReason(
  candidate: ElectricalObjectCandidate,
  winner: ElectricalObjectCandidate,
): string | null {
  if (intersects(candidate.primaryPrimitiveIds, winner.primaryPrimitiveIds)) {
    return "primary-primitive-owned";
  }
  if (
    intersects(candidate.supportingPrimitiveIds, winner.supportingPrimitiveIds) &&
    !(candidate.shareSupportingPrimitives && winner.shareSupportingPrimitives)
  ) {
    return "supporting-primitive-sharing-not-allowed";
  }
  if (
    intersects(candidate.primaryPrimitiveIds, winner.supportingPrimitiveIds) ||
    intersects(candidate.supportingPrimitiveIds, winner.primaryPrimitiveIds)
  ) {
    return "primitive-role-ownership-conflict";
  }
  return null;
}

function withExclusion(
  candidate: ElectricalObjectCandidate,
  reason: string,
  winnerId?: string,
): ElectricalObjectCandidate {
  const conflict = winnerId === undefined ? undefined : { winnerId, reason };
  return {
    ...copyCandidate(candidate),
    diagnostics: {
      ...candidate.diagnostics,
      exclusionReason: reason,
      ...(conflict === undefined ? {} : { conflicts: [conflict] }),
    },
  };
}

function sortById(
  candidates: ElectricalObjectCandidate[],
): ElectricalObjectCandidate[] {
  return [...candidates].sort((left, right) =>
    compareCodepoints(left.id, right.id)
  );
}

function validateResolverCandidate(candidate: ElectricalObjectCandidate): void {
  if (!Number.isFinite(candidate.priority)) {
    throw new Error(`Candidate ${candidate.id} priority must be finite`);
  }
  validateElectricalCandidateConfidence(candidate);
}

export function resolveElectricalObjectCandidates(
  candidates: readonly ElectricalObjectCandidate[],
  context: BuildElectricalObjectsInput,
): CandidateResolution {
  void context;
  const ordered = candidates.map(copyCandidate).sort(compareCandidates);
  const ids = new Set<string>();
  for (const candidate of ordered) {
    validateResolverCandidate(candidate);
    if (ids.has(candidate.id)) throw new Error(`Duplicate candidate ID: ${candidate.id}`);
    ids.add(candidate.id);
  }

  const selected: ElectricalObjectCandidate[] = [];
  const acceptedCandidates: ElectricalObjectCandidate[] = [];
  const reviewCandidates: ElectricalObjectCandidate[] = [];
  const excludedCandidates: ElectricalObjectCandidate[] = [];
  const conflicts: CandidateConflict[] = [];

  for (const candidate of ordered) {
    if (!candidate.hardGatePassed) {
      excludedCandidates.push(withExclusion(candidate, "hard-gate-failed"));
      continue;
    }
    if (candidate.confidence < 0.6) {
      excludedCandidates.push(withExclusion(candidate, "low-confidence"));
      continue;
    }
    const winner = selected.find((value) =>
      conflictReason(candidate, value) !== null
    );
    if (winner) {
      const reason = conflictReason(candidate, winner)!;
      conflicts.push({ winnerId: winner.id, loserId: candidate.id, reason });
      excludedCandidates.push(withExclusion(candidate, reason, winner.id));
      continue;
    }

    selected.push(candidate);
    if (candidate.confidence >= 0.8) acceptedCandidates.push(candidate);
    else reviewCandidates.push(candidate);
  }

  return {
    acceptedCandidates: sortById(acceptedCandidates),
    reviewCandidates: sortById(reviewCandidates),
    excludedCandidates: sortById(excludedCandidates),
    conflicts: [...conflicts].sort((left, right) =>
      compareCodepoints(left.loserId, right.loserId) ||
      compareCodepoints(left.winnerId, right.winnerId) ||
      compareCodepoints(left.reason, right.reason)
    ),
  };
}
