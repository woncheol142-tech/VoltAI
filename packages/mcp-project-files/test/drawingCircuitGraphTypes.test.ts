import { describe, expect, expectTypeOf, it } from "vitest";

import {
  assertCircuitJsonValue,
  canonicalizeCircuitJsonValue,
} from "../src/drawingCircuitGraph/jsonValue.js";
import { parseCircuitGraphDocument } from "../src/drawingCircuitGraph/validateCircuitGraphDocument.js";
import {
  CircuitBoundaryRole,
  CircuitBoundaryType,
  CircuitEdgeType,
  CircuitGraphWarningCode,
  CircuitNodeType,
  type CircuitGraphDocument,
  type CircuitJsonObject,
} from "../src/drawingCircuitGraph/types.js";
import { makeCircuitGraphDocument } from "./helpers/drawingCircuitGraphFixture.js";

describe("circuit graph public types and JSON-safe contract", () => {
  it("exposes the approved independent domain enums", () => {
    expect(Object.values(CircuitEdgeType)).toEqual([
      "CONNECTED",
      "CONTAINS",
      "REFERENCE",
      "CONTROL",
      "POWER",
      "SIGNAL",
      "GROUND",
    ]);
    expect(Object.values(CircuitNodeType)).toContain("UNKNOWN_OBJECT");
    expect(Object.values(CircuitNodeType)).toContain("INTERMEDIATE");
    expect(Object.values(CircuitBoundaryType)).toEqual([
      "PAGE",
      "DOCUMENT",
      "EXTERNAL",
    ]);
    expect(Object.values(CircuitBoundaryRole)).toEqual([
      "INCOMING",
      "OUTGOING",
      "BIDIRECTIONAL",
    ]);
    expect(Object.values(CircuitGraphWarningCode)).toEqual([
      "DISCONNECTED_GRAPH",
      "REFERENCE_CYCLE",
      "UNRESOLVED_BOUNDARY",
    ]);
  });

  it("fixes exact public keys for every persisted shape", () => {
    const document = makeCircuitGraphDocument();
    expect(Object.keys(document)).toEqual([
      "schemaVersion",
      "graphId",
      "source",
      "sourceSha256",
      "page",
      "nodeCount",
      "edgeCount",
      "componentCount",
      "boundaryCount",
      "nodes",
      "edges",
      "components",
      "boundaries",
      "statistics",
      "warnings",
      "metadata",
    ]);
    expect(Object.keys(document.nodes[0]!)).toEqual([
      "nodeId",
      "objectIds",
      "nodeType",
      "displayName",
      "location",
      "attributes",
      "metadata",
    ]);
    expect(Object.keys(document.edges[0]!)).toEqual([
      "edgeId",
      "relationshipId",
      "sourceNodeId",
      "targetNodeId",
      "edgeType",
      "direction",
      "confidence",
      "attributes",
      "metadata",
    ]);
    expect(Object.keys(document.components[0]!)).toEqual([
      "componentId",
      "nodeIds",
      "edgeIds",
      "metadata",
    ]);
  });

  it("keeps JSON types readonly at the public type boundary", () => {
    expectTypeOf<CircuitGraphDocument["nodes"]>().toMatchTypeOf<
      readonly unknown[]
    >();
    expectTypeOf<CircuitJsonObject>().toMatchTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });

  it("accepts dense JSON values and canonicalizes keys and negative zero", () => {
    const value = { z: [-0, { z: true, a: null }], a: "도면" };
    expect(() => assertCircuitJsonValue(value, "fixture")).not.toThrow();
    expect(canonicalizeCircuitJsonValue(value)).toEqual({
      a: "도면",
      z: [0, { a: null, z: true }],
    });
  });

  it.each([
    undefined,
    1n,
    Symbol("private"),
    () => undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(),
    new Map(),
    new Set(),
    new (class Fixture {})(),
    Object.assign([1], { extra: true }),
  ])("rejects non-JSON-safe value %#", (value) => {
    expect(() => assertCircuitJsonValue(value, "fixture")).toThrow(
      /JSON-safe|fixture/i,
    );
  });

  it("rejects sparse arrays, cycles, pollution keys, and accessors", () => {
    const sparse = Array.from({ length: 2 });
    delete sparse[0];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const pollution = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(pollution, "__proto__", {
      value: "bad",
      enumerable: true,
    });
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    for (const value of [sparse, cyclic, pollution, accessor]) {
      expect(() => assertCircuitJsonValue(value, "fixture")).toThrow(
        /JSON-safe|fixture/i,
      );
    }
  });

  it("returns a deeply frozen parsed document without mutating input", () => {
    const input = makeCircuitGraphDocument();
    const before = structuredClone(input);
    const parsed = parseCircuitGraphDocument(input);
    expect(input).toEqual(before);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.nodes)).toBe(true);
    expect(Object.isFrozen(parsed.nodes[0]!.objectIds)).toBe(true);
    expect(Object.isFrozen(parsed.nodes[0]!.attributes.nested)).toBe(true);
    expect(Object.isFrozen(parsed.edges)).toBe(true);
    expect(Object.isFrozen(parsed.components[0]!.nodeIds)).toBe(true);
    expect(Object.isFrozen(parsed.warnings)).toBe(true);
    expect(Object.isFrozen(parsed.metadata)).toBe(true);
    expect(Reflect.set(parsed, "page", 99)).toBe(false);
    expect(Reflect.set(parsed.nodes[0]!.attributes, "private", true)).toBe(
      false,
    );
  });
});
