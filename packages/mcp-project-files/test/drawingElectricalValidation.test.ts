import { describe, expect, it } from "vitest";

import {
  createElectricalConstructionFixture,
  deepFreeze,
  importElectricalModule,
  makeElectricalAttribute,
  makeElectricalCandidate,
  makeElectricalObjectDocument,
} from "./helpers/drawingElectricalObjectsFixture.js";

type ValidationModule = {
  validateElectricalDocument(document: unknown): {
    valid: boolean;
    issues: Array<{ code: string }>;
  };
  validateElectricalObjects(document: unknown): void;
};

async function load() {
  return importElectricalModule<ValidationModule>("validateElectricalObjects");
}

function makeComponentDocument(objectCount: 2 | 3) {
  const document = makeElectricalObjectDocument();
  const objectIds = ["a".repeat(24), "b".repeat(24), "c".repeat(24)]
    .slice(0, objectCount);
  for (let index = 1; index < objectCount; index += 1) {
    const object = structuredClone(document.objects[0]);
    object.id = objectIds[index]!;
    object.primitiveIds = [`primitive-${index}`];
    document.objects.push(object);
  }
  document.objectCount = objectCount;
  document.constructionGraph.objectIds = objectIds;
  document.constructionGraph.edges = [];
  document.constructionGraph.components = objectIds.map((objectId, index) => ({
    id: `component-${index}`,
    objectIds: [objectId],
    edgeIds: [],
  }));
  document.statistics.candidateCount = objectCount;
  document.statistics.acceptedObjectCount = objectCount;
  document.statistics.objectCountByType.breaker = objectCount;
  return document;
}

function makeConnectedComponentDocument() {
  const document = makeComponentDocument(3);
  const [firstId, secondId, thirdId] = document.constructionGraph.objectIds;
  document.constructionGraph.edges = [{
    id: "edge-ab",
    type: "bbox-touch",
    objectIds: [firstId!, secondId!],
    primitiveIds: [],
    sourceRelationIds: [],
  }];
  document.constructionGraph.components = [{
    id: "component-ab",
    objectIds: [firstId!, secondId!],
    edgeIds: ["edge-ab"],
  }, {
    id: "component-c",
    objectIds: [thirdId!],
    edgeIds: [],
  }];
  return document;
}

