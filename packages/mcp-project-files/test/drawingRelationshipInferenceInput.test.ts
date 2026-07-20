import { describe, expect, it } from "vitest";

import {
  deepFreezeInferenceFixture,
  importRelationshipInferenceModule,
  makeRelationshipInferenceDocument,
} from "./helpers/drawingRelationshipInferenceFixture.js";

type InputModule = {
  validateRelationshipInferenceInput(input: unknown): void;
};

type EvidenceIndex = {
  objectIds: string[];
  graphEdgeIds: string[];
  evidenceIds: string[];
  objectById: ReadonlyMap<string, unknown>;
  graphEdgeById: ReadonlyMap<string, unknown>;
  evidenceByObjectId: ReadonlyMap<string, readonly string[]>;
  graphEdgesByObjectId: ReadonlyMap<string, readonly unknown[]>;
};

type EvidenceIndexModule = {
  createRelationshipEvidenceIndex(document: unknown): EvidenceIndex;
};

async function loadInput() {
  return importRelationshipInferenceModule<InputModule>(
    "validateRelationshipInferenceInput",
  );
}

async function loadEvidenceIndex() {
  return importRelationshipInferenceModule<EvidenceIndexModule>(
    "createRelationshipEvidenceIndex",
  );
}

describe("relationship inference input contract", () => {
  it("accepts a valid DrawingElectricalObjectDocument", async () => {
    const { validateRelationshipInferenceInput } = await loadInput();
    expect(() => validateRelationshipInferenceInput(
      makeRelationshipInferenceDocument(),
    )).not.toThrow();
  });

  it.each([
    null,
    {},
    { schemaVersion: 1, relationships: [] },
    { ...makeRelationshipInferenceDocument(), schemaVersion: 2 },
  ])("rejects non-object-document input %#", async (input) => {
    const { validateRelationshipInferenceInput } = await loadInput();
    expect(() => validateRelationshipInferenceInput(input)).toThrow(
      /electrical|object|document|schema|input/i,
    );
  });

  it("rejects invalid object document counts", async () => {
    const { validateRelationshipInferenceInput } = await loadInput();
    const document = makeRelationshipInferenceDocument();
    document.objectCount += 1;
    expect(() => validateRelationshipInferenceInput(document)).toThrow(
      /objectCount|count|invalid/i,
    );
  });

  it("rejects invalid construction graph references", async () => {
    const { validateRelationshipInferenceInput } = await loadInput();
    const document = makeRelationshipInferenceDocument();
    document.constructionGraph.edges[0].objectIds[1] = "missing";
    expect(() => validateRelationshipInferenceInput(document)).toThrow(
      /graph|edge|object|dangling|reference/i,
    );
  });

  it("accepts an empty object document and builds an empty evidence index", async () => {
    const { validateRelationshipInferenceInput } = await loadInput();
    const { createRelationshipEvidenceIndex } = await loadEvidenceIndex();
    const document = makeRelationshipInferenceDocument({ empty: true });
    expect(() => validateRelationshipInferenceInput(document)).not.toThrow();
    expect(createRelationshipEvidenceIndex(document)).toMatchObject({
      objectIds: [],
      graphEdgeIds: [],
      evidenceIds: [],
    });
  });

  it("indexes object and graph evidence in canonical ID order", async () => {
    const { createRelationshipEvidenceIndex } = await loadEvidenceIndex();
    const forward = createRelationshipEvidenceIndex(
      makeRelationshipInferenceDocument(),
    );
    const reversed = createRelationshipEvidenceIndex(
      makeRelationshipInferenceDocument({
        reverseObjects: true,
        reverseEdges: true,
      }),
    );
    expect(forward.objectIds).toEqual(reversed.objectIds);
    expect(forward.graphEdgeIds).toEqual(reversed.graphEdgeIds);
    expect(forward.evidenceIds).toEqual(reversed.evidenceIds);
    expect([...forward.objectById]).toEqual([...reversed.objectById]);
    expect([...forward.graphEdgeById]).toEqual([...reversed.graphEdgeById]);
    expect([...forward.evidenceByObjectId]).toEqual([
      ...reversed.evidenceByObjectId,
    ]);
    expect([...forward.graphEdgesByObjectId]).toEqual([
      ...reversed.graphEdgesByObjectId,
    ]);
    expect(forward.objectIds).toEqual([...forward.objectIds].sort());
    expect(forward.graphEdgeIds).toEqual([...forward.graphEdgeIds].sort());
    expect(forward.evidenceIds).toEqual([...forward.evidenceIds].sort());
    expect(forward.evidenceIds).toEqual(expect.arrayContaining([
      "spatial:spatial-endpoint-contact",
      expect.stringMatching(/^graph-edge:edge-[a-f0-9]{24}$/u),
    ]));
    expect([...forward.objectById.keys()]).toEqual(forward.objectIds);
    expect([...forward.graphEdgeById.keys()]).toEqual(forward.graphEdgeIds);
  });

  it("does not mutate deep-frozen input during validation or indexing", async () => {
    const { validateRelationshipInferenceInput } = await loadInput();
    const { createRelationshipEvidenceIndex } = await loadEvidenceIndex();
    const document = makeRelationshipInferenceDocument();
    const before = structuredClone(document);
    deepFreezeInferenceFixture(document);
    validateRelationshipInferenceInput(document);
    createRelationshipEvidenceIndex(document);
    expect(document).toEqual(before);
  });
});
