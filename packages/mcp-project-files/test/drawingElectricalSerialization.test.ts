import { describe, expect, it } from "vitest";

import {
  deepFreeze,
  importElectricalModule,
  makeElectricalObjectDocument,
} from "./helpers/drawingElectricalObjectsFixture.js";

type SerializationModule = {
  serializeElectricalObjects(document: unknown): string;
};

async function load() {
  return importElectricalModule<SerializationModule>("serializeElectricalObjects");
}

function makeConnectedDocument() {
  const document = makeElectricalObjectDocument();
  const second = structuredClone(document.objects[0]);
  second.id = "b".repeat(24);
  second.primitiveIds = ["primitive-inside"];
  document.objects.push(second);
  document.objectCount = 2;
  document.constructionGraph.objectIds = document.objects.map(({ id }) => id);
  document.constructionGraph.edges = [{
    id: "edge-ab",
    type: "bbox-touch",
    objectIds: [document.objects[0].id, second.id],
    primitiveIds: [],
    sourceRelationIds: [],
  }];
  document.constructionGraph.components = [{
    id: "component-ab",
    objectIds: [...document.constructionGraph.objectIds],
    edgeIds: ["edge-ab"],
  }];
  document.statistics.candidateCount = 2;
  document.statistics.acceptedObjectCount = 2;
  document.statistics.objectCountByType.breaker = 2;
  return document;
}

