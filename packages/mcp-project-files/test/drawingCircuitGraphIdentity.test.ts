import { describe, expect, it } from "vitest";

import {
  createCircuitBoundaryId,
  createCircuitComponentId,
  createCircuitEdgeId,
  createCircuitGraphId,
  createCircuitNodeId,
} from "../src/drawingCircuitGraph/identity.js";
import {
  CircuitBoundaryRole,
  CircuitBoundaryType,
  CircuitEdgeType,
} from "../src/drawingCircuitGraph/types.js";
import { makeCircuitGraphDocument } from "./helpers/drawingCircuitGraphFixture.js";

describe("circuit graph identity authority", () => {
  const nodeInput = {
    sourceSha256: "a".repeat(64),
    page: 15,
    objectIds: ["object-b", "object-a"],
    nodeRole: "object",
  } as const;

  it("makes node identity independent of object input order and rejects duplicates", () => {
    const first = createCircuitNodeId(nodeInput);
    const second = createCircuitNodeId({
      ...nodeInput,
      objectIds: [...nodeInput.objectIds].reverse(),
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^cgn_[a-f0-9]{64}$/u);
    expect(() => createCircuitNodeId({ ...nodeInput, objectIds: [] })).toThrow(
      /object/i,
    );
    expect(() =>
      createCircuitNodeId({ ...nodeInput, objectIds: ["a", "a"] }),
    ).toThrow(/duplicate/i);
  });

  it("canonicalizes undirected endpoints but preserves forward order", () => {
    const shared = {
      relationshipId: "relationship-a",
      edgeType: CircuitEdgeType.CONNECTED,
      direction: "UNDIRECTED" as const,
      segmentRole: "direct",
    };
    expect(
      createCircuitEdgeId({
        ...shared,
        sourceNodeId: "node-b",
        targetNodeId: "node-a",
      }),
    ).toBe(
      createCircuitEdgeId({
        ...shared,
        sourceNodeId: "node-a",
        targetNodeId: "node-b",
      }),
    );
    const forward = {
      ...shared,
      edgeType: CircuitEdgeType.CONTAINS,
      direction: "FORWARD" as const,
    };
    expect(
      createCircuitEdgeId({
        ...forward,
        sourceNodeId: "node-a",
        targetNodeId: "node-b",
      }),
    ).not.toBe(
      createCircuitEdgeId({
        ...forward,
        sourceNodeId: "node-b",
        targetNodeId: "node-a",
      }),
    );
  });

  it("includes relationship and segment role in edge identity", () => {
    const input = {
      relationshipId: "relationship-a",
      edgeType: CircuitEdgeType.CONNECTED,
      direction: "UNDIRECTED" as const,
      sourceNodeId: "node-a",
      targetNodeId: "node-b",
      segmentRole: "direct",
    };
    const baseline = createCircuitEdgeId(input);
    expect(
      createCircuitEdgeId({ ...input, relationshipId: "relationship-b" }),
    ).not.toBe(baseline);
    expect(
      createCircuitEdgeId({ ...input, segmentRole: "via-source" }),
    ).not.toBe(baseline);
    expect(baseline).toMatch(/^cge_[a-f0-9]{64}$/u);
  });

  it("rejects malformed runtime enum values at the identity boundary", () => {
    expect(() =>
      createCircuitEdgeId({
        relationshipId: "relationship-a",
        edgeType: "UNKNOWN" as CircuitEdgeType,
        direction: "UNDIRECTED",
        sourceNodeId: "node-a",
        targetNodeId: "node-b",
        segmentRole: "direct",
      }),
    ).toThrow(/edge type/i);
    expect(() =>
      createCircuitBoundaryId({
        nodeId: "node-a",
        externalReferenceId: "page:16:a",
        boundaryType: "UNKNOWN" as CircuitBoundaryType,
        boundaryRole: CircuitBoundaryRole.OUTGOING,
      }),
    ).toThrow(/boundary type/i);
  });

  it("stabilizes component identity and permits isolated components", () => {
    const first = createCircuitComponentId({
      nodeIds: ["b", "a"],
      edgeIds: ["e2", "e1"],
    });
    const second = createCircuitComponentId({
      nodeIds: ["a", "b"],
      edgeIds: ["e1", "e2"],
    });
    expect(first).toBe(second);
    expect(createCircuitComponentId({ nodeIds: ["a"], edgeIds: [] })).toMatch(
      /^cgc_[a-f0-9]{64}$/u,
    );
  });

  it("keeps boundary and graph identity in separate domains", () => {
    const boundary = createCircuitBoundaryId({
      nodeId: "node-a",
      externalReferenceId: "page:16:connector:a",
      boundaryType: CircuitBoundaryType.PAGE,
      boundaryRole: CircuitBoundaryRole.OUTGOING,
    });
    expect(boundary).toMatch(/^cgb_[a-f0-9]{64}$/u);
    expect(
      new Set([
        createCircuitNodeId(nodeInput).slice(0, 4),
        createCircuitEdgeId({
          relationshipId: "r",
          edgeType: CircuitEdgeType.CONNECTED,
          direction: "UNDIRECTED",
          sourceNodeId: "a",
          targetNodeId: "b",
          segmentRole: "direct",
        }).slice(0, 4),
        createCircuitComponentId({ nodeIds: ["a"], edgeIds: [] }).slice(0, 4),
        boundary.slice(0, 4),
      ]).size,
    ).toBe(4);
  });

  it("makes graph identity independent of warnings and statistics", () => {
    const document = makeCircuitGraphDocument();
    const input = {
      schemaVersion: document.schemaVersion,
      projectionProfile: document.metadata.projectionProfile,
      projectionProfileVersion: document.metadata.projectionProfileVersion,
      source: document.source,
      sourceSha256: document.sourceSha256,
      page: document.page,
      nodeIds: document.nodes.map(({ nodeId }) => nodeId),
      edgeIds: document.edges.map(({ edgeId }) => edgeId),
      componentIds: document.components.map(({ componentId }) => componentId),
      boundaryIds: document.boundaries.map(({ boundaryId }) => boundaryId),
    };
    expect(createCircuitGraphId(input)).toBe(document.graphId);
    expect(document.graphId).toMatch(/^cgg_[a-f0-9]{64}$/u);
    document.warnings.push({
      code: "DISCONNECTED_GRAPH",
      message: "two components",
      relatedIds: [],
      metadata: {},
    });
    document.statistics.isolatedNodeCount = 99;
    expect(createCircuitGraphId(input)).toBe(document.graphId);
  });
});
