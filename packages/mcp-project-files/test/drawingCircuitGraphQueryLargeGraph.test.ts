import { describe, expect, it } from "vitest";

import {
  CircuitEdgeType,
  CircuitNodeType,
} from "../src/drawingCircuitGraph/types.js";
import { deepFreezeCircuitFixture } from "./helpers/drawingCircuitGraphFixture.js";
import {
  importCircuitGraphQueryModule,
  makeLargeQueryGraph,
  makeQueryEdge,
  makeQueryGraph,
  makeQueryNode,
  nodeIds,
} from "./helpers/drawingCircuitGraphQueryFixture.js";

const LARGE_TIMEOUT_MS = 120_000;

describe("circuit graph query large-graph contracts", () => {
  it(
    "queries one-hop neighbors in a 20,000-node CONNECTED chain without RangeError",
    async () => {
      const { queryCircuitGraph } = await importCircuitGraphQueryModule();
      const nodes = Array.from({ length: 20_000 }, (_, index) =>
        makeQueryNode({ id: `chain-${String(index).padStart(6, "0")}` }),
      );
      const edges = Array.from({ length: nodes.length - 1 }, (_, index) =>
        makeQueryEdge({
          id: `chain-${String(index).padStart(6, "0")}`,
          sourceNodeId: nodes[index]!.nodeId,
          targetNodeId: nodes[index + 1]!.nodeId,
          edgeType: CircuitEdgeType.CONNECTED,
        }),
      );
      const graph = makeQueryGraph({ nodes, edges });
      const source = nodes[10_000]!;
      const expectedIds = new Set([
        nodes[9_999]!.nodeId,
        nodes[10_001]!.nodeId,
      ]);
      const expected = graph.nodes
        .filter(({ nodeId }) => expectedIds.has(nodeId))
        .map(({ nodeId }) => nodeId);
      const before = nodeIds(graph.nodes);

      let result;
      try {
        result = queryCircuitGraph(graph, {
          kind: "FIND_CONNECTED_NEIGHBORS",
          nodeId: source.nodeId,
        });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RangeError);
        throw error;
      }

      expect(result.queryKind).toBe("FIND_CONNECTED_NEIGHBORS");
      expect(result.nodeCount).toBe(2);
      expect(nodeIds(result.nodes)).toEqual(expected);
      expect(nodeIds(graph.nodes)).toEqual(before);
    },
    LARGE_TIMEOUT_MS,
  );

  it(
    "queries a 50,000-node frozen graph without recursion overflow",
    async () => {
      const { queryCircuitGraph } = await importCircuitGraphQueryModule();
      const graph = makeLargeQueryGraph(50_000);
      deepFreezeCircuitFixture(graph);
      const target = graph.nodes.at(-1)!;

      let exactResult;
      let typeResult;
      try {
        exactResult = queryCircuitGraph(graph, {
          kind: "FIND_NODE",
          nodeId: target.nodeId,
        });
        typeResult = queryCircuitGraph(graph, {
          kind: "FIND_NODES_BY_TYPE",
          nodeType: CircuitNodeType.CABLE,
        });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RangeError);
        throw error;
      }

      expect(exactResult.nodeCount).toBe(1);
      expect(exactResult.nodes[0]!.nodeId).toBe(target.nodeId);
      expect(typeResult.nodeCount).toBe(25_000);
      expect(nodeIds(typeResult.nodes)).toEqual(
        graph.nodes
          .filter(({ nodeType }) => nodeType === CircuitNodeType.CABLE)
          .map(({ nodeId }) => nodeId),
      );
      expect(Object.isFrozen(exactResult)).toBe(true);
      expect(Object.isFrozen(typeResult.nodes)).toBe(true);
    },
    LARGE_TIMEOUT_MS,
  );
});
