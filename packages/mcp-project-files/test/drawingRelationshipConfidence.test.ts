import { describe, expect, it } from "vitest";

import {
  deepFreezeInferenceFixture,
  importRelationshipInferenceModule,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type ConfidenceInput = {
  sourceConfidence: number;
  targetConfidence: number;
  ruleMatchScore: number;
  evidenceScore: number;
  consistencyScore: number;
  hardGatePassed: boolean;
};

type ConfidenceResult = {
  endpointConfidence: number;
  rawConfidence: number;
  confidence: number;
  eligible: boolean;
};

type ConfidenceModule = {
  computeRelationshipConfidence(input: ConfidenceInput): ConfidenceResult;
};

async function load() {
  return importRelationshipInferenceModule<ConfidenceModule>("confidence");
}

function makeInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    sourceConfidence: overrides.sourceConfidence ?? 1,
    targetConfidence: overrides.targetConfidence ?? 1,
    ruleMatchScore: overrides.ruleMatchScore ?? 1,
    evidenceScore: overrides.evidenceScore ?? 1,
    consistencyScore: overrides.consistencyScore ?? 1,
    hardGatePassed: overrides.hardGatePassed ?? true,
  };
}

describe("electrical relationship confidence contract", () => {
  it("uses the lower endpoint object confidence", async () => {
    const { computeRelationshipConfidence } = await load();
    expect(computeRelationshipConfidence(makeInput({
      sourceConfidence: 0.9,
      targetConfidence: 0.8,
    }))).toMatchObject({
      endpointConfidence: 0.8,
      rawConfidence: 0.8,
      confidence: 0.8,
    });
  });

  it.each([
    ["endpoint", makeInput({ ruleMatchScore: 0, evidenceScore: 0, consistencyScore: 0 }), 0.4],
    ["ruleMatch", makeInput({ evidenceScore: 0, consistencyScore: 0 }), 0.7],
    ["evidence", makeInput({ sourceConfidence: 1, targetConfidence: 1, ruleMatchScore: 0, consistencyScore: 0 }), 0.6],
    ["consistency", makeInput({ sourceConfidence: 1, targetConfidence: 1, ruleMatchScore: 0, evidenceScore: 0 }), 0.5],
  ])("applies the approved %s weight", async (_name, input, expected) => {
    const { computeRelationshipConfidence } = await load();
    expect(computeRelationshipConfidence(input).rawConfidence).toBe(expected);
  });

  it("applies 0.40/0.30/0.20/0.10 weights before the endpoint cap", async () => {
    const { computeRelationshipConfidence } = await load();
    const result = computeRelationshipConfidence(makeInput({
      sourceConfidence: 1,
      targetConfidence: 1,
      ruleMatchScore: 0.8,
      evidenceScore: 0.5,
      consistencyScore: 0.2,
    }));
    expect(result.rawConfidence).toBe(0.76);
  });

  it("caps relationship confidence at the lower endpoint confidence", async () => {
    const { computeRelationshipConfidence } = await load();
    const result = computeRelationshipConfidence(makeInput({
      sourceConfidence: 0.5,
      targetConfidence: 0.9,
    }));
    expect(result.endpointConfidence).toBe(0.5);
    expect(result.rawConfidence).toBe(0.5);
  });

  it("includes exactly 0.60 and excludes values below the threshold", async () => {
    const { computeRelationshipConfidence } = await load();
    expect(computeRelationshipConfidence(makeInput({
      sourceConfidence: 0.6,
      targetConfidence: 0.6,
    })).eligible).toBe(true);
    expect(computeRelationshipConfidence(makeInput({
      sourceConfidence: 0.5999,
      targetConfidence: 0.5999,
    })).eligible).toBe(false);
  });

  it("excludes a failed hard gate regardless of numeric confidence", async () => {
    const { computeRelationshipConfidence } = await load();
    expect(computeRelationshipConfidence(makeInput({
      hardGatePassed: false,
    }))).toMatchObject({ rawConfidence: 1, confidence: 1, eligible: false });
  });

  it("keeps stabilized raw confidence and rounds the public value to three decimals", async () => {
    const { computeRelationshipConfidence } = await load();
    const result = computeRelationshipConfidence(makeInput({
      sourceConfidence: 0.9,
      targetConfidence: 0.9,
      ruleMatchScore: 0.8,
      evidenceScore: 0.65,
      consistencyScore: 0.696,
    }));
    expect(result.rawConfidence).toBe(0.7996);
    expect(result.confidence).toBe(0.8);
  });

  it("stabilizes floating-point arithmetic deterministically", async () => {
    const { computeRelationshipConfidence } = await load();
    const floating = 0.1 + 0.2;
    const result = computeRelationshipConfidence(makeInput({
      sourceConfidence: floating,
      targetConfidence: floating,
      ruleMatchScore: floating,
      evidenceScore: floating,
      consistencyScore: floating,
    }));
    expect(result.rawConfidence).toBe(0.3);
    expect(result.confidence).toBe(0.3);
  });

  it.each([
    ["sourceConfidence", -0.1],
    ["targetConfidence", 1.1],
    ["ruleMatchScore", Number.NaN],
    ["evidenceScore", Number.POSITIVE_INFINITY],
    ["consistencyScore", Number.NEGATIVE_INFINITY],
  ])("rejects invalid %s", async (field, value) => {
    const { computeRelationshipConfidence } = await load();
    const input = makeInput();
    Reflect.set(input, field, value);
    expect(() => computeRelationshipConfidence(input)).toThrow(
      /confidence|score|finite|range/i,
    );
  });

  it("does not mutate frozen confidence input", async () => {
    const { computeRelationshipConfidence } = await load();
    const input = makeInput({ sourceConfidence: 0.9, targetConfidence: 0.8 });
    const before = structuredClone(input);
    deepFreezeInferenceFixture(input);
    computeRelationshipConfidence(input);
    expect(input).toEqual(before);
  });
});