describe("drawing electrical object document validation", () => {
  it("accepts the canonical schema v1 document without mutation", async () => {
    const { validateElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    const before = structuredClone(document);
    deepFreeze(document);
    expect(() => validateElectricalObjects(document)).not.toThrow();
    expect(document).toEqual(before);
  });

  it.each([
    ["missing ruleId", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      Reflect.deleteProperty(document.objects[0].diagnostics, "ruleId");
    }, "INVALID_DIAGNOSTICS_RULE_ID"],
    ["numeric ruleId", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      Reflect.set(document.objects[0].diagnostics, "ruleId", 42);
    }, "INVALID_DIAGNOSTICS_RULE_ID"],
    ["non-array conflicts", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      Reflect.set(document.objects[0].diagnostics, "conflicts", "not-an-array");
    }, "INVALID_DIAGNOSTICS_CONFLICTS"],
    ["null conflict", (document: ReturnType<typeof makeElectricalObjectDocument>) => {
      Reflect.set(document.objects[0].diagnostics, "conflicts", [null]);
    }, "INVALID_DIAGNOSTICS_CONFLICT"],
  ])("rejects malformed diagnostics: %s", async (_name, corrupt, expectedCode) => {
    const { validateElectricalDocument } = await load();
    const document = makeElectricalObjectDocument();
    corrupt(document);
    const result = validateElectricalDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toContain(expectedCode);
  });

  it("accepts serializer-compatible diagnostics shape", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeElectricalObjectDocument();
    expect(validateElectricalDocument(document)).toEqual({ valid: true, issues: [] });
  });

  it("accepts a disconnected graph whose components match isolated objects", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeComponentDocument(2);
    const before = structuredClone(document);
    deepFreeze(document);
    const result = validateElectricalDocument(document);
    expect(result).toEqual({ valid: true, issues: [] });
    expect(document).toEqual(before);
  });

  it("rejects a declared merged component when objects are disconnected", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeComponentDocument(2);
    document.constructionGraph.components = [{
      id: "component-merged",
      objectIds: [...document.constructionGraph.objectIds],
      edgeIds: [],
    }];
    const first = validateElectricalDocument(document);
    const second = validateElectricalDocument(structuredClone(document));
    expect(first.valid).toBe(false);
    expect(first.issues.map(({ code }) => code)).toContain(
      "GRAPH_COMPONENT_PARTITION_MISMATCH",
    );
    expect(second).toEqual(first);
  });

  it("rejects declared split components when a valid edge connects the objects", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeComponentDocument(2);
    document.constructionGraph.edges = [{
      id: "edge-ab",
      type: "bbox-touch",
      objectIds: [...document.constructionGraph.objectIds],
      primitiveIds: [],
      sourceRelationIds: [],
    }];
    const result = validateElectricalDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toContain(
      "GRAPH_COMPONENT_PARTITION_MISMATCH",
    );
  });

  it("accepts an isolated object beside a correctly connected component", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeComponentDocument(3);
    const [firstId, secondId, thirdId] = document.constructionGraph.objectIds;
    document.constructionGraph.edges = [{
      id: "edge-ab",
      type: "bbox-touch",
      objectIds: [firstId!, secondId!],
      primitiveIds: [],
      sourceRelationIds: [],
    }];
    document.constructionGraph.components = [{
      id: "component-ab",
      objectIds: [firstId!, secondId!],
      edgeIds: ["edge-ab"],
    }, {
      id: "component-c",
      objectIds: [thirdId!],
      edgeIds: [],
    }];
    expect(validateElectricalDocument(document)).toEqual({ valid: true, issues: [] });
  });

  it("rejects a valid graph edge omitted from every component without mutation", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeConnectedComponentDocument();
    document.constructionGraph.components[0]!.edgeIds = [];
    const before = structuredClone(document);
    deepFreeze(document);
    const result = validateElectricalDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toContain(
      "MISSING_GRAPH_COMPONENT_EDGE_REFERENCE",
    );
    expect(document).toEqual(before);
  });

  it("rejects an edge assigned to a component that does not contain both endpoints", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeConnectedComponentDocument();
    document.constructionGraph.components[0]!.edgeIds = [];
    document.constructionGraph.components[1]!.edgeIds = ["edge-ab"];
    const result = validateElectricalDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toContain(
      "GRAPH_COMPONENT_EDGE_MEMBERSHIP_MISMATCH",
    );
  });

  it("rejects an edge assigned to more than one component", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeConnectedComponentDocument();
    document.constructionGraph.components[1]!.edgeIds = ["edge-ab"];
    const result = validateElectricalDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toContain(
      "DUPLICATE_COMPONENT_EDGE_REFERENCE",
    );
  });

  it("accepts complete component edge ownership", async () => {
    const { validateElectricalDocument } = await load();
    expect(validateElectricalDocument(makeConnectedComponentDocument())).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each([
    ["schemaVersion", 2, /schemaVersion|version/i],
    ["source", "", /source/i],
    ["sourceSha256", "invalid", /sha|source/i],
    ["page", 0, /page/i],
    ["pageWidth", 0, /width|dimension/i],
    ["pageHeight", -1, /height|dimension/i],
    ["pageWidth", Number.POSITIVE_INFINITY, /finite|width/i],
  ])("rejects invalid document identity field %s", async (field, value, message) => {
    const { validateElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    Reflect.set(document, field, value);
    expect(() => validateElectricalObjects(document)).toThrow(message);
  });

  it("rejects count mismatches and duplicate object IDs", async () => {
    const { validateElectricalObjects } = await load();
    const countMismatch = makeElectricalObjectDocument();
    countMismatch.objectCount = 2;
    expect(() => validateElectricalObjects(countMismatch)).toThrow(/objectCount|count/i);

    const duplicate = makeElectricalObjectDocument();
    duplicate.objects.push(structuredClone(duplicate.objects[0]));
    duplicate.objectCount = 2;
    duplicate.constructionGraph.objectIds.push(duplicate.objects[0].id);
    duplicate.constructionGraph.components[0].objectIds.push(duplicate.objects[0].id);
    expect(() => validateElectricalObjects(duplicate)).toThrow(/duplicate|object.*id/i);
  });

  it.each([
    ["type", "motor", /type/i],
    ["status", "excluded", /status/i],
    ["confidence", -0.1, /confidence|range/i],
    ["confidence", 1.1, /confidence|range/i],
    ["confidence", Number.NaN, /confidence|finite/i],
  ])("rejects invalid object field %s", async (field, value, message) => {
    const { validateElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    Reflect.set(document.objects[0], field, value);
    expect(() => validateElectricalObjects(document)).toThrow(message);
  });

  it("rejects status inconsistent with raw confidence diagnostics", async () => {
    const { validateElectricalObjects } = await load();
    const document = makeElectricalObjectDocument();
    document.objects[0].status = "accepted";
    document.objects[0].confidence = 0.8;
    document.objects[0].diagnostics.confidenceComponents = {
      structural: 0.7996,
      label: 0.7996,
      spatial: 0.7996,
      attribute: 0.7996,
      consistency: 0.7996,
    };
    expect(() => validateElectricalObjects(document)).toThrow(/status|raw|confidence/i);
  });

  it("rejects a public confidence mismatch even within the same status band", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeElectricalObjectDocument();
    document.objects[0].status = "review";
    document.objects[0].confidence = 0.799;
    document.statistics.acceptedObjectCount = 0;
    document.statistics.reviewObjectCount = 1;
    document.objects[0].diagnostics.confidenceComponents = {
      structural: 0.6,
      label: 0.6,
      spatial: 0.6,
      attribute: 0.6,
      consistency: 0.6,
    };
    const result = validateElectricalDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toContain(
      "OBJECT_CONFIDENCE_VALUE_MISMATCH",
    );
  });

  it("accepts canonical public confidence with raw-threshold review status", async () => {
    const { validateElectricalDocument } = await load();
    const document = makeElectricalObjectDocument();
    document.objects[0].status = "review";
    document.objects[0].confidence = 0.8;
    document.statistics.acceptedObjectCount = 0;
    document.statistics.reviewObjectCount = 1;
    document.objects[0].diagnostics.confidenceComponents = {
      structural: 1,
      label: 1,
      spatial: 0.7984,
      attribute: 0,
      consistency: 0,
    };
    expect(validateElectricalDocument(document)).toEqual({ valid: true, issues: [] });
  });

  it("keeps canonical confidence consistent through candidate, resolver, assembly, and serializer", async () => {
    const context = createElectricalConstructionFixture();
    const { validateElectricalDocument } = await load();
    const { runElectricalObjectRules } = await importElectricalModule<{
      runElectricalObjectRules(rules: readonly unknown[], context: unknown): unknown[];
    }>("candidate");
    const { resolveElectricalObjectCandidates } = await importElectricalModule<{
      resolveElectricalObjectCandidates(candidates: readonly unknown[], context: unknown): unknown;
    }>("resolveCandidates");
    const { assembleElectricalObjects } = await importElectricalModule<{
      assembleElectricalObjects(resolution: unknown, context: unknown): ReturnType<
        typeof makeElectricalObjectDocument
      >;
    }>("assembleElectricalObjects");
    const { serializeElectricalDocument } = await importElectricalModule<{
      serializeElectricalDocument(document: unknown): string;
    }>("serializeElectricalObjects");
    const candidates = runElectricalObjectRules([{
      id: "synthetic.breaker",
      type: "breaker",
      priority: 100,
      generate: () => [makeElectricalCandidate()],
    }], context);
    const resolution = resolveElectricalObjectCandidates(candidates, context);
    const document = assembleElectricalObjects(resolution, context);
    const object = document.objects[0];
    expect(object.confidence).toBe(1);
    expect(object.status).toBe("accepted");
    expect(object.diagnostics.confidenceComponents).toEqual({
      structural: 1,
      label: 1,
      spatial: 1,
      attribute: 1,
      consistency: 1,
    });
    expect(validateElectricalDocument(document)).toEqual({ valid: true, issues: [] });
    expect(JSON.parse(serializeElectricalDocument(document)).objects[0]).toMatchObject({
      confidence: 1,
      status: "accepted",
    });
  });

  it("rejects duplicate primary ownership and invalid provenance references", async () => {
    const { validateElectricalObjects } = await load();
    const ownership = makeElectricalObjectDocument();
    const second = structuredClone(ownership.objects[0]);
    second.id = "b".repeat(24);
    ownership.objects.push(second);
    ownership.objectCount = 2;
    ownership.constructionGraph.objectIds.push(second.id);
    ownership.constructionGraph.components[0].objectIds.push(second.id);
    ownership.statistics.acceptedObjectCount = 2;
    ownership.statistics.objectCountByType.breaker = 2;
    expect(() => validateElectricalObjects(ownership)).toThrow(/ownership|primitive/i);

    const provenance = makeElectricalObjectDocument();
    provenance.objects[0].attributes.name = makeElectricalAttribute("MCCB", {
      textEntityIds: [],
      parserRuleId: "",
    });
    expect(() => validateElectricalObjects(provenance)).toThrow(/attribute|provenance|parserRuleId/i);
  });

  it("rejects dangling, semantic, self, and duplicate graph edges", async () => {
    const { validateElectricalObjects } = await load();
    const variants = [
      { type: "bbox-touch", objectIds: ["a".repeat(24), "missing"] },
      { type: "feeds", objectIds: ["a".repeat(24), "b".repeat(24)] },
      { type: "bbox-touch", objectIds: ["a".repeat(24), "a".repeat(24)] },
    ];
    for (const variant of variants) {
      const document = makeElectricalObjectDocument();
      document.constructionGraph.edges = [{
        id: "edge-a",
        primitiveIds: [],
        sourceRelationIds: [],
        ...variant,
      }];
      expect(() => validateElectricalObjects(document)).toThrow(/graph|edge|object|type/i);
    }
  });

  it("rejects non-canonical ordering, negative zero, and non-finite nested geometry", async () => {
    const { validateElectricalObjects } = await load();
    const unordered = makeElectricalObjectDocument();
    unordered.objects[0].primitiveIds = ["primitive-z", "primitive-a"];
    expect(() => validateElectricalObjects(unordered)).toThrow(/canonical|order|primitive/i);

    const negativeZero = makeElectricalObjectDocument();
    negativeZero.objects[0].bbox.x = -0;
    expect(() => validateElectricalObjects(negativeZero)).toThrow(/negative zero|canonical|bbox/i);

    const nonFinite = makeElectricalObjectDocument();
    nonFinite.objects[0].bbox.width = Number.POSITIVE_INFINITY;
    expect(() => validateElectricalObjects(nonFinite)).toThrow(/finite|bbox/i);
  });

  it("validates statistics, type totals, warning counts, and deterministic warnings", async () => {
    const { validateElectricalObjects } = await load();
    const count = makeElectricalObjectDocument();
    count.statistics.warningCount = 1;
    expect(() => validateElectricalObjects(count)).toThrow(/warningCount|warning.*count/i);

    const type = makeElectricalObjectDocument();
    type.statistics.objectCountByType.breaker = 0;
    expect(() => validateElectricalObjects(type)).toThrow(/type|statistics|count/i);

    const warnings = makeElectricalObjectDocument();
    warnings.warnings = ["Z_WARNING count=1", "A_WARNING count=1"];
    warnings.statistics.warningCount = 2;
    expect(() => validateElectricalObjects(warnings)).toThrow(/warning|canonical|order/i);
  });
});
