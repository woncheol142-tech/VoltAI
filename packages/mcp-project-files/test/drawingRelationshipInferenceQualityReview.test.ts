import { describe, expect, it } from "vitest";

import { validateElectricalObjects } from "../src/drawingElectricalObjects/validateElectricalObjects.js";
import {
  importRelationshipInferenceModule,
  makeRelationshipCandidate,
  makeRelationshipInferenceDocument,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type CandidateModule = {
  canonicalizeRelationshipCandidate(candidate: unknown, document: unknown): {
    candidateId: string;
  };
  createRelationshipCandidateId(candidate: unknown): string;
};

type InputModule = {
  validateRelationshipInferenceInput(input: unknown): void;
};

type RuleContext = {
  document: {
    objects: unknown[];
  };
  evidenceIndex: {
    objectById: ReadonlyMap<string, unknown>;
    evidenceByObjectId: ReadonlyMap<string, readonly string[]>;
  };
};

type RuleModule = {
  createConnectedToRelationshipRule(): unknown;
  runRelationshipRules(rules: readonly unknown[], document: unknown): unknown[];
};

type ResolverModule = {
  resolveRelationshipCandidates(candidates: readonly unknown[], document: unknown): {
    selectedCandidates: Array<{ candidateId: string }>;
    conflicts: Array<{ winnerId: string | null }>;
  };
};

describe("relationship inference independent review regressions", () => {
  it("rejects dangling provenance without constructing a repaired validation view", async () => {
    const { validateRelationshipInferenceInput } =
      await importRelationshipInferenceModule<InputModule>(
        "validateRelationshipInferenceInput",
      );
    const document = makeRelationshipInferenceDocument();
    const relationId = document.constructionGraph.edges[0].sourceRelationIds[0]!;
    for (const object of document.objects) {
      object.sourceRelationIds = object.sourceRelationIds.filter(
        (candidate) => candidate !== relationId,
      );
    }

    expect(() => validateElectricalObjects(document)).toThrow(
      /dangling|relation|reference/i,
    );
    expect(() => validateRelationshipInferenceInput(document)).toThrow(
      /dangling|relation|reference/i,
    );
  });

  it("rejects a forged supplied candidate ID", async () => {
    const {
      canonicalizeRelationshipCandidate,
      createRelationshipCandidateId,
    } = await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = makeRelationshipInferenceDocument();
    const candidate = makeRelationshipCandidate(document);
    const canonicalId = createRelationshipCandidateId(candidate);
    candidate.candidateId = canonicalId === "forged-candidate-id"
      ? "different-forged-id"
      : "forged-candidate-id";

    expect(() => canonicalizeRelationshipCandidate(candidate, document)).toThrow(
      /candidate.*id|canonical|mismatch/i,
    );
  });

  it("generates the canonical ID when a rule candidate omits candidateId", async () => {
    const {
      canonicalizeRelationshipCandidate,
      createRelationshipCandidateId,
    } = await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = makeRelationshipInferenceDocument();
    const candidate = makeRelationshipCandidate(document) as unknown as Record<string, unknown>;
    delete candidate.candidateId;

    expect(canonicalizeRelationshipCandidate(candidate, document).candidateId).toBe(
      createRelationshipCandidateId(candidate),
    );
  });

  it("rejects graph-edge evidence unrelated to the candidate endpoints", async () => {
    const { canonicalizeRelationshipCandidate } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = makeRelationshipInferenceDocument();
    const unrelatedEdge = document.constructionGraph.edges.find(
      (edge) => edge.type === "bbox-touch",
    )!;
    const candidate = makeRelationshipCandidate(document, {
      evidenceIds: [`graph-edge:${unrelatedEdge.id}`],
    });

    expect(() => canonicalizeRelationshipCandidate(candidate, document)).toThrow(
      /evidence|endpoint|ownership|unrelated/i,
    );
  });

  it.each([
    ["primitive", "primitive:primitive-c"],
    ["text", "text:item-c"],
    ["spatial", "spatial:spatial-object-c"],
  ])("rejects unrelated %s evidence", async (_kind, evidenceId) => {
    const { canonicalizeRelationshipCandidate } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const document = makeRelationshipInferenceDocument();
    const candidate = makeRelationshipCandidate(document, {
      evidenceIds: [evidenceId],
    });

    expect(() => canonicalizeRelationshipCandidate(candidate, document)).toThrow(
      /evidence|endpoint|ownership|unrelated/i,
    );
  });

  it("recomputes canonical identity after the resolver merges evidence", async () => {
    const { createRelationshipCandidateId } =
      await importRelationshipInferenceModule<CandidateModule>("candidate");
    const { resolveRelationshipCandidates } =
      await importRelationshipInferenceModule<ResolverModule>(
        "resolveRelationshipCandidates",
      );
    const document = makeRelationshipInferenceDocument();
    const edge = document.constructionGraph.edges.find(
      (candidate) => candidate.type === "endpoint-contact",
    )!;
    const candidates = [
      makeRelationshipCandidate(document, {
        ruleId: "rule-a",
        evidenceIds: [`graph-edge:${edge.id}`],
      }),
      makeRelationshipCandidate(document, {
        ruleId: "rule-b",
        evidenceIds: [`spatial:${edge.sourceRelationIds[0]!}`],
      }),
    ];

    const result = resolveRelationshipCandidates(candidates, document);
    const selected = result.selectedCandidates[0]!;
    expect(selected.candidateId).toBe(createRelationshipCandidateId(selected));
    expect(result.conflicts[0]?.winnerId).toBe(selected.candidateId);
  });

  it("prevents custom rules from mutating shared context state", async () => {
    const {
      createConnectedToRelationshipRule,
      runRelationshipRules,
    } = await importRelationshipInferenceModule<RuleModule>("rules");
    const document = makeRelationshipInferenceDocument();
    const before = structuredClone(document);
    const mutationFailures: boolean[] = [];
    const mutationRule = {
      id: "aaa.synthetic.context-mutation",
      relationshipType: "REFERENCES",
      priority: 1,
      generate(context: RuleContext) {
        for (const mutate of [
          () => (context.evidenceIndex.objectById as Map<string, unknown>).clear(),
          () => Map.prototype.clear.call(context.evidenceIndex.objectById),
          () => context.document.objects.pop(),
          () => Object.assign(
            context.evidenceIndex.objectById.values().next().value as object,
            { confidence: 0 },
          ),
          () => (context.evidenceIndex.evidenceByObjectId.values().next().value as string[])
            .push("forged-evidence"),
        ]) {
          try {
            mutate();
            mutationFailures.push(false);
          } catch {
            mutationFailures.push(true);
          }
        }
        return [];
      },
    };

    const candidates = runRelationshipRules([
      mutationRule,
      createConnectedToRelationshipRule(),
    ], document);

    expect(mutationFailures).toEqual([true, true, true, true, true]);
    expect(candidates).toHaveLength(1);
    expect(document).toEqual(before);
  });
});