describe("drawing electrical object serialization", () => {
  it("writes compact schema v1 UTF-8 JSON with exactly one trailing LF", async () => {
    const { serializeElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    document.warnings = ["한글 경고"];
    document.statistics.warningCount = 1;
    const serialized = serializeElectricalObjects(document);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
    expect(serialized).not.toContain("\n  ");
    expect(serialized).toContain("한글 경고");
    expect(JSON.parse(serialized)).toEqual(document);
  });

  it("canonicalizes semantically equivalent object, provenance, graph, and warning order", async () => {
    const { serializeElectricalObjects } = await load();
    const first = makeElectricalObjectDocument();
    const second = structuredClone(first);
    second.objects[0].primitiveIds = [...second.objects[0].primitiveIds].reverse();
    second.objects[0].labels = [...second.objects[0].labels].reverse();
    second.objects[0].sourceRelationIds = [...second.objects[0].sourceRelationIds].reverse();
    second.constructionGraph.objectIds.reverse();
    second.constructionGraph.edges.reverse();
    second.warnings.reverse();
    expect(serializeElectricalObjects(second)).toBe(serializeElectricalObjects(first));
  });

  it("canonicalizes public confidence and geometry to three decimals without negative zero", async () => {
    const { serializeElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    document.objects[0].confidence = 0.81249;
    document.objects[0].diagnostics.confidenceComponents = {
      structural: 0.81249,
      label: 0.81249,
      spatial: 0.81249,
      attribute: 0.81249,
      consistency: 0.81249,
    };
    document.objects[0].bbox = {
      x: -0,
      y: 1.23456,
      width: 20.0004,
      height: 9.9996,
    };
    const stored = JSON.parse(serializeElectricalObjects(document));
    expect(stored.objects[0].confidence).toBe(0.812);
    expect(stored.objects[0].bbox).toEqual({ x: 0, y: 1.235, width: 20, height: 10 });
    expect(serializeElectricalObjects(document)).not.toMatch(/:-0(?:[,}])/u);
  });

  it("preserves explicit null attributes without guessing missing values", async () => {
    const { serializeElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    const stored = JSON.parse(serializeElectricalObjects(document));
    expect(stored.objects[0].attributes.tag).toBeNull();
    expect(stored.objects[0].attributes.voltage).toBeNull();
  });

  it.each([
    ["NaN confidence", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      document.objects[0].confidence = Number.NaN;
    }, /finite|confidence/i],
    ["infinite geometry", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      document.objects[0].bbox.width = Number.POSITIVE_INFINITY;
    }, /finite|bbox/i],
    ["undefined attribute", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      Reflect.set(document.objects[0].attributes, "tag", undefined);
    }, /undefined|attribute/i],
    ["count mismatch", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      document.objectCount = 2;
    }, /objectCount|count/i],
    ["schema v2", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      document.schemaVersion = 2;
    }, /schemaVersion|version/i],
  ])("rejects %s before producing bytes", async (_name, corrupt, message) => {
    const { serializeElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    corrupt(document);
    expect(() => serializeElectricalObjects(document)).toThrow(message);
  });

  it("does not expose candidate, resolver, or raw source entity state", async () => {
    const { serializeElectricalObjects } = await load();
    const serialized = serializeElectricalObjects(makeElectricalObjectDocument());
    expect(serialized).not.toContain('"acceptedCandidates"');
    expect(serialized).not.toContain('"excludedCandidates"');
    expect(serialized).not.toContain('"primitives"');
    expect(serialized).not.toContain('"textItems"');
  });

  it("projects nested object, attribute, diagnostics, and provenance fields", async () => {
    const { serializeElectricalObjects } = await load();
    const baseline = makeElectricalObjectDocument();
    const document = structuredClone(baseline);
    const object = document.objects[0];
    Reflect.set(object, "__resolverState", { candidateId: "private-candidate" });
    Reflect.set(object.attributes, "__attributeCache", ["private-attribute"]);
    Reflect.set(object.diagnostics, "__debugTrace", { private: true });
    Reflect.set(object.labels[0], "__private", "private-label");
    Reflect.set(object.attributes.name!, "__private", "private-provenance");

    const serialized = serializeElectricalObjects(document);
    expect(serialized).toBe(serializeElectricalObjects(baseline));
    expect(serialized).not.toMatch(
      /__resolverState|__attributeCache|__debugTrace|__private|private-/u,
    );
  });

  it("projects graph container, edge, and component fields", async () => {
    const { serializeElectricalObjects } = await load();
    const baseline = makeConnectedDocument();
    const document = structuredClone(baseline);
    Reflect.set(document.constructionGraph, "__graphCache", { private: true });
    Reflect.set(document.constructionGraph.edges[0], "__edgeDebug", "private-edge");
    Reflect.set(
      document.constructionGraph.components[0],
      "__componentInternal",
      "private-component",
    );

    const serialized = serializeElectricalObjects(document);
    expect(serialized).toBe(serializeElectricalObjects(baseline));
    expect(serialized).not.toMatch(
      /__graphCache|__edgeDebug|__componentInternal|private-/u,
    );
  });

  it("projects statistics and warning container fields", async () => {
    const { serializeElectricalObjects } = await load();
    const baseline = makeElectricalObjectDocument();
    const document = structuredClone(baseline);
    Reflect.set(document.statistics, "__statisticsCache", { private: true });
    Reflect.set(document.warnings, "__warningDebug", "private-warning");

    const serialized = serializeElectricalObjects(document);
    expect(serialized).toBe(serializeElectricalObjects(baseline));
    expect(serialized).not.toMatch(/__statisticsCache|__warningDebug|private-/u);
  });

  it("does not serialize symbol properties at any depth", async () => {
    const { serializeElectricalObjects } = await load();
    const baseline = makeElectricalObjectDocument();
    const document = structuredClone(baseline);
    const privateSymbol = Symbol("private-electrical-state");
    Reflect.set(document, privateSymbol, "document");
    Reflect.set(document.objects[0], privateSymbol, "object");
    Reflect.set(document.objects[0].attributes, privateSymbol, "attributes");
    Reflect.set(document.objects[0].diagnostics, privateSymbol, "diagnostics");
    Reflect.set(document.constructionGraph, privateSymbol, "graph");
    Reflect.set(document.statistics, privateSymbol, "statistics");

    expect(serializeElectricalObjects(document)).toBe(
      serializeElectricalObjects(baseline),
    );
  });

  it("preserves every schema-v1 public field after nested projection", async () => {
    const { serializeElectricalObjects } = await load();
    const document = makeConnectedDocument();
    expect(JSON.parse(serializeElectricalObjects(document))).toEqual(document);
  });

  it("does not mutate a deeply frozen document", async () => {
    const { serializeElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    const before = structuredClone(document);
    deepFreeze(document);
    serializeElectricalObjects(document);
    expect(document).toEqual(before);
  });
});
