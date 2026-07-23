import { deepFreezeCircuitValue } from "../drawingCircuitGraph/jsonValue.js";
import {
  CircuitEdgeType,
  type CircuitGraphDocument,
  type CircuitNode,
  type CircuitNodeType,
} from "../drawingCircuitGraph/types.js";

export type CircuitGraphQueryIndex = {
  readonly nodes: readonly CircuitNode[];
  readonly nodeById: ReadonlyMap<string, CircuitNode>;
  readonly nodesByType: ReadonlyMap<CircuitNodeType, readonly CircuitNode[]>;
  readonly nodesByDisplayName: ReadonlyMap<string, readonly CircuitNode[]>;
  readonly connectedNeighborIds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly containedNodeIds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly referencedNodeIds: ReadonlyMap<string, ReadonlySet<string>>;
};

const frozenGraphIndexes = new WeakMap<object, CircuitGraphQueryIndex>();

function addToArrayMap<TKey>(
  map: Map<TKey, CircuitNode[]>,
  key: TKey,
  node: CircuitNode,
): void {
  const nodes = map.get(key);
  if (nodes === undefined) map.set(key, [node]);
  else nodes.push(node);
}

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, new Set([value]));
  else values.add(value);
}

function freezeArrayMap<TKey>(
  source: Map<TKey, CircuitNode[]>,
): Map<TKey, readonly CircuitNode[]> {
  const frozen = new Map<TKey, readonly CircuitNode[]>();
  for (const [key, nodes] of source) frozen.set(key, Object.freeze(nodes));
  return frozen;
}

function cloneNode(node: CircuitNode): CircuitNode {
  return deepFreezeCircuitValue(structuredClone(node));
}

function buildCircuitGraphQueryIndex(
  graph: CircuitGraphDocument,
): CircuitGraphQueryIndex {
  const nodes = Object.freeze(graph.nodes.map(cloneNode));
  const nodeById = new Map<string, CircuitNode>();
  const mutableNodesByType = new Map<CircuitNodeType, CircuitNode[]>();
  const mutableNodesByDisplayName = new Map<string, CircuitNode[]>();
  const connectedNeighborIds = new Map<string, Set<string>>();
  const containedNodeIds = new Map<string, Set<string>>();
  const referencedNodeIds = new Map<string, Set<string>>();

  for (const node of nodes) {
    nodeById.set(node.nodeId, node);
    addToArrayMap(mutableNodesByType, node.nodeType, node);
    if (node.displayName !== null) {
      addToArrayMap(mutableNodesByDisplayName, node.displayName, node);
    }
  }

  for (const edge of graph.edges) {
    if (edge.edgeType === CircuitEdgeType.CONNECTED) {
      addToSetMap(connectedNeighborIds, edge.sourceNodeId, edge.targetNodeId);
      addToSetMap(connectedNeighborIds, edge.targetNodeId, edge.sourceNodeId);
    } else if (edge.edgeType === CircuitEdgeType.CONTAINS) {
      addToSetMap(containedNodeIds, edge.sourceNodeId, edge.targetNodeId);
    } else if (edge.edgeType === CircuitEdgeType.REFERENCE) {
      addToSetMap(referencedNodeIds, edge.sourceNodeId, edge.targetNodeId);
    }
  }

  return Object.freeze({
    nodes,
    nodeById,
    nodesByType: freezeArrayMap(mutableNodesByType),
    nodesByDisplayName: freezeArrayMap(mutableNodesByDisplayName),
    connectedNeighborIds,
    containedNodeIds,
    referencedNodeIds,
  });
}

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const pending: object[] = [value];
  const seen = new WeakSet<object>();
  try {
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      if (!Object.isFrozen(current)) return false;
      for (const key of Reflect.ownKeys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor)) return false;
        if (typeof descriptor.value === "object" && descriptor.value !== null) {
          pending.push(descriptor.value);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function getCachedCircuitGraphQueryIndex(
  graph: unknown,
): CircuitGraphQueryIndex | undefined {
  return typeof graph === "object" && graph !== null
    ? frozenGraphIndexes.get(graph)
    : undefined;
}

export function createCircuitGraphQueryIndex(
  graph: CircuitGraphDocument,
): CircuitGraphQueryIndex {
  const index = buildCircuitGraphQueryIndex(graph);
  if (isDeepFrozen(graph)) frozenGraphIndexes.set(graph, index);
  return index;
}

export function nodesForIds(
  index: CircuitGraphQueryIndex,
  ids: ReadonlySet<string> | undefined,
): readonly CircuitNode[] {
  return ids === undefined
    ? []
    : index.nodes.filter(({ nodeId }) => ids.has(nodeId));
}
