import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  deepFreeze,
  importElectricalModule,
} from "./helpers/drawingElectricalObjectsFixture.js";

type EvidenceIndex = {
  getPrimitive(id: string): unknown;
  getTextEntity(id: string): unknown;
  getClassification(primitiveId: string): unknown;
  getRelation(id: string): unknown;
  getRelationsByPrimitive(id: string): unknown[];
  getRelationsByTextEntity(id: string): unknown[];
  getNeighboringText(primitiveId: string): unknown[];
  getNeighboringPrimitives(textEntityId: string): unknown[];
  getCanonicalPrimitiveId(primitiveId: string): string | undefined;
  statistics: {
    primitiveCount: number;
    textEntityCount: number;
    relationCount: number;
    indexedReferenceCount: number;
  };
};

type EvidenceModule = {
  createElectricalEvidenceIndex(input: unknown): EvidenceIndex;
};

async function load() {
  return importElectricalModule<EvidenceModule>("evidenceIndex");
}

describe("electrical evidence index", () => {
  it("indexes primitives, text, classifications, and relations by stable ID", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const fixture = createElectricalConstructionFixture();
    const index = createElectricalEvidenceIndex(fixture);
    const relation = fixture.spatial.relations[0]!;

    expect(index.getPrimitive(relation.primitiveId)).toBeDefined();
    expect(index.getTextEntity(relation.textEntityId)).toBeDefined();
    expect(index.getClassification(relation.primitiveId)).toBeDefined();
    expect(index.getRelation(relation.id)).toEqual(relation);
  });

  it("returns undefined or an empty array for unknown IDs", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const index = createElectricalEvidenceIndex(
      createElectricalConstructionFixture(),
    );
    expect(index.getPrimitive("missing")).toBeUndefined();
    expect(index.getTextEntity("missing")).toBeUndefined();
    expect(index.getClassification("missing")).toBeUndefined();
    expect(index.getRelation("missing")).toBeUndefined();
    expect(index.getRelationsByPrimitive("missing")).toEqual([]);
    expect(index.getRelationsByTextEntity("missing")).toEqual([]);
  });

  it("canonicalizes lookup order independently of source array order", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const first = createElectricalConstructionFixture();
    const second = structuredClone(first);
    second.layout.items.reverse();
    second.layout.lines.reverse();
    second.primitive.primitives.reverse();
    second.classification.classifications.reverse();
    second.spatial.relations.reverse();

    const firstIndex = createElectricalEvidenceIndex(first);
    const secondIndex = createElectricalEvidenceIndex(second);
    const primitiveId = first.primitive.primitives[0]!.id;
    expect(secondIndex.getRelationsByPrimitive(primitiveId)).toEqual(
      firstIndex.getRelationsByPrimitive(primitiveId),
    );
    expect(secondIndex.getNeighboringText(primitiveId)).toEqual(
      firstIndex.getNeighboringText(primitiveId),
    );
  });

  it("does not expose mutable internal relation arrays", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const fixture = createElectricalConstructionFixture();
    const index = createElectricalEvidenceIndex(fixture);
    const primitiveId = fixture.spatial.relations[0]!.primitiveId;
    const returned = index.getRelationsByPrimitive(primitiveId);
    returned.splice(0);
    expect(index.getRelationsByPrimitive(primitiveId)).not.toEqual([]);
  });

  it("does not mutate deeply frozen source documents", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const fixture = createElectricalConstructionFixture();
    const before = structuredClone(fixture);
    deepFreeze(fixture);
    expect(() => createElectricalEvidenceIndex(fixture)).not.toThrow();
    expect(fixture).toEqual(before);
  });

  it("indexes only O(P+T+R) references for a large synthetic relation set", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const fixture = createElectricalConstructionFixture();
    const index = createElectricalEvidenceIndex(fixture);
    expect(index.statistics.primitiveCount).toBe(fixture.primitive.primitiveCount);
    expect(index.statistics.textEntityCount).toBe(
      fixture.layout.itemCount + fixture.layout.lineCount,
    );
    expect(index.statistics.relationCount).toBe(fixture.spatial.relationCount);
    expect(index.statistics.indexedReferenceCount).toBeLessThanOrEqual(
      fixture.primitive.primitiveCount +
        fixture.layout.itemCount + fixture.layout.lineCount +
        fixture.spatial.relationCount * 4,
    );
  });

  it("maps exact duplicate primitives to a canonical source-order member", async () => {
    const { createElectricalEvidenceIndex } = await load();
    const fixture = createElectricalConstructionFixture();
    const duplicate = fixture.classification.classifications.find(
      ({ diagnostics }) => diagnostics.duplicateGroupId !== null,
    );
    if (!duplicate) return;
    const group = fixture.classification.classifications.filter(
      ({ diagnostics }) =>
        diagnostics.duplicateGroupId === duplicate.diagnostics.duplicateGroupId,
    );
    const expected = [...group].sort((left, right) => {
      const leftPrimitive = fixture.primitive.primitives.find(
        ({ id }) => id === left.primitiveId,
      )!;
      const rightPrimitive = fixture.primitive.primitives.find(
        ({ id }) => id === right.primitiveId,
      )!;
      return leftPrimitive.sourceOrder - rightPrimitive.sourceOrder;
    })[0]!.primitiveId;
    const index = createElectricalEvidenceIndex(fixture);
    expect(index.getCanonicalPrimitiveId(duplicate.primitiveId)).toBe(expected);
  });
});
