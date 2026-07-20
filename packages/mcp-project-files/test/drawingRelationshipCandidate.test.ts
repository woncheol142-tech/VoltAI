import { describe, expect, it } from "vitest";

import {
  deepFreezeInferenceFixture,
  importRelationshipInferenceModule,
  makeRelationshipCandidate,
  makeRelationshipInferenceDocument,
  type RelationshipCandidateFixture,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type CandidateModule = {
  canonicalizeRelationshipCandidate(
    candidate: unknown,
    document: unknown,
  ): RelationshipCandidateFixture;
  createRelationshipCandidateId(candidate: unknown): string;
  validateRelationshipCandidate(candidate: unknown, document: unknown): void;
};

async function load() {
  return importRelationshipInferenceModule<CandidateModule>("candidate");
}

describe("electrical relationship candidate contract", () => {
  it("accepts the complete candidate shape without exposing final document state", async () => {
    const { canonicalizeRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidate = canonicalizeRelationshipCandidate(
      makeRelationshipCandidate(document),
      document,
    );
    expect(candidate).toMatchObject({
      candidateId: expect.stringMatching(/^[a-f0-9]{24}$/u),
      ruleId: "synthetic.connected-to",
      priority: 100,
      relationshipType: "CONNECTED_TO",
      hardGatePassed: true,
      confidenceComponents: {
        endpoint: 1,
        ruleMatch: 1,
        evidence: 1,
        consistency: 1,
      },
    });
    expect(candidate).not.toHaveProperty("relationshipId");
    expect(candidate).not.toHaveProperty("schemaVersion");
  });

  it.each([
    ["candidateId", "", /candidate|id/i],
    ["ruleId", "", /rule|id/i],
    ["priority", Number.NaN, /priority|finite/i],
    ["spatialSpecificity", Number.POSITIVE_INFINITY, /specificity|finite/i],
  ])("rejects malformed %s", async (field, value, message) => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidate = makeRelationshipCandidate(document);
    Reflect.set(candidate, field, value);
    expect(() => validateRelationshipCandidate(candidate, document)).toThrow(message);
  });

  it("rejects missing source and target object references", async () => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { sourceObjectId: "missing" }),
      document,
    )).toThrow(/source|object|reference|missing/i);
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { targetObjectId: "missing" }),
      document,
    )).toThrow(/target|object|reference|missing/i);
  });

  it.each([
    "CONNECTED_TO",
    "CONNECTED_VIA",
    "CONTAINS",
    "BELONGS_TO",
    "REFERENCES",
    "UNKNOWN",
  ] as const)("rejects self relationship candidates for %s", async (relationshipType) => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const objectId = document.objects[0].id;
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, {
        relationshipType,
        sourceObjectId: objectId,
        targetObjectId: objectId,
      }),
      document,
    )).toThrow(/self|source|target|distinct/i);
  });

  it("canonicalizes symmetric endpoints and evidence by codepoint order", async () => {
    const { canonicalizeRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const endpointEdge = document.constructionGraph.edges.find(
      (edge) => edge.type === "endpoint-contact",
    );
    const evidenceIds = [
      `graph-edge:${endpointEdge?.id ?? "missing-endpoint-edge"}`,
      `spatial:${endpointEdge?.sourceRelationIds[0] ?? "missing-source-relation"}`,
    ];
    const candidate = makeRelationshipCandidate(document, {
      sourceObjectId: "b".repeat(24),
      targetObjectId: "a".repeat(24),
      evidenceIds: [...evidenceIds].reverse(),
    });
    const canonical = canonicalizeRelationshipCandidate(candidate, document);
    expect(canonical.sourceObjectId).toBe("a".repeat(24));
    expect(canonical.targetObjectId).toBe("b".repeat(24));
    expect(canonical.evidenceIds).toEqual([...evidenceIds].sort());
  });

  it.each(["CONTAINS", "BELONGS_TO", "REFERENCES"] as const)(
    "preserves directed endpoint order for %s",
    async (relationshipType) => {
      const { canonicalizeRelationshipCandidate } = await load();
      const document = makeRelationshipInferenceDocument();
      const candidate = makeRelationshipCandidate(document, {
        relationshipType,
        sourceObjectId: "b".repeat(24),
        targetObjectId: "a".repeat(24),
      });
      expect(canonicalizeRelationshipCandidate(candidate, document)).toMatchObject({
        sourceObjectId: "b".repeat(24),
        targetObjectId: "a".repeat(24),
      });
    },
  );

  it("rejects duplicate and unknown evidence references", async () => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const evidenceId = `graph-edge:${document.constructionGraph.edges[0].id}`;
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { evidenceIds: [evidenceId, evidenceId] }),
      document,
    )).toThrow(/evidence|duplicate/i);
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { evidenceIds: ["primitive:missing-evidence"] }),
      document,
    )).toThrow(/evidence|missing|reference/i);
  });

  it.each([
    ["Date", new Date("2026-01-01T00:00:00.000Z")],
    ["Map", new Map([["key", "value"]])],
    ["function", () => "value"],
    ["symbol", Symbol("value")],
  ])("rejects non-JSON-safe %s candidate values", async (_name, invalid) => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { attributes: { invalid } }),
      document,
    )).toThrow(/attribute|json|plain|serializ/i);
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { diagnostics: { invalid } }),
      document,
    )).toThrow(/diagnostic|json|plain|serializ/i);
  });

  it("rejects cyclic candidate attributes", async () => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const attributes: Record<string, unknown> = {};
    attributes.self = attributes;
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { attributes }),
      document,
    )).toThrow(/attribute|cycle|json|serializ/i);
  });

  it("rejects raw and public confidence inconsistent with components", async () => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { rawConfidence: 0.9 }),
      document,
    )).toThrow(/raw.*confidence|component|mismatch/i);
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, { confidence: 0.9 }),
      document,
    )).toThrow(/confidence|round|mismatch/i);
  });

  it("rejects endpoint confidence inconsistent with source and target objects", async () => {
    const { validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    expect(() => validateRelationshipCandidate(
      makeRelationshipCandidate(document, {
        confidenceComponents: {
          endpoint: 0.5,
          ruleMatch: 1,
          evidence: 1,
          consistency: 1,
        },
        rawConfidence: 0.5,
        confidence: 0.5,
      }),
      document,
    )).toThrow(/endpoint|object.*confidence|mismatch/i);
  });

  it("derives candidate identity independent of symmetric endpoint and evidence order", async () => {
    const { createRelationshipCandidateId } = await load();
    const document = makeRelationshipInferenceDocument();
    const first = makeRelationshipCandidate(document, {
      candidateId: "ignored-a",
      evidenceIds: ["evidence-z", "evidence-a"],
    });
    const second = {
      ...structuredClone(first),
      candidateId: "ignored-b",
      sourceObjectId: first.targetObjectId,
      targetObjectId: first.sourceObjectId,
      evidenceIds: [...first.evidenceIds].reverse(),
    };
    expect(createRelationshipCandidateId(first)).toMatch(/^[a-f0-9]{24}$/u);
    expect(createRelationshipCandidateId(second)).toBe(
      createRelationshipCandidateId(first),
    );
  });

  it("changes candidate identity when rule or evidence identity changes", async () => {
    const { createRelationshipCandidateId } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidate = makeRelationshipCandidate(document);
    expect(createRelationshipCandidateId({ ...candidate, ruleId: "rule-b" }))
      .not.toBe(createRelationshipCandidateId(candidate));
    expect(createRelationshipCandidateId({
      ...candidate,
      evidenceIds: ["different-evidence"],
    })).not.toBe(createRelationshipCandidateId(candidate));
  });

  it("does not mutate deep-frozen candidates or input documents", async () => {
    const { canonicalizeRelationshipCandidate, validateRelationshipCandidate } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidate = makeRelationshipCandidate(document);
    const before = structuredClone({ document, candidate });
    deepFreezeInferenceFixture(document);
    deepFreezeInferenceFixture(candidate);
    validateRelationshipCandidate(candidate, document);
    canonicalizeRelationshipCandidate(candidate, document);
    expect({ document, candidate }).toEqual(before);
  });
});
