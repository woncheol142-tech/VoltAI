import { describe, expect, it } from "vitest";

import {
  deepFreeze,
  importElectricalModule,
  makeElectricalObjectDocument,
} from "./helpers/drawingElectricalObjectsFixture.js";

type GraphModule = {
  buildElectricalConstructionGraph(
    objects: readonly unknown[],
    edges: readonly unknown[],
  ): unknown;
  validateElectricalConstructionGraph(graph: unknown, objectIds: readonly string[]): void;
};

async function load() {
  return importElectricalModule<GraphModule>("constructionGraph");
}

function twoObjects() {
  const first = makeElectricalObjectDocument().objects[0];
  return [
    structuredClone(first),
    { ...structuredClone(first), id: "b".repeat(24), primitiveIds: ["primitive-inside"] },
  ];
}

function edge(type = "bbox-touch") {
  return {
    type,
    objectIds: ["a".repeat(24), "b".repeat(24)],
    primitiveIds: ["primitive-container", "primitive-inside"],
    sourceRelationIds: ["relation-a"],
  };
}

describe("electrical construction graph boundary", () => {
  it.each(["bbox-touch", "endpoint-contact", "shared-primitive", "spatial-adjacent"])(
    "accepts the geometric edge type %s",
    async (type) => {
      const { buildElectricalConstructionGraph } = await load();
      expect(buildElectricalConstructionGraph(twoObjects(), [edge(type)]))
        .toEqual(expect.objectContaining({ edges: [expect.objectContaining({ type })] }));
    },
  );

  it.each([
    "feeds",
    "upstream",
    "downstream",
    "same-circuit",
    "electrically-connected",
    "feeder",
    "branch",
  ])("rejects semantic electrical edge type %s", async (type) => {
    const { buildElectricalConstructionGraph } = await load();
    expect(() => buildElectricalConstructionGraph(twoObjects(), [edge(type)]))
      .toThrow(/edge|type|geometric|semantic/i);
  });

  it("rejects dangling endpoints and self edges", async () => {
    const { buildElectricalConstructionGraph } = await load();
    expect(() => buildElectricalConstructionGraph(twoObjects(), [{
      ...edge(),
      objectIds: ["a".repeat(24), "missing"],
    }])).toThrow(/dangling|object|endpoint/i);
    expect(() => buildElectricalConstructionGraph(twoObjects(), [{
      ...edge(),
      objectIds: ["a".repeat(24), "a".repeat(24)],
    }])).toThrow(/self|endpoint|distinct/i);
  });

  it("canonicalizes undirected endpoints, duplicate edges, and graph ordering", async () => {
    const { buildElectricalConstructionGraph } = await load();
    const forward = edge();
    const reverse = { ...edge(), objectIds: [...edge().objectIds].reverse() };
    const first = buildElectricalConstructionGraph(twoObjects(), [forward, reverse]);
    const second = buildElectricalConstructionGraph([...twoObjects()].reverse(), [reverse, forward]);
    expect(first).toEqual(second);
    expect(first).toEqual(expect.objectContaining({
      objectIds: ["a".repeat(24), "b".repeat(24)],
      edges: [expect.objectContaining({ objectIds: ["a".repeat(24), "b".repeat(24)] })],
    }));
  });

  it("preserves shared primitive and raw relation provenance by ID", async () => {
    const { buildElectricalConstructionGraph } = await load();
    const graph = buildElectricalConstructionGraph(twoObjects(), [{
      ...edge("shared-primitive"),
      primitiveIds: ["primitive-overlap"],
      sourceRelationIds: ["relation-z", "relation-a"],
    }]);
    expect(graph).toEqual(expect.objectContaining({
      edges: [expect.objectContaining({
        primitiveIds: ["primitive-overlap"],
        sourceRelationIds: ["relation-a", "relation-z"],
      })],
    }));
  });

  it("validates graph endpoints and does not mutate frozen input", async () => {
    const { buildElectricalConstructionGraph, validateElectricalConstructionGraph } = await load();
    const objects = twoObjects();
    const edges = [edge()];
    const before = structuredClone({ objects, edges });
    deepFreeze(objects);
    deepFreeze(edges);
    const graph = buildElectricalConstructionGraph(objects, edges);
    expect(() => validateElectricalConstructionGraph(
      graph,
      objects.map((object) => object.id),
    )).not.toThrow();
    expect({ objects, edges }).toEqual(before);
  });
});
