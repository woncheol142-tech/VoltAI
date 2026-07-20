export type RelationshipConfidenceInput = {
  sourceConfidence: number;
  targetConfidence: number;
  ruleMatchScore: number;
  evidenceScore: number;
  consistencyScore: number;
  hardGatePassed: boolean;
};

export type RelationshipConfidenceResult = {
  endpointConfidence: number;
  rawConfidence: number;
  confidence: number;
  eligible: boolean;
};

function validateScore(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} confidence score must be finite and within 0..1`);
  }
}

export function stabilizeRelationshipConfidence(value: number): number {
  return Number(value.toFixed(12));
}

export function publicRelationshipConfidence(value: number): number {
  return Number(value.toFixed(3));
}

export function computeRelationshipConfidence(
  input: RelationshipConfidenceInput,
): RelationshipConfidenceResult {
  validateScore("source", input.sourceConfidence);
  validateScore("target", input.targetConfidence);
  validateScore("rule match", input.ruleMatchScore);
  validateScore("evidence", input.evidenceScore);
  validateScore("consistency", input.consistencyScore);
  if (typeof input.hardGatePassed !== "boolean") {
    throw new Error("hardGatePassed must be boolean");
  }
  const endpointConfidence = Math.min(
    input.sourceConfidence,
    input.targetConfidence,
  );
  const weighted = endpointConfidence * 0.4 +
    input.ruleMatchScore * 0.3 +
    input.evidenceScore * 0.2 +
    input.consistencyScore * 0.1;
  const rawConfidence = stabilizeRelationshipConfidence(
    Math.min(endpointConfidence, weighted),
  );
  return {
    endpointConfidence,
    rawConfidence,
    confidence: publicRelationshipConfidence(rawConfidence),
    eligible: input.hardGatePassed && rawConfidence >= 0.6,
  };
}
