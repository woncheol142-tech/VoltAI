import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCircuitBoundaryId,
  createCircuitComponentId,
  createCircuitEdgeId,
  createCircuitNodeId,
} from "../src/drawingCircuitGraph/identity.js";
import {
  CircuitBoundaryRole,
  CircuitBoundaryType,
  CircuitEdgeType,
  CircuitGraphWarningCode,
  CircuitNodeType,
  type CircuitGraphWarning,
} from "../src/drawingCircuitGraph/types.js";
import { serializeCircuitGraphDocument } from "../src/drawingCircuitGraph/serializeCircuitGraphDocument.js";
import {
  assertValidCircuitGraphDocument,
  validateCircuitGraphDocument,
} from "../src/drawingCircuitGraph/validateCircuitGraphDocument.js";
import { writeCircuitGraphDocument } from "../src/drawingCircuitGraph/writeCircuitGraphDocument.js";
import {
  makeCircuitGraphDocument,
  refreshCircuitGraphFixture,
} from "./helpers/drawingCircuitGraphFixture.js";

function codes(document: unknown): string[] {
  return validateCircuitGraphDocument(document).issues.map(({ code }) => code);
}

type CircuitGraphFixture = ReturnType<typeof makeCircuitGraphDocument>;

function makeZeroStatisticsDocument(): CircuitGraphFixture {
  const document = makeCircuitGraphDocument();
  document.nodes = [];
  document.edges = [];
  document.components = [];
  document.boundaries = [];
  document.warnings = [];
  return refreshCircuitGraphFixture(document);
}

const NEGATIVE_ZERO_STATISTICS_CASES = [
  {
    label: "nodeTypeCounts",
    code: "NODE_TYPE_COUNTS_MISMATCH",
    relatedId: `statistics.nodeTypeCounts.${CircuitNodeType.LIGHTING}`,
    get: (document: CircuitGraphFixture) =>
      document.statistics.nodeTypeCounts[CircuitNodeType.LIGHTING],
    set: (document: CircuitGraphFixture, value: number) => {
      document.statistics.nodeTypeCounts[CircuitNodeType.LIGHTING] = value;
    },
  },
  {
    label: "edgeTypeCounts",
    code: "EDGE_TYPE_COUNTS_MISMATCH",
    relatedId: `statistics.edgeTypeCounts.${CircuitEdgeType.REFERENCE}`,
    get: (document: CircuitGraphFixture) =>
      document.statistics.edgeTypeCounts[CircuitEdgeType.REFERENCE],
    set: (document: CircuitGraphFixture, value: number) => {
      document.statistics.edgeTypeCounts[CircuitEdgeType.REFERENCE] = value;
    },
  },
  {
    label: "isolatedNodeCount",
    code: "ISOLATED_NODE_COUNT_MISMATCH",
    relatedId: "statistics.isolatedNodeCount",
    get: (document: CircuitGraphFixture) =>
      document.statistics.isolatedNodeCount,
    set: (document: CircuitGraphFixture, value: number) => {
      document.statistics.isolatedNodeCount = value;
    },
  },
  {
    label: "connectedComponentCount",
    code: "CONNECTED_COMPONENT_COUNT_MISMATCH",
    relatedId: "statistics.connectedComponentCount",
    get: (document: CircuitGraphFixture) =>
      document.statistics.connectedComponentCount,
    set: (document: CircuitGraphFixture, value: number) => {
      document.statistics.connectedComponentCount = value;
    },
  },
] as const;

function testCodepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStringArrays(
  left: readonly string[],
  right: readonly string[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = testCodepointCompare(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function canonicalTestJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalTestJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(testCodepointCompare)
      .map((key) => [
        key,
        canonicalTestJson((value as Record<string, unknown>)[key]),
      ]),
  );
}

function compareWarnings(
  left: CircuitGraphWarning,
  right: CircuitGraphWarning,
): number {
  return (
    testCodepointCompare(left.code, right.code) ||
    compareStringArrays(left.relatedIds, right.relatedIds) ||
    testCodepointCompare(left.message, right.message) ||
    testCodepointCompare(
      JSON.stringify(canonicalTestJson(left.metadata)),
      JSON.stringify(canonicalTestJson(right.metadata)),
    )
  );
}

function makeWarning(
  overrides: Partial<CircuitGraphWarning> = {},
): CircuitGraphWarning {
  return {
    code: CircuitGraphWarningCode.DISCONNECTED_GRAPH,
    message: "warning",
    relatedIds: [],
    metadata: {},
    ...overrides,
  };
}

function makeContainmentChainDocument(
  nodeCount: number,
  options: {
    skipAfter?: ReadonlySet<number>;
    backEdges?: readonly (readonly [number, number, string])[];
    parallelAt?: number;
  } = {},
) {
  const document = makeCircuitGraphDocument();
  const sourceSha256 = document.sourceSha256;
  const page = document.page;
  const chainNodes = Array.from({ length: nodeCount }, (_, index) => {
    const objectIds = [`deep-object-${String(index).padStart(6, "0")}`];
    return {
      nodeId: createCircuitNodeId({
        sourceSha256,
        page,
        objectIds,
        nodeRole: "object",
      }),
      objectIds,
      nodeType: CircuitNodeType.UNKNOWN_OBJECT,
      displayName: null,
      location: null,
      attributes: {},
      metadata: { role: "object", details: {} },
    };
  });
  const makeEdge = (
    sourceIndex: number,
    targetIndex: number,
    relationshipId: string,
  ) => {
    const sourceNodeId = chainNodes[sourceIndex]!.nodeId;
    const targetNodeId = chainNodes[targetIndex]!.nodeId;
    const segmentRole = "direct";
    return {
      edgeId: createCircuitEdgeId({
        relationshipId,
        edgeType: CircuitEdgeType.CONTAINS,
        direction: "FORWARD",
        sourceNodeId,
        targetNodeId,
        segmentRole,
      }),
      relationshipId,
      sourceNodeId,
      targetNodeId,
      edgeType: CircuitEdgeType.CONTAINS,
      direction: "FORWARD" as const,
      confidence: 1,
      attributes: {},
      metadata: { segmentRole, evidenceIds: [], details: {} },
    };
  };
  const chainEdges = [];
  for (let index = 0; index < nodeCount - 1; index += 1) {
    if (!options.skipAfter?.has(index)) {
      chainEdges.push(makeEdge(index, index + 1, `deep-chain-${index}`));
    }
  }
  for (const [sourceIndex, targetIndex, label] of options.backEdges ?? []) {
    chainEdges.push(makeEdge(sourceIndex, targetIndex, `deep-back-${label}`));
  }
  if (options.parallelAt !== undefined) {
    chainEdges.push(
      makeEdge(
        options.parallelAt,
        options.parallelAt + 1,
        `deep-parallel-${options.parallelAt}`,
      ),
    );
  }
  document.nodes = chainNodes;
  document.edges = chainEdges;
  document.components = chainNodes.map(({ nodeId }) => ({
    componentId: "",
    nodeIds: [nodeId],
    edgeIds: [],
    metadata: { details: {} },
  }));
  document.boundaries = [];
  document.warnings = [];
  return refreshCircuitGraphFixture(document);
}

function makeDeepNonContainmentCycle(
  edgeType:
    | CircuitEdgeType.CONNECTED
    | CircuitEdgeType.REFERENCE
    | CircuitEdgeType.POWER,
) {
  const document = makeContainmentChainDocument(2_000);
  const direction =
    edgeType === CircuitEdgeType.CONNECTED ? "UNDIRECTED" : "FORWARD";
  const nodes = document.nodes;
  document.edges = Array.from({ length: nodes.length }, (_, index) => {
    let sourceNodeId = nodes[index]!.nodeId;
    let targetNodeId = nodes[(index + 1) % nodes.length]!.nodeId;
    if (
      direction === "UNDIRECTED" &&
      testCodepointCompare(sourceNodeId, targetNodeId) > 0
    ) {
      [sourceNodeId, targetNodeId] = [targetNodeId, sourceNodeId];
    }
    const relationshipId = `${edgeType.toLowerCase()}-cycle-${index}`;
    const segmentRole = "direct";
    return {
      edgeId: createCircuitEdgeId({
        relationshipId,
        edgeType,
        direction,
        sourceNodeId,
        targetNodeId,
        segmentRole,
      }),
      relationshipId,
      sourceNodeId,
      targetNodeId,
      edgeType,
      direction,
      confidence: 1,
      attributes: {},
      metadata: { segmentRole, evidenceIds: [], details: {} },
    };
  });
  if (
    edgeType === CircuitEdgeType.CONNECTED ||
    edgeType === CircuitEdgeType.POWER
  ) {
    document.components = [
      {
        componentId: "",
        nodeIds: nodes.map(({ nodeId }) => nodeId),
        edgeIds: document.edges.map(({ edgeId }) => edgeId),
        metadata: { details: {} },
      },
    ];
  }
  return refreshCircuitGraphFixture(document);
}

describe("circuit graph document validation", () => {
  it("accepts a valid canonical graph without mutation", () => {
    const document = makeCircuitGraphDocument();
    const before = structuredClone(document);
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
    expect(() => assertValidCircuitGraphDocument(document)).not.toThrow();
    expect(document).toEqual(before);
  });

  it("accepts an empty Foundation graph", () => {
    const document = makeCircuitGraphDocument();
    document.nodes = [];
    document.edges = [];
    document.components = [];
    refreshCircuitGraphFixture(document);
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("accepts an explicit canonical boundary and warning", () => {
    const document = makeCircuitGraphDocument();
    const nodeId = document.nodes[0]!.nodeId;
    document.boundaries.push({
      boundaryId: createCircuitBoundaryId({
        nodeId,
        externalReferenceId: "page:16:connector-a",
        boundaryType: CircuitBoundaryType.PAGE,
        boundaryRole: CircuitBoundaryRole.OUTGOING,
      }),
      nodeId,
      externalReferenceId: "page:16:connector-a",
      boundaryType: CircuitBoundaryType.PAGE,
      boundaryRole: CircuitBoundaryRole.OUTGOING,
      metadata: { details: { explicit: true } },
    });
    document.warnings.push({
      code: CircuitGraphWarningCode.UNRESOLVED_BOUNDARY,
      message: "Boundary continues on another page",
      relatedIds: [nodeId],
      metadata: { explicit: true },
    });
    refreshCircuitGraphFixture(document);
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each([
    ["schemaVersion", 2, "INVALID_SCHEMA_VERSION"],
    ["source", "", "INVALID_SOURCE"],
    ["sourceSha256", "bad", "INVALID_SOURCE_SHA256"],
    ["page", 0, "INVALID_PAGE"],
  ])("rejects malformed document identity field %s", (field, value, code) => {
    const document = makeCircuitGraphDocument();
    Reflect.set(document, field, value);
    expect(codes(document)).toContain(code);
  });

  it.each([
    ["nodeCount", "NODE_COUNT_MISMATCH"],
    ["edgeCount", "EDGE_COUNT_MISMATCH"],
    ["componentCount", "COMPONENT_COUNT_MISMATCH"],
    ["boundaryCount", "BOUNDARY_COUNT_MISMATCH"],
  ])("rejects %s mismatch", (field, code) => {
    const document = makeCircuitGraphDocument();
    Reflect.set(document, field, 999);
    expect(codes(document)).toContain(code);
  });

  it("rejects derived statistics mismatch", () => {
    const document = makeCircuitGraphDocument();
    document.statistics.edgeTypeCounts.CONNECTED = 99;
    document.statistics.isolatedNodeCount = 99;
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "EDGE_TYPE_COUNTS_MISMATCH",
        "ISOLATED_NODE_COUNT_MISMATCH",
      ]),
    );
  });

  it.each(NEGATIVE_ZERO_STATISTICS_CASES)(
    "rejects -0 in statistics.$label without mutation",
    ({ code, relatedId, get, set }) => {
      const document = makeZeroStatisticsDocument();
      set(document, -0);
      const before = structuredClone(document);

      expect(() => validateCircuitGraphDocument(document)).not.toThrow();
      const result = validateCircuitGraphDocument(document);

      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code, relatedId }),
      );
      expect(Object.is(get(document), -0)).toBe(true);
      expect(document).toEqual(before);
    },
  );

  it("accepts canonical +0 statistics and preserves deterministic bytes", () => {
    const document = makeZeroStatisticsDocument();
    for (const { set } of NEGATIVE_ZERO_STATISTICS_CASES) set(document, 0);

    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
    const first = serializeCircuitGraphDocument(document);
    const second = serializeCircuitGraphDocument(structuredClone(document));
    expect(second).toBe(first);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
  });

  it("does not let the serializer repair negative-zero statistics", () => {
    for (const { code, get, set } of NEGATIVE_ZERO_STATISTICS_CASES) {
      const document = makeZeroStatisticsDocument();
      set(document, -0);
      let serialized: string | undefined;

      expect(() => {
        serialized = serializeCircuitGraphDocument(document);
      }).toThrow(new RegExp(code, "u"));
      expect(serialized).toBeUndefined();
      expect(Object.is(get(document), -0)).toBe(true);
    }
  });

  it("does not let the writer persist repaired negative-zero statistics", () => {
    for (const { code, get, set } of NEGATIVE_ZERO_STATISTICS_CASES) {
      const root = mkdtempSync(join(tmpdir(), "voltai-circuit-negative-zero-"));
      try {
        const document = makeZeroStatisticsDocument();
        set(document, -0);

        expect(() =>
          writeCircuitGraphDocument(root, document, "negative-zero"),
        ).toThrow(new RegExp(code, "u"));
        expect(readdirSync(root)).toEqual([]);
        expect(Object.is(get(document), -0)).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "0"])(
    "retains malformed statistics count rejection for %s",
    (value) => {
      const document = makeZeroStatisticsDocument();
      Reflect.set(document.statistics, "isolatedNodeCount", value);
      expect(codes(document)).toContain("ISOLATED_NODE_COUNT_MISMATCH");
    },
  );

  it("retains missing and extra statistics enum-key rejection", () => {
    const missing = makeZeroStatisticsDocument();
    Reflect.deleteProperty(
      missing.statistics.nodeTypeCounts,
      CircuitNodeType.LIGHTING,
    );
    expect(codes(missing)).toContain("NODE_TYPE_COUNTS_MISMATCH");

    const extra = makeZeroStatisticsDocument();
    Reflect.set(extra.statistics.edgeTypeCounts, "EXTRA", 0);
    expect(codes(extra)).toContain("EDGE_TYPE_COUNTS_MISMATCH");
  });

  it.each([
    ["nodes", "nodeId", "DUPLICATE_NODE_ID"],
    ["edges", "edgeId", "DUPLICATE_EDGE_ID"],
    ["components", "componentId", "DUPLICATE_COMPONENT_ID"],
  ] as const)("rejects duplicate IDs in %s", (collection, _field, code) => {
    const document = makeCircuitGraphDocument();
    document[collection].push(structuredClone(document[collection][0]));
    expect(codes(document)).toContain(code);
  });

  it("rejects duplicate and dangling boundaries", () => {
    const document = makeCircuitGraphDocument();
    const boundaryId = createCircuitBoundaryId({
      nodeId: "missing-node",
      externalReferenceId: "page:16:a",
      boundaryType: CircuitBoundaryType.PAGE,
      boundaryRole: CircuitBoundaryRole.OUTGOING,
    });
    const boundary = {
      boundaryId,
      nodeId: "missing-node",
      externalReferenceId: "page:16:a",
      boundaryType: CircuitBoundaryType.PAGE,
      boundaryRole: CircuitBoundaryRole.OUTGOING,
      metadata: { details: {} },
    };
    document.boundaries.push(boundary, structuredClone(boundary));
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_BOUNDARY_ID",
        "DANGLING_BOUNDARY_NODE_REFERENCE",
      ]),
    );
  });

  it("rejects dangling edge and component references", () => {
    const document = makeCircuitGraphDocument();
    document.edges[0]!.targetNodeId = "missing-node";
    document.components[0]!.nodeIds.push("missing-node");
    document.components[0]!.edgeIds.push("missing-edge");
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "DANGLING_EDGE_NODE_REFERENCE",
        "DANGLING_COMPONENT_NODE_REFERENCE",
        "DANGLING_COMPONENT_EDGE_REFERENCE",
      ]),
    );
  });

  it("rejects every self edge", () => {
    const document = makeCircuitGraphDocument();
    document.edges[0]!.targetNodeId = document.edges[0]!.sourceNodeId;
    expect(codes(document)).toContain("SELF_EDGE");
  });

  it.each([
    [CircuitEdgeType.CONNECTED, "FORWARD"],
    [CircuitEdgeType.CONTAINS, "UNDIRECTED"],
    [CircuitEdgeType.REFERENCE, "UNDIRECTED"],
    [CircuitEdgeType.CONTROL, "UNDIRECTED"],
    [CircuitEdgeType.POWER, "UNDIRECTED"],
    [CircuitEdgeType.SIGNAL, "UNDIRECTED"],
    [CircuitEdgeType.GROUND, "FORWARD"],
  ])("rejects incompatible %s/%s", (edgeType, direction) => {
    const document = makeCircuitGraphDocument();
    document.edges[0]!.edgeType = edgeType;
    document.edges[0]!.direction = direction as "FORWARD" | "UNDIRECTED";
    expect(codes(document)).toContain("INVALID_EDGE_DIRECTION");
  });

  it("rejects component partition mismatch and an omitted isolated node", () => {
    const document = makeCircuitGraphDocument();
    document.components.pop();
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "COMPONENT_PARTITION_MISMATCH",
        "MISSING_NODE_COMPONENT_MEMBERSHIP",
      ]),
    );
  });

  it("rejects ineligible component edges", () => {
    const document = makeCircuitGraphDocument();
    document.components[0]!.edgeIds.push(
      document.edges.find(
        ({ edgeType }) => edgeType === CircuitEdgeType.CONTAINS,
      )!.edgeId,
    );
    expect(codes(document)).toContain("INELIGIBLE_COMPONENT_EDGE");
  });

  it("rejects containment cycles but accepts connected cycles", () => {
    const containment = makeCircuitGraphDocument();
    const contains = containment.edges.find(
      ({ edgeType }) => edgeType === CircuitEdgeType.CONTAINS,
    )!;
    const reverseId = createCircuitEdgeId({
      relationshipId: "relationship-contains-reverse",
      edgeType: CircuitEdgeType.CONTAINS,
      direction: "FORWARD",
      sourceNodeId: contains.targetNodeId,
      targetNodeId: contains.sourceNodeId,
      segmentRole: "direct",
    });
    containment.edges.push({
      ...structuredClone(contains),
      edgeId: reverseId,
      relationshipId: "relationship-contains-reverse",
      sourceNodeId: contains.targetNodeId,
      targetNodeId: contains.sourceNodeId,
    });
    refreshCircuitGraphFixture(containment);
    expect(codes(containment)).toContain("CONTAINMENT_CYCLE");

    const connected = makeCircuitGraphDocument();
    const [first, second, third] = connected.nodes;
    const edges = [
      [first!, second!],
      [second!, third!],
      [third!, first!],
    ] as const;
    connected.edges = edges.map(([source, target], index) => {
      const [sourceNodeId, targetNodeId] = [
        source.nodeId,
        target.nodeId,
      ].sort();
      return {
        edgeId: createCircuitEdgeId({
          relationshipId: `cycle-${index}`,
          edgeType: CircuitEdgeType.CONNECTED,
          direction: "UNDIRECTED",
          sourceNodeId,
          targetNodeId,
          segmentRole: "direct",
        }),
        relationshipId: `cycle-${index}`,
        sourceNodeId,
        targetNodeId,
        edgeType: CircuitEdgeType.CONNECTED,
        direction: "UNDIRECTED",
        confidence: 1,
        attributes: {},
        metadata: { segmentRole: "direct", evidenceIds: [], details: {} },
      };
    });
    connected.components = [
      {
        componentId: "",
        nodeIds: connected.nodes.map(({ nodeId }) => nodeId),
        edgeIds: connected.edges.map(({ edgeId }) => edgeId),
        metadata: { details: {} },
      },
    ];
    refreshCircuitGraphFixture(connected);
    expect(validateCircuitGraphDocument(connected)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("rejects noncanonical arrays and identifiers", () => {
    const document = makeCircuitGraphDocument();
    document.nodes.reverse();
    document.edges[0]!.metadata.evidenceIds.reverse();
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "NONCANONICAL_NODES",
        "NONCANONICAL_EVIDENCE_IDS",
      ]),
    );
  });

  it.each([-0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects malformed confidence %s",
    (confidence) => {
      const document = makeCircuitGraphDocument();
      document.edges[0]!.confidence = confidence;
      expect(codes(document)).toContain("INVALID_EDGE_CONFIDENCE");
    },
  );

  it("rejects public extra fields and symbol properties", () => {
    const document = makeCircuitGraphDocument();
    Reflect.set(document, "internalIndex", new Map());
    Reflect.set(document.nodes[0]!, "privateState", true);
    Reflect.set(document.edges[0]!, Symbol("cache"), true);
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "INVALID_DOCUMENT_SHAPE",
        "INVALID_NODE_SHAPE",
        "INVALID_EDGE_SHAPE",
      ]),
    );
  });

  it("rejects sparse, class, cyclic, polluted, and accessor JSON values", () => {
    const samples: unknown[] = [];
    const sparse = Array.from({ length: 2 });
    delete sparse[0];
    samples.push(sparse, new (class Fixture {})());
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    samples.push(cyclic);
    const polluted = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(polluted, "constructor", {
      value: "bad",
      enumerable: true,
    });
    samples.push(polluted);
    samples.push(
      Object.defineProperty({}, "value", { enumerable: true, get: () => 1 }),
    );
    for (const sample of samples) {
      const document = makeCircuitGraphDocument();
      document.nodes[0]!.attributes = sample as Record<string, never>;
      expect(codes(document)).toContain("INVALID_NODE_ATTRIBUTES");
    }
  });

  it("validates warning shape, code, related IDs, and canonical ordering", () => {
    const document = makeCircuitGraphDocument();
    document.warnings = [
      {
        code: CircuitGraphWarningCode.UNRESOLVED_BOUNDARY,
        message: "z",
        relatedIds: ["z", "a"],
        metadata: {},
      },
      {
        code: CircuitGraphWarningCode.DISCONNECTED_GRAPH,
        message: "a",
        relatedIds: [],
        metadata: {},
      },
    ];
    expect(codes(document)).toEqual(
      expect.arrayContaining([
        "NONCANONICAL_WARNING_RELATED_IDS",
        "NONCANONICAL_WARNINGS",
      ]),
    );
  });

  it("uses an unambiguous strict warning order and stable serialized bytes", () => {
    const split = makeWarning({
      relatedIds: ["a", "b"],
      metadata: { form: "split" },
    });
    const embeddedNul = makeWarning({
      relatedIds: [`a${String.fromCharCode(0)}b`],
      metadata: { form: "joined" },
    });
    const canonicalWarnings = [split, embeddedNul].sort(compareWarnings);
    const canonical = makeCircuitGraphDocument();
    canonical.warnings = structuredClone(canonicalWarnings);
    const reversed = makeCircuitGraphDocument();
    reversed.warnings = structuredClone(canonicalWarnings).reverse();

    expect(validateCircuitGraphDocument(canonical)).toEqual({
      valid: true,
      issues: [],
    });
    expect(codes(reversed)).toContain("NONCANONICAL_WARNINGS");

    const serializations = Array.from({ length: 10 }, () =>
      serializeCircuitGraphDocument(structuredClone(canonical)),
    );
    expect(new Set(serializations).size).toBe(1);
    expect(
      new Set(
        serializations.map((value) =>
          createHash("sha256").update(value).digest("hex"),
        ),
      ).size,
    ).toBe(1);
  });

  it("orders warnings by message and then canonical metadata", () => {
    const metadataWarnings = [
      makeWarning({ message: "same", metadata: { value: 2 } }),
      makeWarning({ message: "same", metadata: { value: 1 } }),
    ].sort(compareWarnings);
    const canonicalMetadata = makeCircuitGraphDocument();
    canonicalMetadata.warnings = structuredClone(metadataWarnings);
    expect(validateCircuitGraphDocument(canonicalMetadata).valid).toBe(true);

    const reversedMetadata = makeCircuitGraphDocument();
    reversedMetadata.warnings = structuredClone(metadataWarnings).reverse();
    expect(codes(reversedMetadata)).toContain("NONCANONICAL_WARNINGS");

    const messageWarnings = [
      makeWarning({ message: "b" }),
      makeWarning({ message: "a" }),
    ].sort(compareWarnings);
    const canonicalMessage = makeCircuitGraphDocument();
    canonicalMessage.warnings = structuredClone(messageWarnings);
    expect(validateCircuitGraphDocument(canonicalMessage).valid).toBe(true);

    const reversedMessage = makeCircuitGraphDocument();
    reversedMessage.warnings = structuredClone(messageWarnings).reverse();
    expect(codes(reversedMessage)).toContain("NONCANONICAL_WARNINGS");
  });

  it("rejects completely duplicate canonical warnings", () => {
    const duplicate = makeWarning({
      relatedIds: ["node-a"],
      metadata: { nested: { a: 1, z: 2 } },
    });
    const document = makeCircuitGraphDocument();
    document.warnings = [
      structuredClone(duplicate),
      structuredClone(duplicate),
    ];
    expect(codes(document)).toContain("DUPLICATE_WARNING");
  });

  it("keeps warning ordering total across NUL, Unicode, and empty values", () => {
    const warnings = [
      makeWarning({ relatedIds: [], metadata: { label: "" } }),
      makeWarning({ relatedIds: ["a"], metadata: { label: "한" } }),
      makeWarning({ relatedIds: [`a${String.fromCharCode(0)}`] }),
      makeWarning({ relatedIds: ["β"] }),
    ].sort(compareWarnings);
    const canonical = makeCircuitGraphDocument();
    canonical.warnings = structuredClone(warnings);
    expect(validateCircuitGraphDocument(canonical).valid).toBe(true);

    for (let index = 1; index < warnings.length; index += 1) {
      expect(
        compareWarnings(warnings[index - 1]!, warnings[index]!),
      ).toBeLessThan(0);
    }
  });

  it("validates and serializes a canonical 20,000-node containment chain without mutation", () => {
    const document = makeContainmentChainDocument(20_000);
    const before = JSON.stringify(document);
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
    expect(serializeCircuitGraphDocument(document)).toMatch(/\n$/u);
    expect(JSON.stringify(document)).toBe(before);
  }, 30_000);

  it("returns a containment-cycle issue for a 20,000-node tail back-edge", () => {
    const document = makeContainmentChainDocument(20_000, {
      backEdges: [[19_999, 0, "tail"]],
    });
    expect(codes(document)).toContain("CONTAINMENT_CYCLE");
  }, 30_000);

  it("validates disconnected deep containment chains", () => {
    const document = makeContainmentChainDocument(12_000, {
      skipAfter: new Set([3_999, 7_999]),
    });
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  }, 30_000);

  it("detects a small cycle in the middle of a deep containment chain", () => {
    const document = makeContainmentChainDocument(12_000, {
      backEdges: [[6_100, 6_000, "middle"]],
    });
    expect(codes(document)).toContain("CONTAINMENT_CYCLE");
  }, 30_000);

  it("does not mistake parallel containment edges for a cycle", () => {
    const document = makeContainmentChainDocument(7_000, { parallelAt: 3_500 });
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each([
    CircuitEdgeType.CONNECTED,
    CircuitEdgeType.REFERENCE,
    CircuitEdgeType.POWER,
  ])("keeps deep %s cycles valid", (edgeType) => {
    const document = makeDeepNonContainmentCycle(edgeType);
    expect(validateCircuitGraphDocument(document)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("allows N:1 node identity in the Foundation", () => {
    const document = makeCircuitGraphDocument();
    const node = document.nodes[0]!;
    const oldNodeId = node.nodeId;
    node.objectIds = ["object-panel", "object-panel-aux"];
    node.nodeId = createCircuitNodeId({
      sourceSha256: document.sourceSha256,
      page: document.page,
      objectIds: node.objectIds,
      nodeRole: node.metadata.role,
    });
    for (const candidate of document.edges) {
      if (candidate.sourceNodeId === oldNodeId)
        candidate.sourceNodeId = node.nodeId;
      if (candidate.targetNodeId === oldNodeId)
        candidate.targetNodeId = node.nodeId;
      if (
        candidate.direction === "UNDIRECTED" &&
        candidate.sourceNodeId > candidate.targetNodeId
      ) {
        [candidate.sourceNodeId, candidate.targetNodeId] = [
          candidate.targetNodeId,
          candidate.sourceNodeId,
        ];
      }
      candidate.edgeId = createCircuitEdgeId({
        relationshipId: candidate.relationshipId,
        edgeType: candidate.edgeType,
        direction: candidate.direction,
        sourceNodeId: candidate.sourceNodeId,
        targetNodeId: candidate.targetNodeId,
        segmentRole: candidate.metadata.segmentRole,
      });
    }
    for (const component of document.components) {
      component.nodeIds = component.nodeIds.map((id) =>
        id === oldNodeId ? node.nodeId : id,
      );
      component.edgeIds = document.edges
        .filter(
          (candidate) =>
            component.nodeIds.includes(candidate.sourceNodeId) &&
            component.nodeIds.includes(candidate.targetNodeId) &&
            candidate.edgeType === CircuitEdgeType.CONNECTED,
        )
        .map(({ edgeId }) => edgeId);
      component.componentId = createCircuitComponentId(component);
    }
    refreshCircuitGraphFixture(document);
    expect(validateCircuitGraphDocument(document).valid).toBe(true);
  });
});
