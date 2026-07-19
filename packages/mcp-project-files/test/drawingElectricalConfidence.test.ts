import { describe, expect, it } from "vitest";

import { importElectricalModule } from "./helpers/drawingElectricalObjectsFixture.js";

type Scores = {
  structural: number;
  label: number;
  spatial: number;
  attribute: number;
  consistency: number;
};

type ConfidenceModule = {
  computeElectricalConfidence(
    scores: Scores,
    penalties?: readonly number[],
  ): { rawConfidence: number; confidence: number };
  electricalObjectStatus(rawConfidence: number): "accepted" | "review" | null;
};

async function load() {
  return importElectricalModule<ConfidenceModule>("confidence");
}

const scores = (value: number): Scores => ({
  structural: value,
  label: value,
  spatial: value,
  attribute: value,
  consistency: value,
});

describe("electrical confidence and status policy", () => {
  it.each([[1, 1], [0, 0]])("maps all-%s scores to confidence %s", async (value, expected) => {
    const { computeElectricalConfidence } = await load();
    expect(computeElectricalConfidence(scores(value))).toEqual({
      rawConfidence: expected,
      confidence: expected,
    });
  });

  it("uses the approved weighted sum", async () => {
    const { computeElectricalConfidence } = await load();
    expect(computeElectricalConfidence({
      structural: 1,
      label: 0.5,
      spatial: 0.8,
      attribute: 0.25,
      consistency: 0,
    })).toEqual({ rawConfidence: 0.675, confidence: 0.675 });
  });

  it("rounds public confidence to three decimals but uses raw status thresholds", async () => {
    const { computeElectricalConfidence, electricalObjectStatus } = await load();
    const result = computeElectricalConfidence({
      structural: 1,
      label: 1,
      spatial: 0.7984,
      attribute: 0,
      consistency: 0,
    });
    expect(result.rawConfidence).toBeCloseTo(0.7996, 10);
    expect(result.confidence).toBe(0.8);
    expect(electricalObjectStatus(result.rawConfidence)).toBe("review");
  });

  it.each([
    [0.8, "accepted"],
    [0.799_999, "review"],
    [0.6, "review"],
    [0.599_999, null],
  ] as const)("maps raw confidence %s to %s", async (value, expected) => {
    const { electricalObjectStatus } = await load();
    expect(electricalObjectStatus(value)).toBe(expected);
  });

  it("applies penalties then clamps to zero", async () => {
    const { computeElectricalConfidence } = await load();
    expect(computeElectricalConfidence(scores(0.1), [0.15, 0.2])).toEqual({
      rawConfidence: 0,
      confidence: 0,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    "rejects invalid component score %s",
    async (value) => {
      const { computeElectricalConfidence } = await load();
      expect(() =>
        computeElectricalConfidence({ ...scores(1), spatial: value })
      ).toThrow(/score|finite|range/i);
    },
  );

  it("never exposes negative zero", async () => {
    const { computeElectricalConfidence } = await load();
    const result = computeElectricalConfidence(scores(0), [0]);
    expect(Object.is(result.rawConfidence, -0)).toBe(false);
    expect(Object.is(result.confidence, -0)).toBe(false);
  });
});
