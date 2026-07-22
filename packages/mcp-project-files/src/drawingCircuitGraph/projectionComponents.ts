import { createCircuitComponentId } from "./identity.js";
import { codepointCompare } from "./ordering.js";
import {
  CircuitEdgeType,
  type CircuitComponent,
  type CircuitEdge,
  type CircuitNode,
} from "./types.js";

const CONNECTIVITY_EDGE_TYPES = new Set<CircuitEdgeType>([
  CircuitEdgeType.CONNECTED,
  CircuitEdgeType.POWER,
  CircuitEdgeType.SIGNAL,
  CircuitEdgeType.CONTROL,
  CircuitEdgeType.GROUND,
]);

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[index] !== index) {
      const next = this.parent[index]!;
      this.parent[index] = root;
      index = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.rank[leftRoot]! < this.rank[rightRoot]!) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }
    this.parent[rightRoot] = leftRoot;
    if (this.rank[leftRoot] === this.rank[rightRoot]) {
      this.rank[leftRoot] += 1;
    }
  }
}

type MutableComponent = {
  nodeIds: string[];
  edgeIds: string[];
};

export function deriveCircuitComponents(
  nodes: readonly CircuitNode[],
  edges: readonly CircuitEdge[],
): CircuitComponent[] {
  const nodeIndex = new Map(
    nodes.map(({ nodeId }, index) => [nodeId, index] as const),
  );
  const unionFind = new UnionFind(nodes.length);

  for (const edge of edges) {
    if (!CONNECTIVITY_EDGE_TYPES.has(edge.edgeType)) continue;
    const source = nodeIndex.get(edge.sourceNodeId);
    const target = nodeIndex.get(edge.targetNodeId);
    if (source !== undefined && target !== undefined) {
      unionFind.union(source, target);
    }
  }

  const byRoot = new Map<number, MutableComponent>();
  for (let index = 0; index < nodes.length; index += 1) {
    const root = unionFind.find(index);
    const component = byRoot.get(root) ?? { nodeIds: [], edgeIds: [] };
    component.nodeIds.push(nodes[index]!.nodeId);
    byRoot.set(root, component);
  }

  for (const edge of edges) {
    if (!CONNECTIVITY_EDGE_TYPES.has(edge.edgeType)) continue;
    const source = nodeIndex.get(edge.sourceNodeId);
    if (source !== undefined) {
      byRoot.get(unionFind.find(source))!.edgeIds.push(edge.edgeId);
    }
  }

  return [...byRoot.values()]
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

export type ReferenceCycleSummary = {
  nodeIds: string[];
  edgeIds: string[];
};

export function findReferenceCycles(
  nodes: readonly CircuitNode[],
  edges: readonly CircuitEdge[],
): ReferenceCycleSummary | null {
  const nodeIndex = new Map(
    nodes.map(({ nodeId }, index) => [nodeId, index] as const),
  );
  const adjacency = Array.from({ length: nodes.length }, () => [] as number[]);
  const reverse = Array.from({ length: nodes.length }, () => [] as number[]);
  const referenceEdges = edges.filter(
    ({ edgeType }) => edgeType === CircuitEdgeType.REFERENCE,
  );

  for (const edge of referenceEdges) {
    const source = nodeIndex.get(edge.sourceNodeId);
    const target = nodeIndex.get(edge.targetNodeId);
    if (source === undefined || target === undefined) continue;
    adjacency[source]!.push(target);
    reverse[target]!.push(source);
  }

  const visited = new Uint8Array(nodes.length);
  const finishOrder: number[] = [];
  for (let start = 0; start < nodes.length; start += 1) {
    if (visited[start] !== 0) continue;
    visited[start] = 1;
    const nodeStack = [start];
    const nextStack = [0];
    while (nodeStack.length > 0) {
      const top = nodeStack.length - 1;
      const node = nodeStack[top]!;
      const next = nextStack[top]!;
      const neighbors = adjacency[node]!;
      if (next < neighbors.length) {
        nextStack[top] = next + 1;
        const neighbor = neighbors[next]!;
        if (visited[neighbor] === 0) {
          visited[neighbor] = 1;
          nodeStack.push(neighbor);
          nextStack.push(0);
        }
      } else {
        finishOrder.push(node);
        nodeStack.pop();
        nextStack.pop();
      }
    }
  }

  const componentByNode = new Int32Array(nodes.length);
  componentByNode.fill(-1);
  const cyclicComponents = new Set<number>();
  let componentIndex = 0;
  for (let offset = finishOrder.length - 1; offset >= 0; offset -= 1) {
    const start = finishOrder[offset]!;
    if (componentByNode[start] !== -1) continue;
    const members: number[] = [];
    const stack = [start];
    componentByNode[start] = componentIndex;
    while (stack.length > 0) {
      const node = stack.pop()!;
      members.push(node);
      for (const neighbor of reverse[node]!) {
        if (componentByNode[neighbor] === -1) {
          componentByNode[neighbor] = componentIndex;
          stack.push(neighbor);
        }
      }
    }
    if (members.length > 1) cyclicComponents.add(componentIndex);
    componentIndex += 1;
  }

  if (cyclicComponents.size === 0) return null;
  const nodeIds = nodes
    .filter((_, index) => cyclicComponents.has(componentByNode[index]!))
    .map(({ nodeId }) => nodeId)
    .sort(codepointCompare);
  const edgeIds = referenceEdges
    .filter((edge) => {
      const source = nodeIndex.get(edge.sourceNodeId)!;
      const target = nodeIndex.get(edge.targetNodeId)!;
      const component = componentByNode[source]!;
      return (
        component === componentByNode[target] && cyclicComponents.has(component)
      );
    })
    .map(({ edgeId }) => edgeId)
    .sort(codepointCompare);
  return { nodeIds, edgeIds };
}
