import type {
  ElectricalConfidenceComponents,
  ElectricalObjectStatus,
} from "./types.js";

const WEIGHTS: ElectricalConfidenceComponents = {
  structural: 0.3,
  label: 0.3,
  spatial: 0.25,
  attribute: 0.1,
  consistency: 0.05,
};

function validateUnitValue(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} score must be finite and within 0..1`);
  }
}

function canonicalNumber(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function computeElectricalConfidence(
  scores: ElectricalConfidenceComponents,
  penalties: readonly number[] = [],
): { rawConfidence: number; confidence: number } {
  for (const [key, value] of Object.entries(scores)) {
    validateUnitValue(value, key);
  }
  for (const penalty of penalties) {
    if (!Number.isFinite(penalty) || penalty < 0) {
      throw new Error("Confidence penalty must be finite and non-negative");
    }
  }
  const weighted = Object.entries(WEIGHTS).reduce(
    (total, [key, weight]) =>
      total + scores[key as keyof ElectricalConfidenceComponents] * weight,
    0,
  );
  const raw = Math.max(0, Math.min(1, weighted - penalties.reduce(
    (total, penalty) => total + penalty,
    0,
  )));
  const stableRaw = Math.round((raw + Number.EPSILON) * 1e12) / 1e12;
  const rawConfidence = Object.is(stableRaw, -0) ? 0 : stableRaw;
  return { rawConfidence, confidence: canonicalNumber(rawConfidence) };
}

export function electricalObjectStatus(
  rawConfidence: number,
): ElectricalObjectStatus | null {
  validateUnitValue(rawConfidence, "raw confidence");
  if (rawConfidence >= 0.8) return "accepted";
  if (rawConfidence >= 0.6) return "review";
  return null;
}

export { canonicalNumber };
