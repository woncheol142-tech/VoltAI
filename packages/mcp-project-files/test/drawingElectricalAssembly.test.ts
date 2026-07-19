import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  deepFreeze,
  importElectricalModule,
  makeElectricalCandidate,
} from "./helpers/drawingElectricalObjectsFixture.js";

type AssemblyModule = {
  assembleElectricalObjects(resolution: unknown, context: unknown): {
    objectCount: number;
    objects: Array<Record<string, unknown>>;
    statistics: Record<string, unknown>;
    warnings: string[];
  };
};

async function load() {
  return importElectricalModule<AssemblyModule>("assembleElectricalObjects");
}

function resolution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    acceptedCandidates: [makeElectricalCandidate()],
    reviewCandidates: [],
    excludedCandidates: [],
    conflicts: [],
    ...overrides,
  };
}

describe("electrical object assembly contract", () => {
  it("assembles only accepted and review candidates", async () => {
    const { assembleElectricalObjects } = await load();
    const result = assembleElectricalObjects(resolution({
      acceptedCandidates: [makeElectricalCandidate({ id: "accepted", confidence: 0.8 })],
      reviewCandidates: [makeElectricalCandidate({
        id: "review",
        confidence: 0.6,
        primaryPrimitiveIds: ["primitive-inside"],
      })],
      excludedCandidates: [makeElectricalCandidate({
        id: "excluded",
        confidence: 0.59,
        primaryPrimitiveIds: ["primitive-overlap"],
      })],
    }), createElectricalConstructionFixture());
    expect(result.objects).toHaveLength(2);
    expect(result.objects.map((object) => object.status)).toEqual(["accepted", "review"]);
    expect(result.objects).not.toContainEqual(expect.objectContaining({ id: "excluded" }));
  });

  it("canonicalizes provenance references and excludes raw source entities", async () => {
    const { assembleElectricalObjects } = await load();
    const candidate = makeElectricalCandidate({
      primaryPrimitiveIds: ["primitive-overlap", "primitive-container"],
      supportingPrimitiveIds: ["primitive-inside"],
      labelIds: ["item-overlap", "item-inside"],
      sourceRelationIds: ["relation-z", "relation-a"],
    });
    const object = assembleElectricalObjects(
      resolution({ acceptedCandidates: [candidate] }),
      createElectricalConstructionFixture(),
    ).objects[0];
    expect(object.primitiveIds).toEqual([
      "primitive-container",
      "primitive-inside",
      "primitive-overlap",
    ]);
    expect(object.sourceRelationIds).toEqual(["relation-a", "relation-z"]);
    expect(object.labels).toEqual([
      expect.objectContaining({ textEntityId: "item-inside" }),
      expect.objectContaining({ textEntityId: "item-overlap" }),
    ]);
    expect(object).not.toHaveProperty("primitives");
    expect(object).not.toHaveProperty("textItems");
    expect(object).not.toHaveProperty("candidate");
  });

  it("uses the finite union of owned primitive bounding boxes", async () => {
    const { assembleElectricalObjects } = await load();
    const candidate = makeElectricalCandidate({
      primaryPrimitiveIds: ["primitive-container", "primitive-overlap"],
    });
    const context = createElectricalConstructionFixture();
    const object = assembleElectricalObjects(
      resolution({ acceptedCandidates: [candidate] }),
      context,
    ).objects[0];
    const primitives = context.primitive.primitives.filter((primitive) =>
      candidate.primaryPrimitiveIds.includes(primitive.id)
    );
    const minX = Math.min(...primitives.map((primitive) => primitive.pageBBox.x));
    const minY = Math.min(...primitives.map((primitive) => primitive.pageBBox.y));
    const maxX = Math.max(...primitives.map((primitive) => primitive.pageBBox.x + primitive.pageBBox.width));
    const maxY = Math.max(...primitives.map((primitive) => primitive.pageBBox.y + primitive.pageBBox.height));
    expect(object.bbox).toEqual({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  });

  it("derives unique IDs, counts, canonical ordering, and deterministic diagnostics", async () => {
    const { assembleElectricalObjects } = await load();
    const candidates = [
      makeElectricalCandidate({ id: "candidate-z", primaryPrimitiveIds: ["primitive-inside"] }),
      makeElectricalCandidate({ id: "candidate-a", primaryPrimitiveIds: ["primitive-container"] }),
    ];
    const first = assembleElectricalObjects(
      resolution({ acceptedCandidates: candidates }),
      createElectricalConstructionFixture(),
    );
    const second = assembleElectricalObjects(
      resolution({ acceptedCandidates: [...candidates].reverse() }),
      createElectricalConstructionFixture(),
    );
    expect(first).toEqual(second);
    expect(first.objectCount).toBe(first.objects.length);
    expect(new Set(first.objects.map((object) => object.id)).size).toBe(first.objectCount);
    expect(first.objects.map((object) => object.id)).toEqual(
      [...first.objects.map((object) => object.id)].sort(),
    );
  });

  it("keeps raw-threshold status separate from three-decimal public confidence", async () => {
    const { assembleElectricalObjects } = await load();
    const object = assembleElectricalObjects(resolution({
      acceptedCandidates: [],
      reviewCandidates: [makeElectricalCandidate({ confidence: 0.7996 })],
    }), createElectricalConstructionFixture()).objects[0];
    expect(object.confidence).toBe(0.8);
    expect(object.status).toBe("review");
  });

  it("does not mutate frozen resolution or construction input", async () => {
    const { assembleElectricalObjects } = await load();
    const input = createElectricalConstructionFixture();
    const resolved = resolution();
    const before = structuredClone({ input, resolved });
    deepFreeze(input);
    deepFreeze(resolved);
    assembleElectricalObjects(resolved, input);
    expect({ input, resolved }).toEqual(before);
  });
});
