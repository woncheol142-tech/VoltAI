import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CircuitGraphProjectionError,
  projectCircuitGraph,
  serializeCircuitGraphDocument,
  validateCircuitGraphDocument,
} from "../src/drawingCircuitGraph/index.js";
import {
  CircuitEdgeType,
  CircuitGraphWarningCode,
  CircuitNodeType,
  type CircuitGraphDocument,
  type CircuitJsonValue,
} from "../src/drawingCircuitGraph/types.js";
import type {
  DrawingElectricalObjectDocument,
  ElectricalObject,
  ElectricalObjectType,
} from "../src/drawingElectricalObjects/types.js";
import { validateElectricalDocument } from "../src/drawingElectricalObjects/validateElectricalObjects.js";
import {
  ElectricalRelationshipType,
  type ElectricalRelationship,
  type ElectricalRelationshipDocument,
} from "../src/drawingElectricalRelationships/types.js";
import { validateElectricalRelationshipDocument } from "../src/drawingElectricalRelationships/validateElectricalRelationships.js";
import {
  ELECTRICAL_OBJECT_TYPES,
  PROJECTION_PAGE,
  PROJECTION_SOURCE,
  PROJECTION_SOURCE_SHA256,
  createBelongsToRelationship,
  createConnectedToRelationship,
  createConnectedViaRelationship,
  createContainsRelationship,
  createElectricalObjectDocumentFixture,
  createElectricalRelationshipDocumentFixture,
  createObjectFixture,
  createProjectionInputFixture,
  createReferenceRelationship,
  createRelationshipFixture,
  deepFreezeProjectionFixture,
  type ProjectionInputFixture,
} from "./helpers/drawingCircuitGraphProjectionFixture.js";

type ProjectionErrorCode =
  | "INVALID_OBJECT_DOCUMENT"
  | "INVALID_RELATIONSHIP_DOCUMENT"
  | "INCOMPATIBLE_SOURCE_SLICE"
  | "OBJECT_REGISTRY_MISMATCH"
  | "MISSING_INTERNAL_ENDPOINT"
  | "INVALID_CONNECTED_VIA"
  | "UNSUPPORTED_RELATIONSHIP_TYPE"
  | "GENERATED_GRAPH_INVALID";

const NODE_TYPE_MAPPING = {
  lighting: CircuitNodeType.LIGHTING,
  outlet: CircuitNodeType.OUTLET,
  panel: CircuitNodeType.PANEL,
  breaker: CircuitNodeType.BREAKER,
  transformer: CircuitNodeType.TRANSFORMER,
  ground: CircuitNodeType.GROUND,
  cable: CircuitNodeType.CABLE,
  conduit: CircuitNodeType.CONDUIT,
  equipment: CircuitNodeType.EQUIPMENT,
  annotation: CircuitNodeType.ANNOTATION,
  unknown: CircuitNodeType.UNKNOWN_OBJECT,
} as const satisfies Record<ElectricalObjectType, CircuitNodeType>;

const GRAPH_METADATA = {
  projectionProfile: "electrical-object-relationship-v1",
  projectionProfileVersion: 1,
  objectDocumentSchemaVersion: 1,
  relationshipDocumentSchemaVersion: 1,
} as const;

