import { describe, expect, it } from "vitest";

import {
  deepFreezeInferenceFixture,
  importRelationshipInferenceModule,
  makeRelationshipCandidate,
  makeRelationshipInferenceDocument,
  type RelationshipCandidateFixture,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type CandidateConflict = {
  winnerId: string | null;
  loserId: string;
  reason: string;
};

type Resolution = {
  selectedCandidates: RelationshipCandidateFixture[];
  excludedCandidates: RelationshipCandidateFixture[];
  conflicts: CandidateConflict[];
  warnings: string[];
};

type ResolverModule = {
  resolveRelationshipCandidates(
    candidates: readonly unknown[],
    document: unknown,
  ): Resolution;
};

async function load() {
  return importRelationshipInferenceModule<ResolverModule>(
    "resolveRelationshipCandidates",
  );
}

function candidateAtConfidence(
  document: ReturnType<typeof makeRelationshipInferenceDocument>,
  confidence: number,
  overrides: Partial<RelationshipCandidateFixture> = {},
) {
  const secondaryScore = (confidence - 0.4) / 0.6;
  return makeRelationshipCandidate(document, {
    ...overrides,
    confidenceComponents: {
      endpoint: 1,
      ruleMatch: secondaryScore,
      evidence: secondaryScore,
      consistency: secondaryScore,
    },
    rawConfidence: confidence,
    confidence: Number(confidence.toFixed(3)),
  });
}

describe("electrical relationship candidate resolver contract", () => {
  it("merges duplicate semantic relationships and canonicalizes evidence", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const endpointEdge = document.constructionGraph.edges.find(
      (edge) => edge.type === "endpoint-contact",
    );
    const firstEvidence = `graph-edge:${endpointEdge?.id ?? "missing-endpoint-edge"}`;
    const secondEvidence = `spatial:${endpointEdge?.sourceRelationIds[0]
      ?? "missing-source-relation"}`;
    const candidates = [
      makeRelationshipCandidate(document, {
        ruleId: "rule-b",
        evidenceIds: [secondEvidence],
      }),
      makeRelationshipCandidate(document, {
        ruleId: "rule-a",
        evidenceIds: [firstEvidence],
      }),
    ];
    const result = resolveRelationshipCandidates(candidates, document);
    expect(result.selectedCandidates).toHaveLength(1);
    expect(result.selectedCandidates[0].evidenceIds).toEqual(
      [firstEvidence, secondEvidence].sort(),
    );
    expect(result.conflicts).toHaveLength(1);
  });

  it("treats CONTAINS(A,B) and BELONGS_TO(B,A) as inverse duplicates", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const contains = makeRelationshipCandidate(document, {
      ruleId: "rule-contains",
      priority: 20,
      relationshipType: "CONTAINS",
    });
    const belongs = makeRelationshipCandidate(document, {
      ruleId: "rule-belongs",
      priority: 10,
      relationshipType: "BELONGS_TO",
      sourceObjectId: "b".repeat(24),
      targetObjectId: "a".repeat(24),
    });
    const result = resolveRelationshipCandidates([contains, belongs], document);
    expect(result.selectedCandidates).toEqual([
      expect.objectContaining({ candidateId: contains.candidateId }),
    ]);
    expect(result.excludedCandidates).toEqual([
      expect.objectContaining({ candidateId: belongs.candidateId }),
    ]);
  });

  it("resolves CONNECTED_TO versus CONNECTED_VIA by approved comparator priority", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const connected = makeRelationshipCandidate(document, {
      ruleId: "rule-connected",
      priority: 10,
    });
    const via = makeRelationshipCandidate(document, {
      ruleId: "rule-via",
      priority: 20,
      relationshipType: "CONNECTED_VIA",
    });
    const result = resolveRelationshipCandidates([connected, via], document);
    expect(result.selectedCandidates).toEqual([
      expect.objectContaining({ candidateId: via.candidateId }),
    ]);
  });

  it("allows REFERENCES to coexist with a structural relationship", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const connected = makeRelationshipCandidate(document);
    const reference = makeRelationshipCandidate(document, {
      ruleId: "rule-reference",
      relationshipType: "REFERENCES",
    });
    const result = resolveRelationshipCandidates([connected, reference], document);
    expect(result.selectedCandidates.map((candidate) => candidate.candidateId))
      .toEqual([connected.candidateId, reference.candidateId].sort());
    expect(result.conflicts).toEqual([]);
  });

  it("excludes exact incompatible semantic ties with AMBIGUOUS_RELATIONSHIP", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const connected = makeRelationshipCandidate(document, { ruleId: "rule-a" });
    const via = makeRelationshipCandidate(document, {
      ruleId: "rule-b",
      relationshipType: "CONNECTED_VIA",
    });
    const result = resolveRelationshipCandidates([connected, via], document);
    expect(result.selectedCandidates).toEqual([]);
    expect(result.excludedCandidates.map((candidate) => candidate.candidateId))
      .toEqual([connected.candidateId, via.candidateId].sort());
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/AMBIGUOUS_RELATIONSHIP/u),
    );
  });

  it("uses hard gate, raw confidence, specificity, rule ID, and candidate ID deterministically", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const endpointEdge = document.constructionGraph.edges.find(
      (edge) => edge.type === "endpoint-contact",
    )!;
    const failed = makeRelationshipCandidate(document, {
      ruleId: "rule-a-failed",
      hardGatePassed: false,
    });
    const hardGateWinner = makeRelationshipCandidate(document, {
      ruleId: "rule-z-hard-gate-winner",
    });
    const lowerConfidence = candidateAtConfidence(document, 0.8, {
      ruleId: "rule-a-lower-confidence",
    });
    const confidenceWinner = candidateAtConfidence(document, 0.9, {
      ruleId: "rule-z-confidence-winner",
    });
    const lowerSpecificity = makeRelationshipCandidate(document, {
      ruleId: "rule-a-lower-specificity",
      spatialSpecificity: 1,
    });
    const specificityWinner = makeRelationshipCandidate(document, {
      ruleId: "rule-z-specificity-winner",
      spatialSpecificity: 2,
    });
    const lexicalLoser = makeRelationshipCandidate(document, { ruleId: "rule-z" });
    const lexicalWinner = makeRelationshipCandidate(document, { ruleId: "rule-a" });
    const firstIdentity = makeRelationshipCandidate(document, {
      ruleId: "rule-identity",
      evidenceIds: [`graph-edge:${endpointEdge.id}`],
      attributes: { marker: "first" },
    });
    const secondIdentity = makeRelationshipCandidate(document, {
      ruleId: "rule-identity",
      evidenceIds: [`spatial:${endpointEdge.sourceRelationIds[0]!}`],
      attributes: { marker: "second" },
    });
    const identityWinner = firstIdentity.candidateId < secondIdentity.candidateId
      ? firstIdentity
      : secondIdentity;
    const cases: Array<[
      RelationshipCandidateFixture,
      RelationshipCandidateFixture,
      RelationshipCandidateFixture,
    ]> = [
      [failed, hardGateWinner, hardGateWinner],
      [lowerConfidence, confidenceWinner, confidenceWinner],
      [lowerSpecificity, specificityWinner, specificityWinner],
      [lexicalLoser, lexicalWinner, lexicalWinner],
    ];
    for (const [first, second, winner] of cases) {
      const result = resolveRelationshipCandidates([first, second], document);
      expect(result.selectedCandidates.map((candidate) => candidate.candidateId))
        .toEqual([winner.candidateId]);
    }
    const identityResult = resolveRelationshipCandidates(
      [firstIdentity, secondIdentity],
      document,
    );
    expect(identityResult.selectedCandidates[0]?.attributes).toEqual(
      identityWinner.attributes,
    );
  });

  it("prefers a known relationship over UNKNOWN", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const unknown = makeRelationshipCandidate(document, {
      ruleId: "rule-unknown",
      relationshipType: "UNKNOWN",
    });
    const known = makeRelationshipCandidate(document, { ruleId: "rule-known" });
    const result = resolveRelationshipCandidates([unknown, known], document);
    expect(result.selectedCandidates).toEqual([
      expect.objectContaining({ candidateId: known.candidateId }),
    ]);
  });

  it("excludes failed hard gates and confidence below 0.60", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const failedGate = makeRelationshipCandidate(document, {
      hardGatePassed: false,
    });
    const belowThreshold = candidateAtConfidence(document, 0.5999, {
      sourceObjectId: "b".repeat(24),
      targetObjectId: "c".repeat(24),
      evidenceIds: [`graph-edge:${document.constructionGraph.edges.find(
        (edge) => edge.type === "bbox-touch",
      )!.id}`],
    });
    const result = resolveRelationshipCandidates([
      failedGate,
      belowThreshold,
    ], document);
    expect(result.selectedCandidates).toEqual([]);
    expect(result.excludedCandidates.map((candidate) => candidate.candidateId))
      .toEqual([failedGate.candidateId, belowThreshold.candidateId].sort());
  });

  it("returns byte-stable resolution ordering for shuffled input", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidates = [
      makeRelationshipCandidate(document),
      makeRelationshipCandidate(document, {
        sourceObjectId: "b".repeat(24),
        targetObjectId: "c".repeat(24),
        evidenceIds: [`graph-edge:${document.constructionGraph.edges[1].id}`],
      }),
    ];
    const first = resolveRelationshipCandidates(candidates, document);
    const second = resolveRelationshipCandidates([...candidates].reverse(), document);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("does not mutate deep-frozen documents or candidates", async () => {
    const { resolveRelationshipCandidates } = await load();
    const document = makeRelationshipInferenceDocument();
    const candidates = [makeRelationshipCandidate(document)];
    const before = structuredClone({ document, candidates });
    deepFreezeInferenceFixture(document);
    deepFreezeInferenceFixture(candidates);
    resolveRelationshipCandidates(candidates, document);
    expect({ document, candidates }).toEqual(before);
  });
});
