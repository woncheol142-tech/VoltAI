import { describe, expect, it } from "vitest";

import { validateElectricalRelationships } from "../src/drawingElectricalRelationships/validateElectricalRelationships.js";
import type { ElectricalRelationshipDocument } from "../src/drawingElectricalRelationships/types.js";
import {
  deepFreezeInferenceFixture,
  importRelationshipInferenceModule,
  makeRelationshipCandidate,
  makeRelationshipInferenceDocument,
  makeRelationshipRule,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type InferenceModule = {
  inferElectricalRelationships(
    document: unknown,
    rules?: readonly unknown[],
  ): ElectricalRelationshipDocument;
};

async function load() {
  return importRelationshipInferenceModule<InferenceModule>(
    "inferRelationships",
  );
}

function zeroTypeCounts() {
  return {
    CONNECTED_TO: 0,
    CONNECTED_VIA: 0,
    CONTAINS: 0,
    BELONGS_TO: 0,
    REFERENCES: 0,
    UNKNOWN: 0,
  };
}

describe("electrical relationship inference document contract", () => {
  it("returns a valid empty relationship document for empty object input", async () => {
    const { inferElectricalRelationships } = await load();
    const result = inferElectricalRelationships(
      makeRelationshipInferenceDocument({ empty: true }),
    );
    expect(result).toEqual({
      schemaVersion: 1,
      source: "docs/electrical.pdf",
      sourceSha256: "a".repeat(64),
      page: 15,
      objectIds: [],
      relationshipCount: 0,
      relationships: [],
      statistics: {
        relationshipCount: 0,
        relationshipCountByType: zeroTypeCounts(),
      },
      warnings: [],
    });
    expect(() => validateElectricalRelationships(result)).not.toThrow();
  });

  it("infers the explicit endpoint-contact relationship and passes 43C-2 validation", async () => {
    const { inferElectricalRelationships } = await load();
    const document = makeRelationshipInferenceDocument();
    const result = inferElectricalRelationships(document);
    const endpointEdge = document.constructionGraph.edges.find(
      (edge) => edge.type === "endpoint-contact",
    );
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]).toMatchObject({
      sourceObjectId: "a".repeat(24),
      targetObjectId: "b".repeat(24),
      relationshipType: "CONNECTED_TO",
      confidence: 1,
      evidenceIds: [`graph-edge:${endpointEdge?.id}`],
    });
    expect(() => validateElectricalRelationships(result)).not.toThrow();
  });

  it("projects only final public relationship fields", async () => {
    const { inferElectricalRelationships } = await load();
    const relationship = inferElectricalRelationships(
      makeRelationshipInferenceDocument(),
    ).relationships[0] as unknown as Record<string, unknown>;
    expect(Object.keys(relationship).sort()).toEqual([
      "attributes",
      "confidence",
      "diagnostics",
      "evidenceIds",
      "relationshipId",
      "relationshipType",
      "sourceObjectId",
      "targetObjectId",
    ]);
    expect(relationship).not.toHaveProperty("candidateId");
    expect(relationship).not.toHaveProperty("ruleId");
    expect(relationship).not.toHaveProperty("rawConfidence");
    expect(relationship).not.toHaveProperty("hardGatePassed");
  });

  it("builds canonical object registry and exact relationship statistics", async () => {
    const { inferElectricalRelationships } = await load();
    const result = inferElectricalRelationships(
      makeRelationshipInferenceDocument({ reverseObjects: true }),
    );
    expect(result.objectIds).toEqual([
      "a".repeat(24),
      "b".repeat(24),
      "c".repeat(24),
    ]);
    expect(result.relationshipCount).toBe(1);
    expect(result.statistics).toEqual({
      relationshipCount: 1,
      relationshipCountByType: {
        ...zeroTypeCounts(),
        CONNECTED_TO: 1,
      },
    });
  });

  it("does not emit UNKNOWN relationships", async () => {
    const { inferElectricalRelationships } = await load();
    const document = makeRelationshipInferenceDocument();
    const rules = [makeRelationshipRule(document, {
      id: "rule-unknown",
      relationshipType: "UNKNOWN",
      generate: () => [makeRelationshipCandidate(document, {
        ruleId: "rule-unknown",
        relationshipType: "UNKNOWN",
      })],
    })];
    const result = inferElectricalRelationships(document, rules);
    expect(result.relationships).toEqual([]);
    expect(result.statistics.relationshipCountByType.UNKNOWN).toBe(0);
  });

  it("allows partial success and records deterministic ambiguity warnings", async () => {
    const { inferElectricalRelationships } = await load();
    const document = makeRelationshipInferenceDocument();
    const rules = [
      makeRelationshipRule(document, {
        id: "rule-connected",
        generate: () => [makeRelationshipCandidate(document, {
          ruleId: "rule-connected",
        })],
      }),
      makeRelationshipRule(document, {
        id: "rule-via",
        relationshipType: "CONNECTED_VIA",
        generate: () => [makeRelationshipCandidate(document, {
          ruleId: "rule-via",
          relationshipType: "CONNECTED_VIA",
        })],
      }),
      makeRelationshipRule(document, {
        id: "rule-reference",
        relationshipType: "REFERENCES",
        generate: () => [makeRelationshipCandidate(document, {
          ruleId: "rule-reference",
          relationshipType: "REFERENCES",
          sourceObjectId: "b".repeat(24),
          targetObjectId: "c".repeat(24),
          evidenceIds: [`graph-edge:${document.constructionGraph.edges.find(
            (edge) => edge.type === "bbox-touch",
          )?.id ?? "missing-bbox-evidence"}`],
        })],
      }),
    ];
    const result = inferElectricalRelationships(document, rules);
    expect(result.relationships).toEqual([
      expect.objectContaining({ relationshipType: "REFERENCES" }),
    ]);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/AMBIGUOUS_RELATIONSHIP/u),
    );
    expect(() => validateElectricalRelationships(result)).not.toThrow();
  });

  it("rejects invalid input before rule execution", async () => {
    const { inferElectricalRelationships } = await load();
    const document = makeRelationshipInferenceDocument();
    document.objectCount += 1;
    let executed = false;
    const rules = [makeRelationshipRule(document, {
      generate: () => {
        executed = true;
        return [];
      },
    })];
    expect(() => inferElectricalRelationships(document, rules)).toThrow(
      /objectCount|input|invalid|count/i,
    );
    expect(executed).toBe(false);
  });

  it("keeps candidate identity rule-specific but relationship identity rule-independent", async () => {
    const { inferElectricalRelationships } = await load();
    const document = makeRelationshipInferenceDocument();
    const inferWithRule = (ruleId: string) => inferElectricalRelationships(
      document,
      [makeRelationshipRule(document, {
        id: ruleId,
        generate: () => [makeRelationshipCandidate(document, {
          ruleId,
        })],
      })],
    );
    const first = inferWithRule("rule-a");
    const second = inferWithRule("rule-b");
    expect(first.relationships[0].relationshipId).toMatch(/^[a-f0-9]{24}$/u);
    expect(second.relationships[0].relationshipId).toBe(
      first.relationships[0].relationshipId,
    );
  });

  it("is deterministic across object, edge, rule, and candidate input order", async () => {
    const { inferElectricalRelationships } = await load();
    const firstDocument = makeRelationshipInferenceDocument();
    const secondDocument = makeRelationshipInferenceDocument({
      reverseObjects: true,
      reverseEdges: true,
    });
    const makeRules = (document: ReturnType<typeof makeRelationshipInferenceDocument>) => [
      makeRelationshipRule(document, {
        id: "rule-reference",
        relationshipType: "REFERENCES",
        generate: () => [makeRelationshipCandidate(document, {
          ruleId: "rule-reference",
          relationshipType: "REFERENCES",
          sourceObjectId: "b".repeat(24),
          targetObjectId: "c".repeat(24),
          evidenceIds: [`graph-edge:${document.constructionGraph.edges.find(
            (edge) => edge.type === "bbox-touch",
          )?.id ?? "missing-bbox-evidence"}`],
        })],
      }),
      makeRelationshipRule(document, {
        id: "rule-connected",
        generate: () => [makeRelationshipCandidate(document, {
          ruleId: "rule-connected",
          evidenceIds: [`graph-edge:${document.constructionGraph.edges.find(
            (edge) => edge.type === "endpoint-contact",
          )?.id ?? "missing-endpoint-evidence"}`],
        })],
      }),
    ];
    const first = inferElectricalRelationships(firstDocument, makeRules(firstDocument));
    const reversedRules = makeRules(secondDocument).reverse();
    const second = inferElectricalRelationships(secondDocument, reversedRules);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("does not mutate frozen input documents or rules", async () => {
    const { inferElectricalRelationships } = await load();
    const document = makeRelationshipInferenceDocument();
    const rules = [makeRelationshipRule(document)];
    const before = structuredClone(document);
    deepFreezeInferenceFixture(document);
    deepFreezeInferenceFixture(rules);
    inferElectricalRelationships(document, rules);
    expect(document).toEqual(before);
  });
});