const MAX_PROJECTION_INPUT_DEPTH = 256;

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(codepointCompare);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: CircuitJsonValue): CircuitJsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => codepointCompare(left, right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function oracleId(prefix: string, payload: CircuitJsonValue): string {
  return `${prefix}${sha256(JSON.stringify(canonicalJson(payload)))}`;
}

function oracleNodeId(object: ElectricalObject): string {
  const nodeType = NODE_TYPE_MAPPING[object.type];
  return oracleId("cgn_", {
    identityVersion: 1,
    sourceSha256: PROJECTION_SOURCE_SHA256,
    page: PROJECTION_PAGE,
    objectIds: [object.id],
    nodeRole: `object:${nodeType}`,
  });
}

function expectProjectionError(
  run: () => unknown,
  expectedCode: ProjectionErrorCode,
  expectedRelatedIds?: readonly string[],
): void {
  try {
    run();
    throw new Error(`Expected projection error ${expectedCode}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CircuitGraphProjectionError);
    expect(error).toMatchObject({
      name: "CircuitGraphProjectionError",
      code: expectedCode,
    });
    expect((error as Error).message.length).toBeGreaterThan(0);
    if (expectedRelatedIds !== undefined) {
      expect(error).toMatchObject({
        relatedIds: canonicalStrings(expectedRelatedIds),
      });
    }
  }
}

function project(input: ProjectionInputFixture): CircuitGraphDocument {
  return projectCircuitGraph(input.objectDocument, input.relationshipDocument);
}

function nodeForObject(document: CircuitGraphDocument, objectId: string) {
  const node = document.nodes.find((candidate) =>
    candidate.objectIds.includes(objectId),
  );
  expect(node).toBeDefined();
  return node!;
}

function makeObjectSet(ids: readonly string[]): ElectricalObject[] {
  return ids.map((id, index) =>
    createObjectFixture({
      id,
      type: index === 0 ? "panel" : "breaker",
      bbox: { x: index * 10, y: 0, width: 5, height: 5 },
    }),
  );
}

function withRelationships(
  objects: readonly ElectricalObject[],
  relationships: readonly ElectricalRelationship[],
): ProjectionInputFixture {
  return createProjectionInputFixture({ objects, relationships });
}

function expectCanonical(values: readonly string[]): void {
  expect(values).toEqual(canonicalStrings(values));
  expect(new Set(values).size).toBe(values.length);
}

function cloneInput(input: ProjectionInputFixture): ProjectionInputFixture {
  return structuredClone(input);
}

function extendObjectToDepth(
  container: Record<string, unknown>,
  containerDepth: number,
  targetDepth: number,
): void {
  let current = container;
  for (let depth = containerDepth; depth < targetDepth; depth += 1) {
    const child: Record<string, unknown> = {};
    current.next = child;
    current = child;
  }
}

describe("circuit graph projection public API and source fixtures", () => {
  it("exports the approved runtime API", () => {
    expect(typeof projectCircuitGraph).toBe("function");
    expect(CircuitGraphProjectionError.prototype).toBeInstanceOf(Error);
  });

  it("uses source fixtures accepted by both authoritative validators", () => {
    const input = createProjectionInputFixture();
    expect(validateElectricalDocument(input.objectDocument)).toEqual({
      valid: true,
      issues: [],
    });
    expect(
      validateElectricalRelationshipDocument(input.relationshipDocument),
    ).toEqual({ valid: true, issues: [] });
  });

  it("returns a validated immutable CircuitGraphDocument without input mutation", () => {
    const input = createProjectionInputFixture();
    const before = cloneInput(input);
    deepFreezeProjectionFixture(input);
    const result = project(input);

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: PROJECTION_SOURCE,
      sourceSha256: PROJECTION_SOURCE_SHA256,
      page: PROJECTION_PAGE,
    });
    expect(validateCircuitGraphDocument(result)).toEqual({
      valid: true,
      issues: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(input).toEqual(before);
  });
});

describe("empty and isolated projection", () => {
  it("projects compatible empty source documents into a canonical empty graph", () => {
    const input = createProjectionInputFixture({
      objects: [],
      relationships: [],
    });
    expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);
    expect(
      validateElectricalRelationshipDocument(input.relationshipDocument).valid,
    ).toBe(true);

    const result = project(input);
    expect(result).toMatchObject({
      graphId:
        "cgg_b7419e3b4c7682080bc4e235f7ca6da16a4eeb4df88a1a4acba54e8e1097d94e",
      nodes: [],
      edges: [],
      components: [],
      boundaries: [],
      warnings: [],
      nodeCount: 0,
      edgeCount: 0,
      componentCount: 0,
      boundaryCount: 0,
      statistics: {
        isolatedNodeCount: 0,
        connectedComponentCount: 0,
      },
    });
    for (const value of Object.values(result.statistics.nodeTypeCounts)) {
      expect(value).toBe(0);
      expect(Object.is(value, -0)).toBe(false);
    }
    for (const value of Object.values(result.statistics.edgeTypeCounts)) {
      expect(value).toBe(0);
      expect(Object.is(value, -0)).toBe(false);
    }
    expect(sha256(serializeCircuitGraphDocument(result))).toBe(
      "aa50fceb6d1b6bcf6a4e09479108654bcb04d5810e6d02db0e304fd03c605b1a",
    );
  });

  it("creates one isolated component for one object", () => {
    const object = createObjectFixture({ id: "object-only", type: "panel" });
    const result = project(createProjectionInputFixture({ objects: [object] }));
    expect(result).toMatchObject({
      nodeCount: 1,
      edgeCount: 0,
      componentCount: 1,
      boundaryCount: 0,
      warnings: [],
      statistics: {
        isolatedNodeCount: 1,
        connectedComponentCount: 1,
      },
    });
    expect(result.components[0]).toMatchObject({
      nodeIds: [result.nodes[0]!.nodeId],
      edgeIds: [],
    });
  });
});

describe("object-to-node exhaustive mapping", () => {
  it("keeps the source type list and mapping exhaustive", () => {
    expect(Object.keys(NODE_TYPE_MAPPING).sort(codepointCompare)).toEqual(
      [...ELECTRICAL_OBJECT_TYPES].sort(codepointCompare),
    );
  });

  it.each(ELECTRICAL_OBJECT_TYPES)(
    "maps %s to its independent Circuit node type",
    (type) => {
      const object = createObjectFixture({ id: `object-${type}`, type });
      const result = project(
        createProjectionInputFixture({ objects: [object] }),
      );
      const node = result.nodes[0]!;
      expect(node).toEqual({
        nodeId: oracleNodeId(object),
        objectIds: [object.id],
        nodeType: NODE_TYPE_MAPPING[type],
        displayName: object.attributes.name?.value ?? null,
        location: object.bbox,
        attributes: object.attributes,
        metadata: {
          role: `object:${NODE_TYPE_MAPPING[type]}`,
          details: {
            objectStatus: object.status,
            objectConfidence: object.confidence,
            primitiveIds: object.primitiveIds,
            labelIds: object.labels.map(({ textEntityId }) => textEntityId),
            sourceRelationIds: object.sourceRelationIds,
          },
        },
      });
      expect(node).not.toBe(object);
      expect(node.location).not.toBe(object.bbox);
      expect(node.attributes).not.toBe(object.attributes);
    },
  );

  it("projects only type-specific public object attributes", () => {
    const first = createProjectionInputFixture();
    const second = structuredClone(first);
    const firstAttributes = first.objectDocument.objects[0]!
      .attributes as Record<string, unknown>;
    const secondAttributes = second.objectDocument.objects[0]!
      .attributes as Record<string, unknown>;
    firstAttributes.privateCache = { insertion: "first", secret: true };
    secondAttributes.internalState = { insertion: "second", secret: false };

    expect(validateElectricalDocument(first.objectDocument).valid).toBe(true);
    expect(validateElectricalDocument(second.objectDocument).valid).toBe(true);
    const firstGraph = project(first);
    const secondGraph = project(second);
    const firstBytes = serializeCircuitGraphDocument(firstGraph);
    const secondBytes = serializeCircuitGraphDocument(secondGraph);

    expect(
      nodeForObject(firstGraph, first.objectDocument.objects[0]!.id).attributes,
    ).not.toHaveProperty("privateCache");
    expect(
      nodeForObject(secondGraph, second.objectDocument.objects[0]!.id)
        .attributes,
    ).not.toHaveProperty("internalState");
    expect(firstBytes).not.toContain("privateCache");
    expect(secondBytes).not.toContain("internalState");
    expect(secondGraph.graphId).toBe(firstGraph.graphId);
    expect(secondBytes).toBe(firstBytes);
  });

  it("removes private nested attribute fields while preserving public siblings", () => {
    const input = createProjectionInputFixture();
    const object = input.objectDocument.objects[0]!;
    const name = object.attributes
      .name! as ElectricalObject["attributes"]["name"] &
      Record<string, unknown>;
    name.privateCache = { secret: "nested" };

    expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);
    const result = project(input);
    const projectedName = nodeForObject(result, object.id).attributes
      .name as Record<string, unknown>;
    expect(projectedName).toEqual({
      confidence: name.confidence,
      parserRuleId: name.parserRuleId,
      rawText: name.rawText,
      sourceRelationIds: name.sourceRelationIds,
      textEntityIds: name.textEntityIds,
      value: name.value,
    });
    expect(projectedName).not.toHaveProperty("privateCache");
    expect(projectedName).not.toBe(name);
    expect(serializeCircuitGraphDocument(result)).not.toContain("privateCache");
  });
});

describe("object display name projection", () => {
  it("projects a valid empty source name as a null display name", () => {
    const object = createObjectFixture({
      id: "object-empty-name",
      type: "panel",
      displayName: "",
    });
    const input = createProjectionInputFixture({ objects: [object] });
    const before = cloneInput(input);
    expect(validateElectricalDocument(input.objectDocument)).toEqual({
      valid: true,
      issues: [],
    });
    deepFreezeProjectionFixture(input);

    const result = project(input);
    const node = nodeForObject(result, object.id);
    const projectedName = node.attributes.name as Record<string, unknown>;
    expect(node.displayName).toBeNull();
    expect(projectedName.value).toBe("");
    expect(projectedName).not.toBe(object.attributes.name);
    expect(Object.isFrozen(projectedName)).toBe(true);
    expect(validateCircuitGraphDocument(result)).toEqual({
      valid: true,
      issues: [],
    });
    expect(() => serializeCircuitGraphDocument(result)).not.toThrow();
    expect(input).toEqual(before);
  });

  it("uses null as the canonical source representation for a missing name", () => {
    const object = createObjectFixture({
      id: "object-null-name",
      type: "panel",
      displayName: null,
    });
    const input = createProjectionInputFixture({ objects: [object] });
    expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);

    const result = project(input);
    const node = nodeForObject(result, object.id);
    expect(node.displayName).toBeNull();
    expect(Object.hasOwn(node.attributes, "name")).toBe(true);
    expect(node.attributes.name).toBeNull();

    const absentInput = cloneInput(input);
    delete (
      absentInput.objectDocument.objects[0]!.attributes as Partial<
        ElectricalObject["attributes"]
      >
    ).name;
    expect(validateElectricalDocument(absentInput.objectDocument).valid).toBe(
      false,
    );
    expectProjectionError(
      () => project(absentInput),
      "INVALID_OBJECT_DOCUMENT",
    );
  });

  it.each([
    ["Panel A", "Panel A"],
    [" ", " "],
  ] as const)(
    "preserves the exact non-empty source name %j",
    (sourceName, expectedDisplayName) => {
      const object = createObjectFixture({
        id: `object-name-${sourceName === " " ? "space" : "text"}`,
        type: "panel",
        displayName: sourceName,
      });
      const input = createProjectionInputFixture({ objects: [object] });
      expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);

      const node = nodeForObject(project(input), object.id);
      expect(node.displayName).toBe(expectedDisplayName);
      expect((node.attributes.name as Record<string, unknown>).value).toBe(
        sourceName,
      );
    },
  );

  it.each(ELECTRICAL_OBJECT_TYPES)(
    "projects an empty %s name without losing its public attribute",
    (type) => {
      const object = createObjectFixture({
        id: `object-empty-${type}`,
        type,
        displayName: "",
      });
      const input = createProjectionInputFixture({ objects: [object] });
      expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);

      const node = nodeForObject(project(input), object.id);
      expect(node.displayName).toBeNull();
      expect((node.attributes.name as Record<string, unknown>).value).toBe("");
    },
  );

  it("preserves other public falsy and nullable attribute values", () => {
    const object = createObjectFixture({
      id: "object-falsy-attributes",
      type: "panel",
    });
    const name = object.attributes.name!;
    object.attributes.tag = {
      ...structuredClone(name),
      value: "",
      rawText: "",
      confidence: 0,
      textEntityIds: ["text-empty-tag"],
    };
    object.attributes.remarks = {
      ...structuredClone(name),
      value: "",
      rawText: "",
      confidence: 0,
      textEntityIds: ["text-empty-remarks"],
    };
    object.attributes.rating = null;
    const input = createProjectionInputFixture({ objects: [object] });
    expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);

    const attributes = nodeForObject(project(input), object.id)
      .attributes as Record<string, unknown>;
    for (const field of ["tag", "remarks"] as const) {
      expect(attributes[field]).toMatchObject({ value: "", confidence: 0 });
    }
    expect(attributes.rating).toBeNull();
  });

  it("keeps structural identity stable while serialized name payloads differ", () => {
    const variants = [null, "", "Panel A"] as const;
    const results = variants.map((displayName) => {
      const object = createObjectFixture({
        id: "object-name-identity",
        type: "panel",
        displayName,
      });
      const graph = project(
        createProjectionInputFixture({ objects: [object] }),
      );
      return {
        graph,
        bytes: serializeCircuitGraphDocument(graph),
      };
    });

    expect(new Set(results.map(({ graph }) => graph.graphId))).toHaveLength(1);
    expect(new Set(results.map(({ bytes }) => bytes))).toHaveLength(3);
    expect(results.map(({ graph }) => graph.nodes[0]!.displayName)).toEqual([
      null,
      null,
      "Panel A",
    ]);
  });

  it("keeps empty public names while removing private attribute state", () => {
    const object = createObjectFixture({
      id: "object-empty-private",
      type: "panel",
      displayName: "",
    });
    const attributes = object.attributes as Record<string, unknown>;
    attributes.privateCache = { secret: "top-level" };
    (attributes.name as Record<string, unknown>).privateNested = {
      secret: "nested",
    };
    const input = createProjectionInputFixture({ objects: [object] });
    expect(validateElectricalDocument(input.objectDocument).valid).toBe(true);

    const result = project(input);
    const node = nodeForObject(result, object.id);
    expect(node.displayName).toBeNull();
    expect(node.attributes).not.toHaveProperty("privateCache");
    expect(node.attributes.name).not.toHaveProperty("privateNested");
    expect((node.attributes.name as Record<string, unknown>).value).toBe("");
    const bytes = serializeCircuitGraphDocument(result);
    expect(bytes).not.toContain("privateCache");
    expect(bytes).not.toContain("privateNested");
  });
});

describe("projection input depth authority", () => {
  it("accepts relationship and object containers at the maximum depth", () => {
    const input = createProjectionInputFixture({
      relationships: [createConnectedToRelationship()],
    });
    extendObjectToDepth(
      input.relationshipDocument.relationships[0]!.attributes as Record<
        string,
        unknown
      >,
      3,
      MAX_PROJECTION_INPUT_DEPTH,
    );
    extendObjectToDepth(
      input.objectDocument.objects[0]!.attributes as Record<string, unknown>,
      3,
      MAX_PROJECTION_INPUT_DEPTH,
    );

    expect(() => project(input)).not.toThrow();
  });

  it.each([
    ["object", "INVALID_OBJECT_DOCUMENT"],
    ["relationship", "INVALID_RELATIONSHIP_DOCUMENT"],
  ] as const)(
    "rejects %s containers beyond the maximum depth deterministically",
    (target, expectedCode) => {
      const input = createProjectionInputFixture({
        relationships: [createConnectedToRelationship()],
      });
      const container =
        target === "object"
          ? input.objectDocument.objects[0]!.attributes
          : input.relationshipDocument.relationships[0]!.attributes;
      extendObjectToDepth(
        container as Record<string, unknown>,
        3,
        MAX_PROJECTION_INPUT_DEPTH + 1,
      );

      const errors = Array.from({ length: 2 }, () => {
        try {
          project(input);
          throw new Error("Expected depth rejection");
        } catch (error) {
          expect(error).toBeInstanceOf(CircuitGraphProjectionError);
          expect(error).not.toBeInstanceOf(RangeError);
          return error as CircuitGraphProjectionError;
        }
      });
      expect(
        errors.map(({ code, message, relatedIds }) => ({
          code,
          message,
          relatedIds,
        })),
      ).toEqual([
        {
          code: expectedCode,
          message: errors[0]!.message,
          relatedIds: [],
        },
        {
          code: expectedCode,
          message: errors[0]!.message,
          relatedIds: [],
        },
      ]);
    },
  );
});

describe("projection error immutability", () => {
  it("makes every public error field non-writable and non-configurable", () => {
    const sourceRelatedIds = ["related-z", "related-a"];
    const error = new CircuitGraphProjectionError(
      "INVALID_OBJECT_DOCUMENT",
      "invalid object document",
      sourceRelatedIds,
    );
    sourceRelatedIds.push("related-injected");

    for (const field of ["name", "code", "message", "relatedIds"] as const) {
      const original = error[field];
      expect(Reflect.set(error, field, "changed")).toBe(false);
      expect(Reflect.deleteProperty(error, field)).toBe(false);
      expect(() =>
        Object.defineProperty(error, field, { value: "changed" }),
      ).toThrow();
      expect(error[field]).toBe(original);
      expect(Object.getOwnPropertyDescriptor(error, field)).toMatchObject({
        configurable: false,
        writable: false,
      });
    }
    expect(error.relatedIds).toEqual(["related-a", "related-z"]);
    expect(() => (error.relatedIds as string[]).push("related-new")).toThrow();
  });
});

describe("CONNECTED_TO projection", () => {
  it("creates one undirected edge and preserves relationship provenance", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationship = createConnectedToRelationship({
      relationshipId: "relationship-connected",
      sourceObjectId: "object-b",
      targetObjectId: "object-a",
      confidence: 0.875,
      evidenceIds: ["evidence-b", "evidence-a"],
      attributes: { nested: { z: 2, a: 1 } },
    });
    const result = project(withRelationships(objects, [relationship]));
    const edge = result.edges[0]!;
    expect(edge).toMatchObject({
      relationshipId: relationship.relationshipId,
      edgeType: CircuitEdgeType.CONNECTED,
      direction: "UNDIRECTED",
      confidence: relationship.confidence,
      attributes: relationship.attributes,
      metadata: {
        segmentRole: "direct:connected-to",
        evidenceIds: ["evidence-a", "evidence-b"],
        details: { relationshipType: "CONNECTED_TO" },
      },
    });
    expect([edge.sourceNodeId, edge.targetNodeId]).toEqual(
      canonicalStrings([edge.sourceNodeId, edge.targetNodeId]),
    );
    expect(result).toMatchObject({
      edgeCount: 1,
      componentCount: 1,
      boundaryCount: 0,
      statistics: { isolatedNodeCount: 0, connectedComponentCount: 1 },
    });
  });

  it("is stable when symmetric source endpoints are reversed", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const first = withRelationships(objects, [
      createConnectedToRelationship({
        relationshipId: "relationship-connected",
        sourceObjectId: "object-a",
        targetObjectId: "object-b",
      }),
    ]);
    const second = withRelationships(objects, [
      createConnectedToRelationship({
        relationshipId: "relationship-connected",
        sourceObjectId: "object-b",
        targetObjectId: "object-a",
      }),
    ]);
    expect(project(second)).toEqual(project(first));
  });

  it("preserves parallel relationships instead of deduplicating topology", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationships = ["relationship-a", "relationship-b"].map(
      (relationshipId) => createConnectedToRelationship({ relationshipId }),
    );
    const result = project(withRelationships(objects, relationships));
    expect(result.edges).toHaveLength(2);
    expect(new Set(result.edges.map(({ edgeId }) => edgeId)).size).toBe(2);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.edgeIds).toHaveLength(2);
  });

  it("rejects a source-valid self relationship at generated graph validation", () => {
    const object = createObjectFixture({ id: "object-a" });
    const input = withRelationships(
      [object],
      [
        createConnectedToRelationship({
          sourceObjectId: object.id,
          targetObjectId: object.id,
        }),
      ],
    );
    expect(
      validateElectricalRelationshipDocument(input.relationshipDocument).valid,
    ).toBe(true);
    expectProjectionError(() => project(input), "GENERATED_GRAPH_INVALID");
  });
});

describe("CONNECTED_VIA projection", () => {
  it("reuses the existing via node and creates two stable segments", () => {
    const objects = makeObjectSet(["object-a", "object-b", "object-via"]);
    const relationship = createConnectedViaRelationship({
      relationshipId: "relationship-via",
      sourceObjectId: "object-b",
      targetObjectId: "object-a",
      attributes: { viaObjectId: "object-via", note: "explicit" },
      evidenceIds: ["evidence-via"],
    });
    const result = project(withRelationships(objects, [relationship]));
    expect(result.nodes).toHaveLength(3);
    expect(
      result.nodes.every(
        ({ nodeType }) => nodeType !== CircuitNodeType.INTERMEDIATE,
      ),
    ).toBe(true);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.map(({ relationshipId }) => relationshipId)).toEqual([
      relationship.relationshipId,
      relationship.relationshipId,
    ]);
    expect(
      result.edges.map(({ metadata }) => metadata.segmentRole).sort(),
    ).toEqual(["connected-via:segment-0", "connected-via:segment-1"]);
    expect(new Set(result.edges.map(({ edgeId }) => edgeId)).size).toBe(2);
    const viaNode = nodeForObject(result, "object-via");
    expect(
      result.edges.every(
        (edge) =>
          edge.sourceNodeId === viaNode.nodeId ||
          edge.targetNodeId === viaNode.nodeId,
      ),
    ).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.boundaries).toEqual([]);
  });

  it("is stable across reversed outer endpoint representation", () => {
    const objects = makeObjectSet(["object-a", "object-b", "object-via"]);
    const makeInput = (sourceObjectId: string, targetObjectId: string) =>
      withRelationships(objects, [
        createConnectedViaRelationship({
          relationshipId: "relationship-via",
          sourceObjectId,
          targetObjectId,
          attributes: { viaObjectId: "object-via" },
        }),
      ]);
    expect(project(makeInput("object-b", "object-a"))).toEqual(
      project(makeInput("object-a", "object-b")),
    );
  });

  it.each([
    ["missing", {}],
    ["non-string", { viaObjectId: 42 }],
    ["dangling", { viaObjectId: "object-missing" }],
    ["source endpoint", { viaObjectId: "object-a" }],
    ["target endpoint", { viaObjectId: "object-b" }],
    [
      "competing authority",
      {
        viaObjectId: "object-via",
        viaObjectIds: ["object-via"],
      },
    ],
  ])("rejects %s via authority", (_name, attributes) => {
    const objects = makeObjectSet(["object-a", "object-b", "object-via"]);
    const input = withRelationships(objects, [
      createConnectedViaRelationship({ attributes }),
    ]);
    expectProjectionError(() => project(input), "INVALID_CONNECTED_VIA");
  });
});

describe("directed relationship projection", () => {
  it("projects CONTAINS forward without connectivity union", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationship = createContainsRelationship({
      relationshipId: "relationship-contains",
      sourceObjectId: "object-a",
      targetObjectId: "object-b",
    });
    const result = project(withRelationships(objects, [relationship]));
    expect(result.edges[0]).toMatchObject({
      relationshipId: relationship.relationshipId,
      edgeType: CircuitEdgeType.CONTAINS,
      direction: "FORWARD",
      sourceNodeId: nodeForObject(result, "object-a").nodeId,
      targetNodeId: nodeForObject(result, "object-b").nodeId,
      metadata: {
        segmentRole: "direct:contains",
        details: { relationshipType: "CONTAINS" },
      },
    });
    expect(result.components).toHaveLength(2);
    expect(result.statistics).toMatchObject({
      isolatedNodeCount: 2,
      connectedComponentCount: 2,
    });
    expect(result.warnings.map(({ code }) => code)).toContain(
      CircuitGraphWarningCode.DISCONNECTED_GRAPH,
    );
  });

  it("rejects a CONTAINS cycle through the Foundation validation authority", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const input = withRelationships(objects, [
      createContainsRelationship({
        relationshipId: "relationship-a-b",
        sourceObjectId: "object-a",
        targetObjectId: "object-b",
      }),
      createContainsRelationship({
        relationshipId: "relationship-b-a",
        sourceObjectId: "object-b",
        targetObjectId: "object-a",
      }),
    ]);
    expectProjectionError(() => project(input), "GENERATED_GRAPH_INVALID");
  });

  it("reverses BELONGS_TO into a forward CONTAINS edge", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationship = createBelongsToRelationship({
      sourceObjectId: "object-a",
      targetObjectId: "object-b",
    });
    const result = project(withRelationships(objects, [relationship]));
    expect(result.edges[0]).toMatchObject({
      edgeType: CircuitEdgeType.CONTAINS,
      direction: "FORWARD",
      sourceNodeId: nodeForObject(result, "object-b").nodeId,
      targetNodeId: nodeForObject(result, "object-a").nodeId,
      metadata: {
        segmentRole: "direct:belongs-to",
        details: { relationshipType: "BELONGS_TO" },
      },
    });
    expect(result.components).toHaveLength(2);
  });

  it("projects REFERENCES forward without connectivity union", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationship = createReferenceRelationship({
      sourceObjectId: "object-a",
      targetObjectId: "object-b",
    });
    const result = project(withRelationships(objects, [relationship]));
    expect(result.edges[0]).toMatchObject({
      edgeType: CircuitEdgeType.REFERENCE,
      direction: "FORWARD",
      sourceNodeId: nodeForObject(result, "object-a").nodeId,
      targetNodeId: nodeForObject(result, "object-b").nodeId,
      metadata: {
        segmentRole: "direct:references",
        details: { relationshipType: "REFERENCES" },
      },
    });
    expect(result.components).toHaveLength(2);
  });

  it("allows a REFERENCE cycle and emits one deterministic cycle warning", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationships = [
      createReferenceRelationship({
        relationshipId: "relationship-a-b",
        sourceObjectId: "object-a",
        targetObjectId: "object-b",
      }),
      createReferenceRelationship({
        relationshipId: "relationship-b-a",
        sourceObjectId: "object-b",
        targetObjectId: "object-a",
      }),
    ];
    const result = project(withRelationships(objects, relationships));
    expect(validateCircuitGraphDocument(result).valid).toBe(true);
    const warnings = result.warnings.filter(
      ({ code }) => code === CircuitGraphWarningCode.REFERENCE_CYCLE,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      code: CircuitGraphWarningCode.REFERENCE_CYCLE,
      message: "REFERENCE edges contain a directed cycle",
      relatedIds: canonicalStrings(result.nodes.map(({ nodeId }) => nodeId)),
      metadata: {
        edgeIds: canonicalStrings(result.edges.map(({ edgeId }) => edgeId)),
      },
    });
  });

  it("hard rejects UNKNOWN and source-invalid relationship enum values", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const unknown = withRelationships(objects, [
      createRelationshipFixture({
        relationshipType: ElectricalRelationshipType.UNKNOWN,
      }),
    ]);
    expect(
      validateElectricalRelationshipDocument(unknown.relationshipDocument)
        .valid,
    ).toBe(true);
    expectProjectionError(
      () => project(unknown),
      "UNSUPPORTED_RELATIONSHIP_TYPE",
    );

    const invalid = withRelationships(objects, [createRelationshipFixture()]);
    Reflect.set(
      invalid.relationshipDocument.relationships[0]!,
      "relationshipType",
      "POWER",
    );
    expectProjectionError(
      () => project(invalid),
      "INVALID_RELATIONSHIP_DOCUMENT",
    );
  });
});

describe("source-slice compatibility", () => {
  it.each([
    ["source", "source", "docs/other.pdf"],
    ["source hash", "sourceSha256", "e".repeat(64)],
    ["page", "page", 16],
  ])("rejects a mismatched %s", (_name, field, value) => {
    const input = createProjectionInputFixture();
    Reflect.set(input.relationshipDocument, field, value);
    expectProjectionError(() => project(input), "INCOMPATIBLE_SOURCE_SLICE");
  });

  it("rejects an extra or missing object registry member", () => {
    const extra = createProjectionInputFixture();
    extra.relationshipDocument.objectIds.push("object-extra");
    expectProjectionError(() => project(extra), "OBJECT_REGISTRY_MISMATCH");

    const missing = createProjectionInputFixture();
    missing.relationshipDocument.objectIds.pop();
    expectProjectionError(() => project(missing), "OBJECT_REGISTRY_MISMATCH");
  });

  it("distinguishes an endpoint registered only in the relationship document", () => {
    const object = createObjectFixture({ id: "object-a" });
    const objectDocument = createElectricalObjectDocumentFixture({
      objects: [object],
    });
    const relationshipDocument = createElectricalRelationshipDocumentFixture({
      objectIds: [object.id, "object-missing"],
      relationships: [
        createConnectedToRelationship({
          sourceObjectId: object.id,
          targetObjectId: "object-missing",
        }),
      ],
    });
    expect(
      validateElectricalRelationshipDocument(relationshipDocument).valid,
    ).toBe(true);
    expectProjectionError(
      () => projectCircuitGraph(objectDocument, relationshipDocument),
      "MISSING_INTERNAL_ENDPOINT",
      ["object-missing"],
    );
  });
});

describe("invalid source documents", () => {
  it.each([
    ["null", null],
    ["array", []],
  ])("rejects an invalid object document %s", (_name, objectDocument) => {
    const input = createProjectionInputFixture();
    expectProjectionError(
      () => projectCircuitGraph(objectDocument, input.relationshipDocument),
      "INVALID_OBJECT_DOCUMENT",
    );
  });

  it.each([
    [
      "wrong schema",
      (document: DrawingElectricalObjectDocument) => {
        Reflect.set(document, "schemaVersion", 2);
      },
    ],
    [
      "duplicate object IDs",
      (document: DrawingElectricalObjectDocument) => {
        const duplicate = structuredClone(document.objects[0]!);
        document.objects.push(duplicate);
        document.objectCount += 1;
      },
    ],
    [
      "noncanonical object ordering",
      (document: DrawingElectricalObjectDocument) => {
        document.objects.reverse();
      },
    ],
    [
      "malformed bbox",
      (document: DrawingElectricalObjectDocument) => {
        document.objects[0]!.bbox.x = Number.NaN;
      },
    ],
    [
      "non-finite confidence",
      (document: DrawingElectricalObjectDocument) => {
        document.objects[0]!.confidence = Number.POSITIVE_INFINITY;
      },
    ],
    [
      "extra top-level key",
      (document: DrawingElectricalObjectDocument) => {
        Reflect.set(document, "privateCache", {});
      },
    ],
  ])("rejects an object document with %s", (_name, mutate) => {
    const input = createProjectionInputFixture();
    mutate(input.objectDocument);
    expectProjectionError(() => project(input), "INVALID_OBJECT_DOCUMENT");
  });

  it.each([
    ["null", null],
    ["array", []],
  ])(
    "rejects an invalid relationship document %s",
    (_name, relationshipDocument) => {
      const input = createProjectionInputFixture();
      expectProjectionError(
        () => projectCircuitGraph(input.objectDocument, relationshipDocument),
        "INVALID_RELATIONSHIP_DOCUMENT",
      );
    },
  );

  it.each([
    [
      "wrong schema",
      (document: ElectricalRelationshipDocument) => {
        Reflect.set(document, "schemaVersion", 2);
      },
    ],
    [
      "duplicate relationship IDs",
      (document: ElectricalRelationshipDocument) => {
        document.relationships.push(
          structuredClone(document.relationships[0]!),
        );
        document.relationshipCount += 1;
        document.statistics.relationshipCount += 1;
        document.statistics.relationshipCountByType.CONNECTED_TO += 1;
      },
    ],
    [
      "missing endpoint",
      (document: ElectricalRelationshipDocument) => {
        Reflect.deleteProperty(document.relationships[0]!, "targetObjectId");
      },
    ],
    [
      "malformed attributes",
      (document: ElectricalRelationshipDocument) => {
        Reflect.set(document.relationships[0]!, "attributes", new Date(0));
      },
    ],
    [
      "extra top-level key",
      (document: ElectricalRelationshipDocument) => {
        Reflect.set(document, "resolverState", {});
      },
    ],
  ])("rejects a relationship document with %s", (_name, mutate) => {
    const input = createProjectionInputFixture({
      relationships: [createConnectedToRelationship()],
    });
    mutate(input.relationshipDocument);
    expectProjectionError(
      () => project(input),
      "INVALID_RELATIONSHIP_DOCUMENT",
    );
  });

  it("accepts relationship ordering permutations but rejects object ordering repair", () => {
    const objects = makeObjectSet(["object-a", "object-b", "object-c"]);
    const relationships = [
      createConnectedToRelationship({
        relationshipId: "relationship-a",
        sourceObjectId: "object-a",
        targetObjectId: "object-b",
      }),
      createReferenceRelationship({
        relationshipId: "relationship-b",
        sourceObjectId: "object-b",
        targetObjectId: "object-c",
      }),
    ];
    const first = withRelationships(objects, relationships);
    const second = cloneInput(first);
    second.relationshipDocument.relationships.reverse();
    second.relationshipDocument.objectIds.reverse();
    expect(
      validateElectricalRelationshipDocument(second.relationshipDocument).valid,
    ).toBe(true);
    expect(project(second)).toEqual(project(first));

    const invalidObjects = cloneInput(first);
    invalidObjects.objectDocument.objects.reverse();
    expectProjectionError(
      () => project(invalidObjects),
      "INVALID_OBJECT_DOCUMENT",
    );
  });
});

describe("v1 boundary and component contracts", () => {
  it("never creates a boundary for valid v1 relationships", () => {
    const objects = makeObjectSet(["object-a", "object-b", "object-via"]);
    const relationships = [
      createConnectedToRelationship({ relationshipId: "relationship-a" }),
      createConnectedViaRelationship({
        relationshipId: "relationship-b",
        attributes: { viaObjectId: "object-via" },
      }),
      createContainsRelationship({ relationshipId: "relationship-c" }),
      createReferenceRelationship({ relationshipId: "relationship-d" }),
    ];
    expect(
      project(withRelationships(objects, relationships)).boundaries,
    ).toEqual([]);
  });

  it("rejects a forged external endpoint instead of repairing it as a boundary", () => {
    const input = createProjectionInputFixture({
      relationships: [createConnectedToRelationship()],
    });
    Reflect.set(
      input.relationshipDocument.relationships[0]!,
      "externalEndpoint",
      {
        kind: "EXTERNAL",
        externalReferenceId: "page:16:connector-a",
      },
    );
    expectProjectionError(
      () => project(input),
      "INVALID_RELATIONSHIP_DOCUMENT",
    );
  });

  it.each([
    ["connected pair", ["a-b"], 1, 0],
    ["three-node chain", ["a-b", "b-c"], 1, 0],
    ["two disconnected pairs", ["a-b", "c-d"], 2, 0],
    ["three isolated nodes", [], 3, 3],
    ["parallel pair", ["a-b", "a-b"], 1, 0],
  ])(
    "derives canonical components for %s",
    (_name, pairs, expectedComponents, expectedIsolated) => {
      const ids = [...new Set(pairs.flatMap((pair) => pair.split("-")))];
      if (ids.length === 0) ids.push("a", "b", "c");
      const objects = makeObjectSet(ids.map((id) => `object-${id}`));
      const relationships = pairs.map((pair, index) => {
        const [source, target] = pair.split("-");
        return createConnectedToRelationship({
          relationshipId: `relationship-${String(index).padStart(2, "0")}`,
          sourceObjectId: `object-${source}`,
          targetObjectId: `object-${target}`,
        });
      });
      const result = project(withRelationships(objects, relationships));
      expect(result.components).toHaveLength(expectedComponents);
      expect(result.statistics.isolatedNodeCount).toBe(expectedIsolated);
      expect(result.statistics.connectedComponentCount).toBe(
        expectedComponents,
      );
      expectCanonical(result.components.map(({ componentId }) => componentId));
      for (const component of result.components) {
        expectCanonical(component.nodeIds);
        expectCanonical(component.edgeIds);
      }
    },
  );

  it("does not union components through CONTAINS or REFERENCE edges", () => {
    const objects = makeObjectSet(["object-a", "object-b", "object-c"]);
    const result = project(
      withRelationships(objects, [
        createContainsRelationship({
          relationshipId: "relationship-contains",
          sourceObjectId: "object-a",
          targetObjectId: "object-b",
        }),
        createReferenceRelationship({
          relationshipId: "relationship-reference",
          sourceObjectId: "object-b",
          targetObjectId: "object-c",
        }),
      ]),
    );
    expect(result.components).toHaveLength(3);
    expect(result.statistics).toMatchObject({
      isolatedNodeCount: 3,
      connectedComponentCount: 3,
    });
  });
});

describe("statistics and warning derivation", () => {
  it("recomputes exact complete statistics from the projected graph", () => {
    const objects = [
      createObjectFixture({ id: "object-a", type: "panel" }),
      createObjectFixture({ id: "object-b", type: "breaker" }),
      createObjectFixture({ id: "object-c", type: "unknown" }),
    ];
    const input = withRelationships(objects, [
      createConnectedToRelationship({
        sourceObjectId: "object-a",
        targetObjectId: "object-b",
      }),
    ]);
    input.objectDocument.statistics.objectCountByType.panel = 999;
    expectProjectionError(() => project(input), "INVALID_OBJECT_DOCUMENT");

    const result = project(
      withRelationships(objects, [
        createConnectedToRelationship({
          sourceObjectId: "object-a",
          targetObjectId: "object-b",
        }),
      ]),
    );
    expect(Object.keys(result.statistics.nodeTypeCounts).sort()).toEqual(
      Object.values(CircuitNodeType).sort(),
    );
    expect(Object.keys(result.statistics.edgeTypeCounts).sort()).toEqual(
      Object.values(CircuitEdgeType).sort(),
    );
    expect(result.statistics.nodeTypeCounts).toMatchObject({
      PANEL: 1,
      BREAKER: 1,
      UNKNOWN_OBJECT: 1,
    });
    expect(result.statistics.edgeTypeCounts.CONNECTED).toBe(1);
    expect(result).toMatchObject({
      nodeCount: 3,
      edgeCount: 1,
      componentCount: 2,
      boundaryCount: 0,
    });
    for (const value of [
      ...Object.values(result.statistics.nodeTypeCounts),
      ...Object.values(result.statistics.edgeTypeCounts),
      result.statistics.isolatedNodeCount,
      result.statistics.connectedComponentCount,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Object.is(value, -0)).toBe(false);
    }
  });

  it("emits one deterministic DISCONNECTED_GRAPH warning", () => {
    const result = project(
      createProjectionInputFixture({
        objects: makeObjectSet(["object-a", "object-b"]),
      }),
    );
    expect(result.warnings).toEqual([
      {
        code: CircuitGraphWarningCode.DISCONNECTED_GRAPH,
        message: "Circuit graph contains multiple connectivity components",
        relatedIds: canonicalStrings(
          result.components.map(({ componentId }) => componentId),
        ),
        metadata: { componentCount: 2 },
      },
    ]);
  });

  it("does not propagate source warnings or emit UNRESOLVED_BOUNDARY", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const relationship = createConnectedToRelationship();
    const baseline = project(withRelationships(objects, [relationship]));
    const warned = project(
      createProjectionInputFixture({
        objects,
        relationships: [relationship],
        objectWarnings: ["source object warning"],
        relationshipWarnings: ["source relationship warning"],
      }),
    );
    expect(warned).toEqual(baseline);
    expect(
      warned.warnings.some(
        ({ code }) => code === CircuitGraphWarningCode.UNRESOLVED_BOUNDARY,
      ),
    ).toBe(false);
  });

  it("keeps warning records unique and in strict canonical order", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const result = project(
      withRelationships(objects, [
        createReferenceRelationship({
          relationshipId: "relationship-a-b",
          sourceObjectId: "object-a",
          targetObjectId: "object-b",
        }),
        createReferenceRelationship({
          relationshipId: "relationship-b-a",
          sourceObjectId: "object-b",
          targetObjectId: "object-a",
        }),
      ]),
    );
    expect(result.warnings.map(({ code }) => code)).toEqual([
      CircuitGraphWarningCode.DISCONNECTED_GRAPH,
      CircuitGraphWarningCode.REFERENCE_CYCLE,
    ]);
    expect(
      new Set(
        result.warnings.map((warning) =>
          JSON.stringify(canonicalJson(warning)),
        ),
      ).size,
    ).toBe(result.warnings.length);
  });
});

describe("metadata and deterministic identity", () => {
  it("uses exact graph, node, and edge metadata allowlists", () => {
    const objects = makeObjectSet(["object-a", "object-b"]);
    const result = project(
      withRelationships(objects, [createConnectedToRelationship()]),
    );
    expect(result.metadata).toEqual(GRAPH_METADATA);
    expect(Object.keys(result.metadata).sort()).toEqual([
      "objectDocumentSchemaVersion",
      "projectionProfile",
      "projectionProfileVersion",
      "relationshipDocumentSchemaVersion",
    ]);
    expect(Object.keys(result.nodes[0]!.metadata.details).sort()).toEqual([
      "labelIds",
      "objectConfidence",
      "objectStatus",
      "primitiveIds",
      "sourceRelationIds",
    ]);
    expect(Object.keys(result.edges[0]!.metadata.details)).toEqual([
      "relationshipType",
    ]);
    const serialized = serializeCircuitGraphDocument(result);
    for (const forbidden of [
      "generatedAt",
      "timestamp",
      "hostname",
      "processId",
      "randomUuid",
      "fileMtime",
      "resolverState",
      "candidateDiagnostics",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("produces identical IDs, bytes, and SHA across valid input permutations", () => {
    const objects = makeObjectSet(["object-a", "object-b", "object-c"]);
    const relationships = [
      createConnectedToRelationship({
        relationshipId: "relationship-a",
        sourceObjectId: "object-a",
        targetObjectId: "object-b",
        attributes: { z: 2, a: { z: 2, a: 1 } },
      }),
      createReferenceRelationship({
        relationshipId: "relationship-b",
        sourceObjectId: "object-b",
        targetObjectId: "object-c",
      }),
    ];
    const first = withRelationships(objects, relationships);
    const second = cloneInput(first);
    second.relationshipDocument.relationships.reverse();
    second.relationshipDocument.objectIds.reverse();
    const firstResult = project(first);
    const secondResult = project(second);
    const firstBytes = serializeCircuitGraphDocument(firstResult);
    const secondBytes = serializeCircuitGraphDocument(secondResult);
    expect(secondResult).toEqual(firstResult);
    expect(secondBytes).toBe(firstBytes);
    expect(sha256(secondBytes)).toBe(sha256(firstBytes));
  });

  it("repeats projection and serialization with byte-stable SHA-256", () => {
    const input = createProjectionInputFixture({
      relationships: [createConnectedToRelationship()],
    });
    const results = Array.from({ length: 10 }, () => project(input));
    const bytes = results.map(serializeCircuitGraphDocument);
    const hashes = bytes.map(sha256);
    expect(new Set(results.map(({ graphId }) => graphId)).size).toBe(1);
    expect(new Set(bytes).size).toBe(1);
    expect(new Set(hashes).size).toBe(1);
  });

  it("keeps structural graph identity while non-identity payload bytes change", () => {
    const baseObject = createObjectFixture({ id: "object-a", type: "panel" });
    const baseline = project(
      createProjectionInputFixture({
        objects: [baseObject],
      }),
    );
    const changedObject = createObjectFixture({
      id: baseObject.id,
      type: baseObject.type,
      displayName: "renamed-panel",
      bbox: { x: 99, y: 88, width: 7, height: 6 },
      confidence: 0.7,
      status: "review",
    });
    const changed = project(
      createProjectionInputFixture({
        objects: [changedObject],
      }),
    );
    expect(changed.graphId).toBe(baseline.graphId);
    expect(serializeCircuitGraphDocument(changed)).not.toBe(
      serializeCircuitGraphDocument(baseline),
    );
  });

  it("changes structural identity for node type, relationship, and topology", () => {
    const panel = createObjectFixture({ id: "object-a", type: "panel" });
    const breaker = createObjectFixture({ id: "object-a", type: "breaker" });
    expect(
      project(createProjectionInputFixture({ objects: [breaker] })).graphId,
    ).not.toBe(
      project(createProjectionInputFixture({ objects: [panel] })).graphId,
    );

    const objects = makeObjectSet(["object-a", "object-b", "object-c"]);
    const connected = project(
      withRelationships(objects, [
        createConnectedToRelationship({ relationshipId: "relationship-a" }),
      ]),
    );
    const differentRelationship = project(
      withRelationships(objects, [
        createConnectedToRelationship({ relationshipId: "relationship-b" }),
      ]),
    );
    const differentTopology = project(
      withRelationships(objects, [
        createConnectedToRelationship({
          relationshipId: "relationship-a",
          targetObjectId: "object-c",
        }),
      ]),
    );
    expect(differentRelationship.graphId).not.toBe(connected.graphId);
    expect(differentTopology.graphId).not.toBe(connected.graphId);
  });
});

describe("projection immutability", () => {
  it("accepts deeply frozen inputs without sharing projected references", () => {
    const input = createProjectionInputFixture({
      relationships: [createConnectedToRelationship()],
    });
    const before = cloneInput(input);
    deepFreezeProjectionFixture(input);
    const result = project(input);
    expect(input).toEqual(before);
    expect(result.nodes).not.toBe(input.objectDocument.objects);
    expect(result.nodes[0]!.location).not.toBe(
      input.objectDocument.objects[0]!.bbox,
    );
    expect(result.nodes[0]!.attributes).not.toBe(
      input.objectDocument.objects[0]!.attributes,
    );
    expect(result.edges[0]!.attributes).not.toBe(
      input.relationshipDocument.relationships[0]!.attributes,
    );
    expect(result.edges[0]!.metadata.evidenceIds).not.toBe(
      input.relationshipDocument.relationships[0]!.evidenceIds,
    );
  });

  it("deep-freezes every public output collection and nested value", () => {
    const result = project(
      createProjectionInputFixture({
        relationships: [createConnectedToRelationship()],
      }),
    );
    const values = [
      result,
      result.metadata,
      result.nodes,
      result.nodes[0],
      result.nodes[0]!.objectIds,
      result.nodes[0]!.attributes,
      result.nodes[0]!.metadata,
      result.nodes[0]!.metadata.details,
      result.edges,
      result.edges[0],
      result.edges[0]!.attributes,
      result.edges[0]!.metadata,
      result.edges[0]!.metadata.evidenceIds,
      result.components,
      result.components[0],
      result.components[0]!.nodeIds,
      result.components[0]!.edgeIds,
      result.boundaries,
      result.statistics,
      result.statistics.nodeTypeCounts,
      result.statistics.edgeTypeCounts,
      result.warnings,
    ];
    expect(values.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(result, "page", 99)).toBe(false);
    expect(() => result.nodes.push(result.nodes[0]!)).toThrow();
    expect(result.page).toBe(PROJECTION_PAGE);
  });
});

type UnsafeKind =
  | "__proto__"
  | "constructor"
  | "prototype"
  | "accessor"
  | "sparse-array"
  | "cycle"
  | "symbol-key"
  | "bigint"
  | "nan"
  | "infinity"
  | "custom-prototype";

function injectUnsafeValue(
  container: Record<PropertyKey, unknown>,
  kind: UnsafeKind,
  getterCalls: { count: number },
): void {
  if (kind === "__proto__" || kind === "constructor" || kind === "prototype") {
    Object.defineProperty(container, kind, {
      value: "unsafe",
      enumerable: true,
      configurable: true,
    });
    return;
  }
  if (kind === "accessor") {
    Object.defineProperty(container, "unsafe", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls.count += 1;
        return "executed";
      },
    });
    return;
  }
  if (kind === "sparse-array") {
    const sparse: unknown[] = [];
    sparse[1] = "unsafe";
    container.unsafe = sparse;
    return;
  }
  if (kind === "cycle") {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    container.unsafe = cyclic;
    return;
  }
  if (kind === "symbol-key") {
    Object.defineProperty(container, Symbol("private"), {
      value: "unsafe",
      enumerable: true,
    });
    return;
  }
  if (kind === "bigint") {
    container.unsafe = 1n;
    return;
  }
  if (kind === "nan") {
    container.unsafe = Number.NaN;
    return;
  }
  if (kind === "infinity") {
    container.unsafe = Number.POSITIVE_INFINITY;
    return;
  }
  container.unsafe = Object.create({ inherited: true }) as object;
}

const UNSAFE_CASES = [
  "__proto__",
  "constructor",
  "prototype",
  "accessor",
  "sparse-array",
  "cycle",
  "symbol-key",
  "bigint",
  "nan",
  "infinity",
  "custom-prototype",
] as const satisfies readonly UnsafeKind[];

describe("projection JSON safety and security preflight", () => {
  it.each(UNSAFE_CASES)(
    "rejects unsafe object input %s without executing getters",
    (kind) => {
      const input = createProjectionInputFixture();
      const getterCalls = { count: 0 };
      injectUnsafeValue(
        input.objectDocument.objects[0]!.attributes as Record<
          PropertyKey,
          unknown
        >,
        kind,
        getterCalls,
      );
      expectProjectionError(() => project(input), "INVALID_OBJECT_DOCUMENT");
      expect(getterCalls.count).toBe(0);
    },
  );

  it.each(UNSAFE_CASES)(
    "rejects unsafe relationship input %s without executing getters",
    (kind) => {
      const input = createProjectionInputFixture({
        relationships: [createConnectedToRelationship()],
      });
      const getterCalls = { count: 0 };
      injectUnsafeValue(
        input.relationshipDocument.relationships[0]!.attributes as Record<
          PropertyKey,
          unknown
        >,
        kind,
        getterCalls,
      );
      expectProjectionError(
        () => project(input),
        "INVALID_RELATIONSHIP_DOCUMENT",
      );
      expect(getterCalls.count).toBe(0);
    },
  );
});
