import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  deepFreeze,
  importElectricalModule,
  makeElectricalCandidate,
} from "./helpers/drawingElectricalObjectsFixture.js";

type CandidateModule = {
  canonicalizeElectricalCandidate(candidate: unknown, context: unknown): unknown;
  validateElectricalCandidate(candidate: unknown, context: unknown): void;
  validateElectricalRule(rule: unknown): void;
  runElectricalObjectRules(rules: readonly unknown[], context: unknown): unknown[];
};

async function load() {
  return importElectricalModule<CandidateModule>("candidate");
}

describe("electrical object candidate and rule contract", () => {
  it("keeps candidate state separate from final object status and persistence", async () => {
    const { canonicalizeElectricalCandidate } = await load();
    const candidate = canonicalizeElectricalCandidate(
      makeElectricalCandidate(),
      createElectricalConstructionFixture(),
    );
    expect(candidate).not.toHaveProperty("status");
    expect(candidate).not.toHaveProperty("schemaVersion");
    expect(candidate).not.toHaveProperty("relativeElectricalObjectPath");
  });

  it("canonicalizes primitive, label, relation, and attribute evidence order", async () => {
    const { canonicalizeElectricalCandidate } = await load();
    const context = createElectricalConstructionFixture();
    const first = makeElectricalCandidate({
      primaryPrimitiveIds: ["primitive-overlap", "primitive-container"],
      labelIds: ["item-overlap", "item-inside"],
      sourceRelationIds: ["relation-z", "relation-a"],
    });
    const second = structuredClone(first);
    second.primaryPrimitiveIds.reverse();
    second.labelIds.reverse();
    second.sourceRelationIds.reverse();
    expect(canonicalizeElectricalCandidate(second, context)).toEqual(
      canonicalizeElectricalCandidate(first, context),
    );
  });

  it("rejects candidate confidence that differs from its component-derived raw confidence", async () => {
    const { validateElectricalCandidate } = await load();
    const context = createElectricalConstructionFixture();
    const candidate = makeElectricalCandidate({ confidence: 0.7 });
    const before = structuredClone(candidate);
    deepFreeze(candidate);
    expect(() => validateElectricalCandidate(candidate, context)).toThrow(
      /confidence.*component|confidence.*mismatch/i,
    );
    expect(candidate).toEqual(before);
  });

  it("accepts only the existing 1e-12-stabilized raw confidence", async () => {
    const { validateElectricalCandidate } = await load();
    const context = createElectricalConstructionFixture();
    const floatingScore = 0.1 + 0.2;
    const candidate = makeElectricalCandidate({
      structuralScore: floatingScore,
      labelScore: floatingScore,
      spatialScore: floatingScore,
      attributeScore: floatingScore,
      consistencyScore: floatingScore,
      confidence: 0.3,
    });
    deepFreeze(candidate);
    expect(() => validateElectricalCandidate(candidate, context)).not.toThrow();
  });

  it("rejects a primitive assigned to more than one candidate role", async () => {
    const { validateElectricalCandidate } = await load();
    const candidate = makeElectricalCandidate({
      primaryPrimitiveIds: ["primitive-container"],
      supportingPrimitiveIds: ["primitive-container"],
    });
    expect(() =>
      validateElectricalCandidate(candidate, createElectricalConstructionFixture())
    ).toThrow(/role|duplicate|primitive/i);
  });

  it("rejects missing candidate references", async () => {
    const { validateElectricalCandidate } = await load();
    const context = createElectricalConstructionFixture();
    expect(() =>
      validateElectricalCandidate(
        makeElectricalCandidate({ primaryPrimitiveIds: ["missing"] }),
        context,
      )
    ).toThrow(/missing|primitive|reference/i);
  });

  it("rejects candidate rule and type mismatches at the rule boundary", async () => {
    const { runElectricalObjectRules } = await load();
    const context = createElectricalConstructionFixture();
    expect(() =>
      runElectricalObjectRules(
        [{
          id: "synthetic.panel",
          type: "panel",
          priority: 1,
          generate: () => [makeElectricalCandidate({
            ruleId: "synthetic.breaker",
            type: "breaker",
          })],
        }],
        context,
      )
    ).toThrow(/rule|type|mismatch/i);
  });

  it("represents keyword-only candidates as failed hard gates, not accepted objects", async () => {
    const { canonicalizeElectricalCandidate } = await load();
    const candidate = canonicalizeElectricalCandidate(
      makeElectricalCandidate({
        primaryPrimitiveIds: [],
        hardGatePassed: false,
        structuralScore: 0,
        labelScore: 1,
      }),
      createElectricalConstructionFixture(),
    );
    expect(candidate).toMatchObject({ hardGatePassed: false });
    expect(candidate).not.toHaveProperty("status");
  });

  it.each([
    [{ id: "", type: "breaker", priority: 1 }, /id|rule/i],
    [{ id: "   ", type: "breaker", priority: 1 }, /id|rule/i],
    [{ id: "synthetic.breaker", type: "breaker", priority: Number.NaN }, /priority|finite/i],
  ])("rejects invalid synthetic rule metadata", async (rule, message) => {
    const { validateElectricalRule } = await load();
    expect(() => validateElectricalRule({ ...rule, generate: () => [] })).toThrow(
      message,
    );
  });

  it("fails fast when a rule throws instead of hiding programmer errors", async () => {
    const { runElectricalObjectRules } = await load();
    const failure = new Error("synthetic rule failure");
    expect(() =>
      runElectricalObjectRules(
        [{ id: "synthetic.breaker", type: "breaker", priority: 1, generate: () => { throw failure; } }],
        createElectricalConstructionFixture(),
      )
    ).toThrow(failure);
  });

  it("canonicalizes shuffled rule output and rejects duplicate candidate IDs", async () => {
    const { runElectricalObjectRules } = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [
      makeElectricalCandidate({ id: "candidate-b" }),
      makeElectricalCandidate({ id: "candidate-a", primaryPrimitiveIds: ["primitive-overlap"] }),
    ];
    const rule = {
      id: "synthetic.breaker",
      type: "breaker",
      priority: 1,
      generate: () => [...candidates].reverse(),
    };
    expect(runElectricalObjectRules([rule], context)).toEqual(
      runElectricalObjectRules([{ ...rule, generate: () => candidates }], context),
    );
    expect(() =>
      runElectricalObjectRules(
        [{ ...rule, generate: () => [candidates[0], candidates[0]] }],
        context,
      )
    ).toThrow(/candidate|duplicate|id/i);
  });

  it("does not mutate frozen context, rules, or candidates", async () => {
    const { runElectricalObjectRules } = await load();
    const context = createElectricalConstructionFixture();
    const candidates = [makeElectricalCandidate()];
    const rules = [{
      id: "synthetic.breaker",
      type: "breaker",
      priority: 1,
      generate: () => candidates,
    }];
    const before = structuredClone(context);
    deepFreeze(context);
    deepFreeze(candidates);
    deepFreeze(rules);
    expect(() => runElectricalObjectRules(rules, context)).not.toThrow();
    expect(context).toEqual(before);
  });
});
