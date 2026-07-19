import { computeElectricalConfidence } from "./confidence.js";
import type {
  BuildElectricalObjectsInput,
  ElectricalConfidenceComponents,
  ElectricalObjectCandidate,
  ElectricalObjectRule,
  ElectricalObjectType,
} from "./types.js";

const OBJECT_TYPES = new Set<ElectricalObjectType>([
  "lighting",
  "outlet",
  "panel",
  "breaker",
  "transformer",
  "ground",
  "cable",
  "conduit",
  "equipment",
  "annotation",
  "unknown",
]);

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const canonical = value.map(canonicalValue);
    return canonical.every((entry) => typeof entry === "string")
      ? [...canonical].sort((left, right) =>
        compareCodepoints(left as string, right as string)
      )
      : canonical;
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodepoints(left, right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(compareCodepoints);
}

export function canonicalizeElectricalCandidate(
  candidate: ElectricalObjectCandidate,
  context: BuildElectricalObjectsInput,
): ElectricalObjectCandidate {
  void context;
  return {
    ...candidate,
    primaryPrimitiveIds: canonicalStrings(candidate.primaryPrimitiveIds),
    supportingPrimitiveIds: canonicalStrings(candidate.supportingPrimitiveIds),
    contextPrimitiveIds: canonicalStrings(candidate.contextPrimitiveIds),
    labelIds: canonicalStrings(candidate.labelIds),
    sourceRelationIds: canonicalStrings(candidate.sourceRelationIds),
    attributes: canonicalValue(candidate.attributes) as Record<string, unknown>,
    diagnostics: canonicalValue(candidate.diagnostics) as Record<string, unknown>,
  };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label} ID in electrical candidate`);
  }
}

function assertUnitScore(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Candidate ${label} score must be finite and within 0..1`);
  }
}

function confidenceComponents(
  candidate: ElectricalObjectCandidate,
): ElectricalConfidenceComponents {
  return {
    structural: candidate.structuralScore,
    label: candidate.labelScore,
    spatial: candidate.spatialScore,
    attribute: candidate.attributeScore,
    consistency: candidate.consistencyScore,
  };
}

export function validateElectricalCandidateConfidence(
  candidate: ElectricalObjectCandidate,
): ReturnType<typeof computeElectricalConfidence> {
  assertUnitScore(candidate.confidence, "confidence");
  const computed = computeElectricalConfidence(confidenceComponents(candidate));
  if (
    candidate.confidence !== computed.rawConfidence ||
    Object.is(candidate.confidence, -0)
  ) {
    throw new Error(
      `Candidate ${candidate.id} confidence does not match component-derived raw confidence`,
    );
  }
  return computed;
}

export function validateElectricalCandidate(
  candidate: ElectricalObjectCandidate,
  context: BuildElectricalObjectsInput,
): void {
  if (candidate.id.trim().length === 0) throw new Error("Candidate ID is required");
  if (candidate.ruleId.trim().length === 0) throw new Error("Candidate ruleId is required");
  if (!OBJECT_TYPES.has(candidate.type)) throw new Error("Candidate type is invalid");
  if (!Number.isFinite(candidate.priority)) throw new Error("Candidate priority must be finite");
  for (const [label, score] of [
    ["structural", candidate.structuralScore],
    ["label", candidate.labelScore],
    ["spatial", candidate.spatialScore],
    ["attribute", candidate.attributeScore],
    ["consistency", candidate.consistencyScore],
  ] as const) assertUnitScore(score, label);
  validateElectricalCandidateConfidence(candidate);

  const roles = [
    ["primary primitive", candidate.primaryPrimitiveIds],
    ["supporting primitive", candidate.supportingPrimitiveIds],
    ["context primitive", candidate.contextPrimitiveIds],
  ] as const;
  const roleIds = new Set<string>();
  for (const [label, values] of roles) {
    assertUnique(values, label);
    for (const value of values) {
      if (roleIds.has(value)) {
        throw new Error(`Primitive ${value} is assigned to duplicate candidate roles`);
      }
      roleIds.add(value);
    }
  }
  assertUnique(candidate.labelIds, "label");
  assertUnique(candidate.sourceRelationIds, "relation");

  const primitiveIds = new Set(context.primitive.primitives.map(({ id }) => id));
  const textIds = new Set([
    ...context.layout.items.map(({ id }) => id),
    ...context.layout.lines.map(({ id }) => id),
  ]);
  const relationIds = new Set(context.spatial.relations.map(({ id }) => id));
  for (const id of roleIds) {
    if (!primitiveIds.has(id)) throw new Error(`Missing primitive reference: ${id}`);
  }
  for (const id of candidate.labelIds) {
    if (!textIds.has(id)) throw new Error(`Missing text label reference: ${id}`);
  }
  for (const id of candidate.sourceRelationIds) {
    if (!relationIds.has(id)) throw new Error(`Missing relation reference: ${id}`);
  }
  if (candidate.hardGatePassed && candidate.primaryPrimitiveIds.length === 0) {
    throw new Error("Hard-gated candidate requires a primary primitive");
  }
}

export function validateElectricalRule(rule: unknown): asserts rule is ElectricalObjectRule {
  if (typeof rule !== "object" || rule === null) {
    throw new Error("Electrical rule must be an object");
  }
  const value = rule as Partial<ElectricalObjectRule>;
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error("Electrical rule ID is required");
  }
  if (typeof value.type !== "string" || !OBJECT_TYPES.has(value.type as ElectricalObjectType)) {
    throw new Error("Electrical rule type is invalid");
  }
  if (!Number.isFinite(value.priority)) {
    throw new Error("Electrical rule priority must be finite");
  }
  if (typeof value.generate !== "function") {
    throw new Error("Electrical rule generate function is required");
  }
}

export function runElectricalObjectRules(
  rules: readonly unknown[],
  context: BuildElectricalObjectsInput,
): ElectricalObjectCandidate[] {
  const candidates: ElectricalObjectCandidate[] = [];
  const ids = new Set<string>();
  for (const ruleValue of rules) {
    validateElectricalRule(ruleValue);
    const rule = ruleValue;
    const generated = rule.generate(context);
    for (const candidateValue of generated) {
      if (candidateValue.ruleId !== rule.id || candidateValue.type !== rule.type) {
        throw new Error(`Candidate rule/type mismatch for rule ${rule.id}`);
      }
      const candidate = canonicalizeElectricalCandidate(candidateValue, context);
      validateElectricalCandidate(candidate, context);
      if (ids.has(candidate.id)) throw new Error(`Duplicate candidate ID: ${candidate.id}`);
      ids.add(candidate.id);
      candidates.push(candidate);
    }
  }
  return candidates.sort((left, right) => compareCodepoints(left.id, right.id));
}
