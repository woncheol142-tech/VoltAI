import { fileURLToPath } from "node:url";

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
  type CircuitEdge,
  type CircuitGraphDocument,
  type CircuitNode,
} from "../../src/drawingCircuitGraph/types.js";

export const QUERY_SOURCE = "docs/circuit-query.pdf";
export const QUERY_SOURCE_SHA256 = "f".repeat(64);
export const QUERY_PAGE = 44;

export type QueryKind =
  | "FIND_NODE"
  | "FIND_NODES_BY_TYPE"
  | "FIND_NODES_BY_DISPLAY_NAME"
  | "FIND_CONNECTED_NEIGHBORS"
  | "FIND_CONTAINED_NODES"
  | "FIND_REFERENCED_NODES";

export type QueryInput =
  | { readonly kind: "FIND_NODE"; readonly nodeId: string }
  | {
      readonly kind: "FIND_NODES_BY_TYPE";
      readonly nodeType: CircuitNodeType;
    }
  | {
      readonly kind: "FIND_NODES_BY_DISPLAY_NAME";
      readonly displayName: string;
    }
  | {
      readonly kind: "FIND_CONNECTED_NEIGHBORS";
      readonly nodeId: string;
    }
  | { readonly kind: "FIND_CONTAINED_NODES"; readonly nodeId: string }
  | { readonly kind: "FIND_REFERENCED_NODES"; readonly nodeId: string };

export type QueryResult = {
  readonly queryKind: QueryKind;
  readonly nodeCount: number;
  readonly nodes: readonly CircuitNode[];
};

export type QueryModule = {
  queryCircuitGraph(
    graph: CircuitGraphDocument,
    query: QueryInput,
  ): QueryResult;
};

export type QueryNodeOptions = {
  id: string;
  nodeType?: CircuitNodeType;
  displayName?: string | null;
  attributes?: CircuitNode["attributes"];
};

export type QueryEdgeOptions = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: CircuitEdgeType;
};

const COMPONENT_EDGE_TYPES = new Set<CircuitEdgeType>([
  CircuitEdgeType.CONNECTED,
  CircuitEdgeType.CONTROL,
  CircuitEdgeType.POWER,
  CircuitEdgeType.SIGNAL,
  CircuitEdgeType.GROUND,
]);

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

function directionFor(edgeType: CircuitEdgeType): CircuitEdge["direction"] {
  return edgeType === CircuitEdgeType.CONNECTED ||
    edgeType === CircuitEdgeType.GROUND
    ? "UNDIRECTED"
    : "FORWARD";
}

export function makeQueryNode(options: QueryNodeOptions): CircuitNode {
  const objectId = `object-${options.id}`;
  return {
    nodeId: createCircuitNodeId({
      sourceSha256: QUERY_SOURCE_SHA256,
      page: QUERY_PAGE,
      objectIds: [objectId],
      nodeRole: "object",
    }),
    objectIds: [objectId],
    nodeType: options.nodeType ?? CircuitNodeType.EQUIPMENT,
    displayName:
      options.displayName === undefined
        ? `Display ${options.id}`
        : options.displayName,
    location: { x: 1, y: 2, width: 3, height: 4 },
    attributes: options.attributes ?? {
      tag: options.id,
      nested: { code: `nested-${options.id}` },
    },
    metadata: { role: "object", details: { sourceId: options.id } },
  };
}

export function makeQueryEdge(options: QueryEdgeOptions): CircuitEdge {
  const direction = directionFor(options.edgeType);
  const relationshipId = `relationship-${options.id}`;
  let sourceNodeId = options.sourceNodeId;
  let targetNodeId = options.targetNodeId;
  if (
    direction === "UNDIRECTED" &&
    codepointCompare(sourceNodeId, targetNodeId) > 0
  ) {
    [sourceNodeId, targetNodeId] = [targetNodeId, sourceNodeId];
  }
  return {
    edgeId: createCircuitEdgeId({
      relationshipId,
      edgeType: options.edgeType,
      direction,
      sourceNodeId,
      targetNodeId,
      segmentRole: "direct",
    }),
    relationshipId,
    sourceNodeId,
    targetNodeId,
    edgeType: options.edgeType,
    direction,
    confidence: 1,
    attributes: {},
    metadata: { segmentRole: "direct", evidenceIds: [], details: {} },
  };
}

