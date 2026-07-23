import type {
  CircuitGraphDocument,
  CircuitNode,
} from "../drawingCircuitGraph/types.js";
import {
  createCircuitGraphQueryIndex,
  getCachedCircuitGraphQueryIndex,
  nodesForIds,
  type CircuitGraphQueryIndex,
} from "./queryIndex.js";
import {
  validateCircuitGraphQuery,
  validateQueryGraph,
} from "./queryValidation.js";
import type { CircuitGraphQuery, CircuitGraphQueryResult } from "./types.js";

function queryIndexFor(
  graphValue: CircuitGraphDocument,
): CircuitGraphQueryIndex {
  const cached = getCachedCircuitGraphQueryIndex(graphValue);
  if (cached !== undefined) return cached;
  return createCircuitGraphQueryIndex(validateQueryGraph(graphValue));
}

function matchedNodes(
  index: CircuitGraphQueryIndex,
  query: CircuitGraphQuery,
): readonly CircuitNode[] {
  switch (query.kind) {
    case "FIND_NODE": {
      const node = index.nodeById.get(query.nodeId);
      return node === undefined ? [] : [node];
    }
    case "FIND_NODES_BY_TYPE":
      return index.nodesByType.get(query.nodeType) ?? [];
    case "FIND_NODES_BY_DISPLAY_NAME":
      return index.nodesByDisplayName.get(query.displayName) ?? [];
    case "FIND_CONNECTED_NEIGHBORS":
      return nodesForIds(index, index.connectedNeighborIds.get(query.nodeId));
    case "FIND_CONTAINED_NODES":
      return nodesForIds(index, index.containedNodeIds.get(query.nodeId));
    case "FIND_REFERENCED_NODES":
      return nodesForIds(index, index.referencedNodeIds.get(query.nodeId));
  }
}

function createResult(
  queryKind: CircuitGraphQuery["kind"],
  matched: readonly CircuitNode[],
): CircuitGraphQueryResult {
  const nodes = Object.freeze([...matched]);
  return Object.freeze({
    queryKind,
    nodeCount: nodes.length,
    nodes,
  });
}

export function queryCircuitGraph(
  graph: CircuitGraphDocument,
  queryValue: CircuitGraphQuery,
): CircuitGraphQueryResult {
  const query = validateCircuitGraphQuery(queryValue);
  const index = queryIndexFor(graph);
  return createResult(query.kind, matchedNodes(index, query));
}
