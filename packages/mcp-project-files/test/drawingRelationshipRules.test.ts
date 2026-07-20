import { describe, expect, it } from "vitest";

import {
  deepFreezeInferenceFixture,
  importRelationshipInferenceModule,
  makeRelationshipCandidate,
  makeRelationshipInferenceDocument,
  makeRelationshipRule,
  type RelationshipCandidateFixture,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type RuleModule = {
  createConnectedToRelationshipRule(): unknown;
  validateRelationshipRule(rule: unknown): void;
  runRelationshipRules(
    rules: readonly unknown[],
    document: unknown,
  ): RelationshipCandidateFixture[];
};

async function load() {
  return importRelationshipInferenceModule<RuleModule>("rules");
}

describe("electrical relationship rule contract", () => {
  it.each([
    [{ id: "", relationshipType: "CONNECTED_TO", priority: 1 }, /id|rule/i],
    [{ id: "rule-a", relationshipType: "INVALID", priority: 1 }, /type|enum|relationship/i],
    [{ id: "rule-a", relationshipType: "CONNECTED_TO", priority: Number.NaN }, /priority|finite/i],
    [{ id: "rule-a", relationshipType: "CONNECTED_TO", priority: 1, generate: 1 }, /generate|function/i],
  ])("rejects malformed rule metadata %#", async (rule, message) => {
    const { validateRelationshipRule } = await load();
    expect(() => validateRelationshipRule({
      generate: () => [],
      ...rule,
    })).toThrow(message);
  });

  it("rejects duplicate rule IDs before execution", async () => {
    const { runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const rule = makeRelationshipRule(document);
    expect(() => runRelationshipRules([rule, { ...rule }], document)).toThrow(
      /duplicate|rule|id/i,
    );
  });

  it("rejects malformed rule output at the rule boundary", async () => {
    const { runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const rule = makeRelationshipRule(document, {
      generate: () => [{ relationshipType: "CONNECTED_TO" }],
    });
    expect(() => runRelationshipRules([rule], document)).toThrow(
      /candidate|rule|malformed|invalid/i,
    );
  });

  it("rejects rule ID and relationship type mismatches in generated candidates", async () => {
    const { runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const rule = makeRelationshipRule(document, {
      id: "rule-a",
      relationshipType: "CONNECTED_TO",
      generate: () => [makeRelationshipCandidate(document, {
        ruleId: "rule-b",
        relationshipType: "CONNECTED_VIA",
      })],
    });
    expect(() => runRelationshipRules([rule], document)).toThrow(
      /rule|relationship.*type|mismatch/i,
    );
  });

  it("executes independent rules deterministically", async () => {
    const { runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidateA = makeRelationshipCandidate(document, {
      ruleId: "rule-a",
    });
    const candidateB = makeRelationshipCandidate(document, {
      ruleId: "rule-b",
      relationshipType: "REFERENCES",
    });
    const rules = [
      makeRelationshipRule(document, {
        id: "rule-b",
        relationshipType: "REFERENCES",
        generate: () => [candidateB],
      }),
      makeRelationshipRule(document, {
        id: "rule-a",
        generate: () => [candidateA],
      }),
    ];
    expect(runRelationshipRules(rules, document)).toEqual(
      runRelationshipRules([...rules].reverse(), document),
    );
    expect(runRelationshipRules(rules, document).map((value) => value.candidateId))
      .toEqual([candidateA.candidateId, candidateB.candidateId].sort());
  });

  it("creates one CONNECTED_TO candidate from explicit endpoint-contact evidence", async () => {
    const { createConnectedToRelationshipRule, runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidates = runRelationshipRules(
      [createConnectedToRelationshipRule()],
      document,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      relationshipType: "CONNECTED_TO",
      sourceObjectId: "a".repeat(24),
      targetObjectId: "b".repeat(24),
      hardGatePassed: true,
    });
    expect(candidates[0].evidenceIds).toEqual([
      `graph-edge:${document.constructionGraph.edges.find(
        (edge) => edge.type === "endpoint-contact",
      )?.id}`,
    ]);
  });

  it("does not infer a candidate from an unsupported bbox-touch pair", async () => {
    const { createConnectedToRelationshipRule, runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidates = runRelationshipRules(
      [createConnectedToRelationshipRule()],
      document,
    );
    expect(candidates).not.toContainEqual(expect.objectContaining({
      sourceObjectId: "b".repeat(24),
      targetObjectId: "c".repeat(24),
    }));
  });

  it("propagates rule programmer errors instead of hiding them", async () => {
    const { runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const failure = new Error("synthetic inference rule failure");
    const rule = makeRelationshipRule(document, {
      generate: () => {
        throw failure;
      },
    });
    expect(() => runRelationshipRules([rule], document)).toThrow(failure);
  });

  it("does not mutate frozen documents, rules, or generated candidates", async () => {
    const { runRelationshipRules } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidates = [makeRelationshipCandidate(document)];
    const rules = [makeRelationshipRule(document, {
      generate: () => candidates,
    })];
    const before = structuredClone({ document, candidates });
    deepFreezeInferenceFixture(document);
    deepFreezeInferenceFixture(candidates);
    deepFreezeInferenceFixture(rules);
    runRelationshipRules(rules, document);
    expect({ document, candidates }).toEqual(before);
  });
});
