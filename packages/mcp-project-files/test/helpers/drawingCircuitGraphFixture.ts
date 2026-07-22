import {
  createCircuitComponentId,
  createCircuitEdgeId,
  createCircuitGraphId,
  createCircuitNodeId,
} from "../../src/drawingCircuitGraph/identity.js";
import { codepointCompare } from "../../src/drawingCircuitGraph/ordering.js";
import {
  CircuitEdgeType,
  CircuitNodeType,
  type CircuitGraphDocument,
} from "../../src/drawingCircuitGraph/types.js";

export type Mutable<T> = T extends readonly (infer TEntry)[]
  ? Mutable<TEntry>[]
  : T extends object
    ? { -readonly [TKey in keyof T]: Mutable<T[TKey]> }
    : T;

export function deepFreezeCircuitFixture<T>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreezeCircuitFixture(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

function emptyNodeTypeCounts(): Record<CircuitNodeType, number> {
  return Object.fromEntries(
    Object.values(CircuitNodeType).map((type) => [type, 0]),
  ) as Record<CircuitNodeType, number>;
}

function emptyEdgeTypeCounts(): Record<CircuitEdgeType, number> {
  return Object.fromEntries(
    Object.values(CircuitEdgeType).map((type) => [type, 0]),
  ) as Record<CircuitEdgeType, number>;
}

export function refreshCircuitGraphFixture(
  document: Mutable<CircuitGraphDocument>,
): Mutable<CircuitGraphDocument> {
  document.nodes.sort((left, right) =>
    codepointCompare(left.nodeId, right.nodeId),
  );
  document.edges.sort((left, right) =>
    codepointCompare(left.edgeId, right.edgeId),
  );
  for (const component of document.components) {
    component.nodeIds.sort(codepointCompare);
    component.edgeIds.sort(codepointCompare);
    component.componentId = createCircuitComponentId({
      nodeIds: component.nodeIds,
      edgeIds: component.edgeIds,
    });
  }
  document.components.sort((left, right) =>
    codepointCompare(left.componentId, right.componentId),
  );
  document.boundaries.sort((left, right) =>
    codepointCompare(left.boundaryId, right.boundaryId),
  );
  document.warnings.sort(
    (left, right) =>
      codepointCompare(left.code, right.code) ||
      codepointCompare(
        left.relatedIds.join("\u0000"),
        right.relatedIds.join("\u0000"),
      ) ||
      codepointCompare(left.message, right.message),
  );

  const nodeTypeCounts = emptyNodeTypeCounts();
  for (const node of document.nodes) nodeTypeCounts[node.nodeType] += 1;
  const edgeTypeCounts = emptyEdgeTypeCounts();
  for (const edge of document.edges) edgeTypeCounts[edge.edgeType] += 1;
  document.nodeCount = document.nodes.length;
  document.edgeCount = document.edges.length;
  document.componentCount = document.components.length;
  document.boundaryCount = document.boundaries.length;
  document.statistics = {
    nodeTypeCounts,
    edgeTypeCounts,
    isolatedNodeCount: document.components.filter(
      (component) =>
        component.nodeIds.length === 1 && component.edgeIds.length === 0,
    ).length,
    connectedComponentCount: document.components.length,
  };
  document.graphId = createCircuitGraphId({
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
  });
  return document;
}

export function makeCircuitGraphDocument(): Mutable<CircuitGraphDocument> {
  const sourceSha256 = "a".repeat(64);
  const page = 15;
  const panelNodeId = createCircuitNodeId({
    sourceSha256,
    page,
    objectIds: ["object-panel"],
    nodeRole: "object",
  });
  const breakerNodeId = createCircuitNodeId({
    sourceSha256,
    page,
    objectIds: ["object-breaker"],
    nodeRole: "object",
  });
  const cableNodeId = createCircuitNodeId({
    sourceSha256,
    page,
    objectIds: ["object-cable"],
    nodeRole: "object",
  });
  const connectedEdgeId = createCircuitEdgeId({
    relationshipId: "relationship-connected",
    edgeType: CircuitEdgeType.CONNECTED,
    direction: "UNDIRECTED",
    sourceNodeId: panelNodeId,
    targetNodeId: breakerNodeId,
    segmentRole: "direct",
  });
  const containsEdgeId = createCircuitEdgeId({
    relationshipId: "relationship-contains",
    edgeType: CircuitEdgeType.CONTAINS,
    direction: "FORWARD",
    sourceNodeId: panelNodeId,
    targetNodeId: cableNodeId,
    segmentRole: "direct",
  });
  const document: Mutable<CircuitGraphDocument> = {
    schemaVersion: 1,
    graphId: "",
    source: "docs/전기 회로.pdf",
    sourceSha256,
    page,
    nodeCount: 0,
    edgeCount: 0,
    componentCount: 0,
    boundaryCount: 0,
    nodes: [
      {
        nodeId: panelNodeId,
        objectIds: ["object-panel"],
        nodeType: CircuitNodeType.PANEL,
        displayName: "LP-1",
        location: { x: 10, y: 20, width: 30, height: 40 },
        attributes: { name: "LP-1", nested: { z: 0, a: "분전반" } },
        metadata: { role: "object", details: { sourceStatus: "accepted" } },
      },
      {
        nodeId: breakerNodeId,
        objectIds: ["object-breaker"],
        nodeType: CircuitNodeType.BREAKER,
        displayName: "MCCB-1",
        location: { x: 50, y: 20, width: 10, height: 10 },
        attributes: { rating: "100A" },
        metadata: { role: "object", details: {} },
      },
      {
        nodeId: cableNodeId,
        objectIds: ["object-cable"],
        nodeType: CircuitNodeType.CABLE,
        displayName: null,
        location: null,
        attributes: { offset: -0 },
        metadata: { role: "object", details: {} },
      },
    ],
    edges: [
      {
        edgeId: connectedEdgeId,
        relationshipId: "relationship-connected",
        sourceNodeId: panelNodeId,
        targetNodeId: breakerNodeId,
        edgeType: CircuitEdgeType.CONNECTED,
        direction: "UNDIRECTED",
        confidence: 0.9,
        attributes: { circuit: "C1" },
        metadata: {
          segmentRole: "direct",
          evidenceIds: ["graph-edge:a", "spatial:1"],
          details: {},
        },
      },
      {
        edgeId: containsEdgeId,
        relationshipId: "relationship-contains",
        sourceNodeId: panelNodeId,
        targetNodeId: cableNodeId,
        edgeType: CircuitEdgeType.CONTAINS,
        direction: "FORWARD",
        confidence: 0.8,
        attributes: {},
        metadata: {
          segmentRole: "direct",
          evidenceIds: ["spatial:2"],
          details: {},
        },
      },
    ],
    components: [
      {
        componentId: "",
        nodeIds: [panelNodeId, breakerNodeId],
        edgeIds: [connectedEdgeId],
        metadata: { details: {} },
      },
      {
        componentId: "",
        nodeIds: [cableNodeId],
        edgeIds: [],
        metadata: { details: {} },
      },
    ],
    boundaries: [],
    statistics: {
      nodeTypeCounts: emptyNodeTypeCounts(),
      edgeTypeCounts: emptyEdgeTypeCounts(),
      isolatedNodeCount: 0,
      connectedComponentCount: 0,
    },
    warnings: [],
    metadata: {
      projectionProfile: "relationship-v1",
      projectionProfileVersion: 1,
      objectDocumentSchemaVersion: 1,
      relationshipDocumentSchemaVersion: 1,
    },
  };
  return refreshCircuitGraphFixture(document);
}
