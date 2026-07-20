import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildElectricalConstructionGraph,
  type ConstructionGraphEdgeInput,
} from "../src/drawingElectricalObjects/constructionGraph.js";
import type {
  DrawingElectricalObjectDocument,
  ElectricalObject,
} from "../src/drawingElectricalObjects/types.js";
import { serializeElectricalRelationshipDocument } from "../src/drawingElectricalRelationships/serializeElectricalRelationships.js";
import type { ElectricalRelationshipDocument } from "../src/drawingElectricalRelationships/types.js";
import {
  importRelationshipInferenceModule,
  makeRelationshipCandidate,
  makeRelationshipInferenceDocument,
  makeRelationshipRule,
  type RelationshipCandidateFixture,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type Resolution = {
  selectedCandidates: RelationshipCandidateFixture[];
  excludedCandidates: RelationshipCandidateFixture[];
};

type ResolverModule = {
  resolveRelationshipCandidates(
    candidates: readonly unknown[],
    document: unknown,
  ): Resolution;
};

type CandidateModule = {
  canonicalizeRelationshipCandidate(
    candidate: unknown,
    document: unknown,
  ): RelationshipCandidateFixture;
  createRelationshipCandidateId(candidate: unknown): string;
};

type InferenceModule = {
  inferElectricalRelationships(
    document: unknown,
    rules?: readonly unknown[],
  ): ElectricalRelationshipDocument;
};

function canonicalGraphEvidence(edgeId: string): string {
  return `graph-edge:${edgeId}`;
}

function confidenceCandidate(
  document: DrawingElectricalObjectDocument,
  rawConfidence: number,
  confidence: number,
): RelationshipCandidateFixture {
  const secondaryScore = (rawConfidence - 0.4) / 0.6;
  return makeRelationshipCandidate(document, {
    confidenceComponents: {
      endpoint: 1,
      ruleMatch: secondaryScore,
      evidence: secondaryScore,
      consistency: secondaryScore,
    },
    rawConfidence,
    confidence,
  });
}

function collisionDocument(): DrawingElectricalObjectDocument {
  const document = makeRelationshipInferenceDocument();
  const edge = document.constructionGraph.edges.find(
    (candidate) => candidate.type === "endpoint-contact",
  )!;
  document.objects.find((object) => object.id === "c".repeat(24))!
    .primitiveIds.push(edge.id);
  document.objects.find((object) => object.id === "c".repeat(24))!
    .primitiveIds.sort();
  return document;
}

function documentWithFourthObject(): DrawingElectricalObjectDocument {
  const document = makeRelationshipInferenceDocument();
  const fourth = structuredClone(document.objects[2]) as ElectricalObject;
  fourth.id = "d".repeat(24);
  fourth.primitiveIds = ["primitive-d"];
  fourth.labels = fourth.labels.map((label) => ({
    ...label,
    textEntityId: "item-d",
  }));
  fourth.sourceRelationIds = ["spatial-object-d"];
  document.objects.push(fourth);
  document.objectCount = document.objects.length;
  document.statistics.candidateCount = document.objects.length;
  document.statistics.acceptedObjectCount = document.objects.length;
  document.statistics.objectCountByType.breaker = document.objects.length;
  const edgeInputs: ConstructionGraphEdgeInput[] =
    document.constructionGraph.edges.map((edge) => ({
      type: edge.type,
      objectIds: [...edge.objectIds],
      primitiveIds: [...edge.primitiveIds],
      sourceRelationIds: [...edge.sourceRelationIds],
    }));
  document.constructionGraph = buildElectricalConstructionGraph(
    document.objects,
    edgeInputs,
  );
  return document;
}

function viaRule(
  document: DrawingElectricalObjectDocument,
  ruleId: string,
  viaObjectId: string | undefined,
  evidenceIds?: string[],
) {
  const endpointEdge = document.constructionGraph.edges.find(
    (edge) => edge.type === "endpoint-contact",
  )!;
  const attributes = viaObjectId === undefined ? {} : { viaObjectId };
  return makeRelationshipRule(document, {
    id: ruleId,
    relationshipType: "CONNECTED_VIA",
    generate: () => [makeRelationshipCandidate(document, {
      ruleId,
      relationshipType: "CONNECTED_VIA",
      attributes,
      evidenceIds: evidenceIds ?? [canonicalGraphEvidence(endpointEdge.id)],
    })],
  });
}

describe("relationship inference release gate: resolver confidence authority", () => {
  it("rejects 0.5999 public confidence instead of repairing it to 0.600", async () => {
    const { resolveRelationshipCandidates } =
      await importRelationshipInferenceModule<ResolverModule>(
        "resolveRelationshipCandidates",
      );
    const document = makeRelationshipInferenceDocument();
    expect(() => resolveRelationshipCandidates([
      confidenceCandidate(document, 0.5999, 0.5999),
    ], document)).toThrow(/confidence|round|mismatch|canonical/i);
  });

  it("rejects raw/public mismatch and non-finite or out-of-range confidence", async () => {
    const { resolveRelationshipCandidates } =
      await importRelationshipInferenceModule<ResolverModule>(
        "resolveRelationshipCandidates",
      );
    const document = makeRelationshipInferenceDocument();
    const invalid = [
      confidenceCandidate(document, 0.8, 0.7),
      makeRelationshipCandidate(document, { rawConfidence: Number.NaN }),
      makeRelationshipCandidate(document, { confidence: Number.POSITIVE_INFINITY }),
      makeRelationshipCandidate(document, { rawConfidence: 1.1, confidence: 1.1 }),
    ];
    for (const candidate of invalid) {
      expect(() => resolveRelationshipCandidates([candidate], document)).toThrow(
        /confidence|finite|range|mismatch|round/i,
      );
    }
  });

  it("preserves valid canonical raw/public confidence without recomputation", async () => {
    const { resolveRelationshipCandidates } =
      await importRelationshipInferenceModule<ResolverModule>(
        "resolveRelationshipCandidates",
      );
    const document = makeRelationshipInferenceDocument();
    const candidate = confidenceCandidate(document, 0.5999, 0.6);
    const result = resolveRelationshipCandidates([candidate], document);
    expect(result.excludedCandidates).toEqual([
      expect.objectContaining({ rawConfidence: 0.5999, confidence: 0.6 }),
    ]);
  });

  it("fails identically for shuffled malformed candidates", async () => {
    const { resolveRelationshipCandidates } =
      await importRelationshipInferenceModule<ResolverModule>(
        "resolveRelationshipCandidates",
      );
    const document = makeRelationshipInferenceDocument();
    const candidates = [
      confidenceCandidate(document, 0.5999, 0.5999),
      confidenceCandidate(document, 0.8, 0.7),
    ];
    const capture = (values: readonly unknown[]) => {
      try {
        resolveRelationshipCandidates(values, document);
        return "no error";
      } catch (error) {
        return String(error);
      }
    };
    expect(capture([...candidates].reverse())).toBe(capture(candidates));
  });
});

describe("relationship inference release gate: canonical evidence namespace", () => {
  it("rejects every raw evidence alias, including an otherwise related graph edge", async () => {
    const { canonicalizeRelationshipCandidate } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = makeRelationshipInferenceDocument();
    const edge = document.constructionGraph.edges.find(
      (candidate) => candidate.type === "endpoint-contact",
    )!;
    for (const rawEvidenceId of [
      edge.id,
      edge.id.replace(/^edge-/u, ""),
      edge.sourceRelationIds[0]!,
      document.objects[0].primitiveIds[0]!,
    ]) {
      expect(() => canonicalizeRelationshipCandidate(
        makeRelationshipCandidate(document, { evidenceIds: [rawEvidenceId] }),
        document,
      )).toThrow(/evidence|namespace|canonical|reference/i);
    }
  });

  it("resolves colliding primitive and graph-edge IDs by explicit namespace only", async () => {
    const { canonicalizeRelationshipCandidate } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = collisionDocument();
    const edge = document.constructionGraph.edges.find(
      (candidate) => candidate.type === "endpoint-contact",
    )!;
    const endpoints = {
      sourceObjectId: "b".repeat(24),
      targetObjectId: "c".repeat(24),
    };

    expect(canonicalizeRelationshipCandidate(
      makeRelationshipCandidate(document, {
        ...endpoints,
        evidenceIds: [`primitive:${edge.id}`],
      }),
      document,
    ).evidenceIds).toEqual([`primitive:${edge.id}`]);
    expect(() => canonicalizeRelationshipCandidate(
      makeRelationshipCandidate(document, {
        ...endpoints,
        evidenceIds: [`graph-edge:${edge.id}`],
      }),
      document,
    )).toThrow(/graph-edge|endpoint|ownership|unrelated/i);
    expect(() => canonicalizeRelationshipCandidate(
      makeRelationshipCandidate(document, {
        ...endpoints,
        evidenceIds: [edge.id],
      }),
      document,
    )).toThrow(/evidence|namespace|canonical|reference/i);
  });

  it.each([
    "unknown:value",
    "primitive:",
    "graph-edge:",
    "primitive:missing-evidence",
  ])("rejects malformed, unknown, or dangling namespaced evidence %s", async (evidenceId) => {
    const { canonicalizeRelationshipCandidate } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = makeRelationshipInferenceDocument();
    expect(() => canonicalizeRelationshipCandidate(
      makeRelationshipCandidate(document, { evidenceIds: [evidenceId] }),
      document,
    )).toThrow(/evidence|namespace|missing|reference|canonical/i);
  });
});

describe("relationship inference release gate: CONNECTED_VIA identity", () => {
  it("creates different relationship IDs for the same endpoints via C and D", async () => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    const viaC = inferElectricalRelationships(document, [
      viaRule(document, "rule-via", "c".repeat(24)),
    ]);
    const viaD = inferElectricalRelationships(document, [
      viaRule(document, "rule-via", "d".repeat(24)),
    ]);
    expect(viaC.relationships[0]?.relationshipId).not.toBe(
      viaD.relationships[0]?.relationshipId,
    );
  });

  it("keeps candidate and relationship identity stable for evidence order", async () => {
    const { createRelationshipCandidateId } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    const edge = document.constructionGraph.edges.find(
      (candidate) => candidate.type === "endpoint-contact",
    )!;
    const evidence = [
      `graph-edge:${edge.id}`,
      `spatial:${edge.sourceRelationIds[0]}`,
    ];
    const firstCandidate = makeRelationshipCandidate(document, {
      relationshipType: "CONNECTED_VIA",
      attributes: { viaObjectId: "c".repeat(24) },
      evidenceIds: evidence,
    });
    const secondCandidate = {
      ...structuredClone(firstCandidate),
      evidenceIds: [...evidence].reverse(),
    };
    expect(createRelationshipCandidateId(secondCandidate)).toBe(
      createRelationshipCandidateId(firstCandidate),
    );
    const first = inferElectricalRelationships(document, [
      viaRule(document, "rule-via", "c".repeat(24), evidence),
    ]);
    const second = inferElectricalRelationships(document, [
      viaRule(document, "rule-via", "c".repeat(24), [...evidence].reverse()),
    ]);
    expect(second.relationships[0]?.relationshipId).toBe(
      first.relationships[0]?.relationshipId,
    );
  });

  it("keeps relationship identity stable across rule identity", async () => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    const first = inferElectricalRelationships(document, [
      viaRule(document, "rule-a", "c".repeat(24)),
    ]);
    const second = inferElectricalRelationships(document, [
      viaRule(document, "rule-b", "c".repeat(24)),
    ]);
    expect(second.relationships[0]?.relationshipId).toBe(
      first.relationships[0]?.relationshipId,
    );
  });

  it("keeps relationship identity stable across rule execution order", async () => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    const edge = document.constructionGraph.edges.find(
      (candidate) => candidate.type === "bbox-touch",
    )!;
    const rules = [
      viaRule(document, "rule-via", "c".repeat(24)),
      makeRelationshipRule(document, {
        id: "rule-reference",
        relationshipType: "REFERENCES",
        generate: () => [makeRelationshipCandidate(document, {
          ruleId: "rule-reference",
          relationshipType: "REFERENCES",
          sourceObjectId: "b".repeat(24),
          targetObjectId: "c".repeat(24),
          evidenceIds: [`graph-edge:${edge.id}`],
        })],
      }),
    ];
    const first = inferElectricalRelationships(document, rules);
    const second = inferElectricalRelationships(document, [...rules].reverse());
    const viaId = (result: ElectricalRelationshipDocument) =>
      result.relationships.find(
        (relationship) => relationship.relationshipType === "CONNECTED_VIA",
      )?.relationshipId;
    expect(viaId(second)).toBe(viaId(first));
    expect(second).toEqual(first);
  });

  it("rejects competing via identity authorities", async () => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    const rule = viaRule(document, "rule-via", "c".repeat(24));
    rule.generate = () => [makeRelationshipCandidate(document, {
      ruleId: "rule-via",
      relationshipType: "CONNECTED_VIA",
      attributes: {
        viaObjectId: "c".repeat(24),
        viaObjectIds: ["c".repeat(24)],
      },
    })];
    expect(() => inferElectricalRelationships(document, [rule])).toThrow(
      /viaObjectId|authority|scalar/i,
    );
  });

  it.each([
    ["missing", undefined],
    ["dangling", "missing-via-object"],
    ["source endpoint", "a".repeat(24)],
    ["target endpoint", "b".repeat(24)],
  ])("rejects %s via identity", async (_name, viaObjectId) => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    expect(() => inferElectricalRelationships(document, [
      viaRule(document, "rule-via", viaObjectId),
    ])).toThrow(/via|object|identity|missing|endpoint|distinct/i);
  });

  it("preserves the existing CONNECTED_TO relationship identity", async () => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const result = inferElectricalRelationships(makeRelationshipInferenceDocument());
    expect(result.relationships[0]?.relationshipId).toBe("9be11be26811e973c4a68eb5");
  });

  it("produces deterministic serialized bytes and SHA-256", async () => {
    const { inferElectricalRelationships } =
      await importRelationshipInferenceModule<InferenceModule>("inferRelationships");
    const document = documentWithFourthObject();
    const infer = () => inferElectricalRelationships(document, [
      viaRule(document, "rule-via", "c".repeat(24)),
    ]);
    const first = serializeElectricalRelationshipDocument(infer());
    const second = serializeElectricalRelationshipDocument(infer());
    expect(second).toBe(first);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
  });
});