function deriveComponents(
  nodes: readonly CircuitNode[],
  edges: readonly CircuitEdge[],
) {
  const parent = new Map(nodes.map(({ nodeId }) => [nodeId, nodeId]));
  const find = (start: string): string => {
    let root = start;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = start;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  for (const edge of edges) {
    if (!COMPONENT_EDGE_TYPES.has(edge.edgeType)) continue;
    const sourceRoot = find(edge.sourceNodeId);
    const targetRoot = find(edge.targetNodeId);
    if (sourceRoot !== targetRoot) parent.set(targetRoot, sourceRoot);
  }

  const groups = new Map<string, { nodeIds: string[]; edgeIds: string[] }>();
  for (const node of nodes) {
    const root = find(node.nodeId);
    const group = groups.get(root) ?? { nodeIds: [], edgeIds: [] };
    group.nodeIds.push(node.nodeId);
    groups.set(root, group);
  }
  for (const edge of edges) {
    if (!COMPONENT_EDGE_TYPES.has(edge.edgeType)) continue;
    groups.get(find(edge.sourceNodeId))!.edgeIds.push(edge.edgeId);
  }

  return [...groups.values()]
    .map(({ nodeIds, edgeIds }) => {
      nodeIds.sort(codepointCompare);
      edgeIds.sort(codepointCompare);
      return {
        componentId: createCircuitComponentId({ nodeIds, edgeIds }),
        nodeIds,
        edgeIds,
        metadata: { details: {} },
      };
    })
    .sort((left, right) =>
      codepointCompare(left.componentId, right.componentId),
    );
}

export function makeQueryGraph(
  options: {
    nodes?: readonly CircuitNode[];
    edges?: readonly CircuitEdge[];
  } = {},
): CircuitGraphDocument {
  const nodes = [...(options.nodes ?? [])].sort((left, right) =>
    codepointCompare(left.nodeId, right.nodeId),
  );
  const edges = [...(options.edges ?? [])].sort((left, right) =>
    codepointCompare(left.edgeId, right.edgeId),
  );
  const components = deriveComponents(nodes, edges);
  const nodeTypeCounts = emptyNodeTypeCounts();
  for (const node of nodes) nodeTypeCounts[node.nodeType] += 1;
  const edgeTypeCounts = emptyEdgeTypeCounts();
  for (const edge of edges) edgeTypeCounts[edge.edgeType] += 1;
  const graphId = createCircuitGraphId({
    schemaVersion: 1,
    projectionProfile: "query-fixture-v1",
    projectionProfileVersion: 1,
    source: QUERY_SOURCE,
    sourceSha256: QUERY_SOURCE_SHA256,
    page: QUERY_PAGE,
    nodeIds: nodes.map(({ nodeId }) => nodeId),
    edgeIds: edges.map(({ edgeId }) => edgeId),
    componentIds: components.map(({ componentId }) => componentId),
    boundaryIds: [],
  });
  return {
    schemaVersion: 1,
    graphId,
    source: QUERY_SOURCE,
    sourceSha256: QUERY_SOURCE_SHA256,
    page: QUERY_PAGE,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    componentCount: components.length,
    boundaryCount: 0,
    nodes,
    edges,
    components,
    boundaries: [],
    statistics: {
      nodeTypeCounts,
      edgeTypeCounts,
      isolatedNodeCount: components.filter(
        ({ nodeIds, edgeIds }) => nodeIds.length === 1 && edgeIds.length === 0,
      ).length,
      connectedComponentCount: components.length,
    },
    warnings: [],
    metadata: {
      projectionProfile: "query-fixture-v1",
      projectionProfileVersion: 1,
      objectDocumentSchemaVersion: 1,
      relationshipDocumentSchemaVersion: 1,
    },
  };
}

export function makeLargeQueryGraph(nodeCount: number): CircuitGraphDocument {
  const nodes = Array.from({ length: nodeCount }, (_, index) =>
    makeQueryNode({
      id: `large-${String(index).padStart(6, "0")}`,
      nodeType:
        index % 2 === 0 ? CircuitNodeType.EQUIPMENT : CircuitNodeType.CABLE,
      displayName: `Large ${String(index).padStart(6, "0")}`,
    }),
  );
  return makeQueryGraph({ nodes });
}

export function nodeIds(nodes: readonly CircuitNode[]): string[] {
  return nodes.map(({ nodeId }) => nodeId);
}

export async function importCircuitGraphQueryModule(): Promise<QueryModule> {
  const moduleUrl = new URL(
    "../../src/drawingCircuitGraphQuery/index.ts",
    import.meta.url,
  );
  return import(
    /* @vite-ignore */ fileURLToPath(moduleUrl)
  ) as Promise<QueryModule>;
}
