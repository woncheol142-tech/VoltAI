import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  deepFreeze,
  importElectricalModule,
  makeElectricalCandidate,
} from "./helpers/drawingElectricalObjectsFixture.js";

type Resolution = {
  acceptedCandidates: Array<{ id: string }>;
  reviewCandidates: Array<{ id: string }>;
  excludedCandidates: Array<{ id: string; diagnostics: unknown }>;
  conflicts: Array<{ winnerId: string; loserId: string; reason: string }>;
};

type ResolverModule = {
  resolveElectricalObjectCandidates(
    candidates: readonly unknown[],
    context: unknown,
  ): Resolution;
};

async function load() {
  return importElectricalModule<ResolverModule>("resolveCandidates");
}

function ids(values: Array<{ id: string }>): string[] {
  return values.map((value) => value.id);
}

function makeCandidateAtConfidence(
  confidence: number,
  overrides: Parameters<typeof makeElectricalCandidate>[0] = {},
) {
  return makeElectricalCandidate({
    ...overrides,
    structuralScore: confidence,
    labelScore: confidence,
    spatialScore: confidence,
    attributeScore: confidence,
    consistencyScore: confidence,
    confidence,
  });
}

describe("electrical candidate conflict resolver contract", () => {
  it("rejects confidence whose components select a different resolver status band", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const candidate = makeElectricalCandidate({ confidence: 0.7 });
    expect(() => resolveElectricalObjectCandidates(
      [candidate],
      createElectricalConstructionFixture(),
    )).toThrow(/confidence.*component|confidence.*mismatch/i);
  });

  it("allows only one accepted owner of a primary primitive", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const result = resolveElectricalObjectCandidates([
      makeElectricalCandidate({ id: "candidate-low", priority: 10 }),
      makeElectricalCandidate({ id: "candidate-high", priority: 20 }),
    ], createElectricalConstructionFixture());
    expect(ids(result.acceptedCandidates)).toEqual(["candidate-high"]);
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      winnerId: "candidate-high",
      loserId: "candidate-low",
    }));
  });

  it("shares supporting primitives only when both candidates permit it", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const context = createElectricalConstructionFixture();
    const shared = [
      makeElectricalCandidate({
        id: "candidate-a",
        primaryPrimitiveIds: ["primitive-container"],
        supportingPrimitiveIds: ["primitive-overlap"],
        shareSupportingPrimitives: true,
      }),
      makeElectricalCandidate({
        id: "candidate-b",
        primaryPrimitiveIds: ["primitive-inside"],
        supportingPrimitiveIds: ["primitive-overlap"],
        shareSupportingPrimitives: true,
      }),
    ];
    expect(ids(resolveElectricalObjectCandidates(shared, context).acceptedCandidates))
      .toEqual(["candidate-a", "candidate-b"]);
    shared[1] = { ...shared[1], shareSupportingPrimitives: false };
    expect(resolveElectricalObjectCandidates(shared, context).conflicts)
      .toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/support/i) }));
  });

  it("does not create ownership conflicts for context primitives", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const result = resolveElectricalObjectCandidates([
      makeElectricalCandidate({
        id: "candidate-a",
        primaryPrimitiveIds: ["primitive-container"],
        contextPrimitiveIds: ["primitive-overlap"],
      }),
      makeElectricalCandidate({
        id: "candidate-b",
        primaryPrimitiveIds: ["primitive-inside"],
        contextPrimitiveIds: ["primitive-overlap"],
      }),
    ], createElectricalConstructionFixture());
    expect(ids(result.acceptedCandidates)).toEqual(["candidate-a", "candidate-b"]);
    expect(result.conflicts).toEqual([]);
  });

  it("uses the approved deterministic greedy tie-break sequence", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const context = createElectricalConstructionFixture();
    const base = makeCandidateAtConfidence(0.9, {
      id: "candidate-base",
    });
    const cases = [
      [base, makeElectricalCandidate({ id: "winner", priority: 101 })],
      [
        makeElectricalCandidate({ id: "failed", hardGatePassed: false }),
        makeElectricalCandidate({ id: "winner" }),
      ],
      [base, makeCandidateAtConfidence(0.95, { id: "winner" })],
      [
        makeElectricalCandidate({ id: "less-specific", spatialSpecificity: "nearest" }),
        makeElectricalCandidate({ id: "winner", spatialSpecificity: "overlaps" }),
      ],
      [
        makeElectricalCandidate({ id: "inexact", exactLexicalMatch: false }),
        makeElectricalCandidate({ id: "winner", exactLexicalMatch: true }),
      ],
      [
        makeElectricalCandidate({ id: "later", primaryPrimitiveSourceOrder: 2 }),
        makeElectricalCandidate({ id: "winner", primaryPrimitiveSourceOrder: 1 }),
      ],
      [
        makeElectricalCandidate({ id: "candidate-z" }),
        makeElectricalCandidate({ id: "candidate-a" }),
      ],
    ];
    for (const candidates of cases) {
      const result = resolveElectricalObjectCandidates(candidates, context);
      expect(ids(result.acceptedCandidates)).toEqual([
        candidates.some((candidate) => candidate.id === "winner")
          ? "winner"
          : "candidate-a",
      ]);
    }
  });

  it("treats contains and inside as equal highest spatial specificity", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const result = resolveElectricalObjectCandidates([
      makeElectricalCandidate({ id: "candidate-z", spatialSpecificity: "contains" }),
      makeElectricalCandidate({ id: "candidate-a", spatialSpecificity: "inside" }),
    ], createElectricalConstructionFixture());
    expect(ids(result.acceptedCandidates)).toEqual(["candidate-a"]);
  });

  it("routes review confidence separately and excludes values below 0.6", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const context = createElectricalConstructionFixture();
    const result = resolveElectricalObjectCandidates([
      makeCandidateAtConfidence(0.8, {
        id: "accepted",
        primaryPrimitiveIds: ["primitive-container"],
      }),
      makeCandidateAtConfidence(0.6, {
        id: "review",
        primaryPrimitiveIds: ["primitive-inside"],
      }),
      makeCandidateAtConfidence(0.5999, {
        id: "excluded",
        primaryPrimitiveIds: ["primitive-overlap"],
      }),
    ], context);
    expect(ids(result.acceptedCandidates)).toEqual(["accepted"]);
    expect(ids(result.reviewCandidates)).toEqual(["review"]);
    expect(ids(result.excludedCandidates)).toEqual(["excluded"]);
  });

  it("records losing candidates, winner IDs, and deterministic conflict reasons", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const result = resolveElectricalObjectCandidates([
      makeElectricalCandidate({ id: "loser", priority: 1 }),
      makeElectricalCandidate({ id: "winner", priority: 2 }),
    ], createElectricalConstructionFixture());
    expect(result.excludedCandidates).toContainEqual(expect.objectContaining({
      id: "loser",
      diagnostics: expect.any(Object),
    }));
    expect(result.conflicts).toEqual([
      expect.objectContaining({ winnerId: "winner", loserId: "loser" }),
    ]);
  });

  it("fixes greedy conflict-chain behavior independent of input order", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [
      makeElectricalCandidate({
        id: "candidate-a",
        priority: 30,
        primaryPrimitiveIds: ["primitive-container"],
      }),
      makeElectricalCandidate({
        id: "candidate-b",
        priority: 20,
        primaryPrimitiveIds: ["primitive-container", "primitive-inside"],
      }),
      makeElectricalCandidate({
        id: "candidate-c",
        priority: 10,
        primaryPrimitiveIds: ["primitive-inside"],
      }),
    ];
    const forward = resolveElectricalObjectCandidates(candidates, context);
    const reverse = resolveElectricalObjectCandidates([...candidates].reverse(), context);
    expect(forward).toEqual(reverse);
    expect(ids(forward.acceptedCandidates)).toEqual(["candidate-a", "candidate-c"]);
  });

  it("does not mutate frozen context or candidate arrays", async () => {
    const { resolveElectricalObjectCandidates } = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [makeElectricalCandidate(), makeElectricalCandidate({ id: "candidate-b" })];
    const before = structuredClone({ context, candidates });
    deepFreeze(context);
    deepFreeze(candidates);
    resolveElectricalObjectCandidates(candidates, context);
    expect({ context, candidates }).toEqual(before);
  });
});
