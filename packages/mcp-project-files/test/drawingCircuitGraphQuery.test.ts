import { describe, expect, it } from "vitest";

import {
  CircuitEdgeType,
  CircuitNodeType,
  type CircuitGraphDocument,
  type CircuitNode,
} from "../src/drawingCircuitGraph/types.js";
import { validateCircuitGraphDocument } from "../src/drawingCircuitGraph/validateCircuitGraphDocument.js";
import {
  importCircuitGraphQueryModule,
  makeQueryEdge,
  makeQueryGraph,
  makeQueryNode,
  nodeIds,
  type QueryInput,
} from "./helpers/drawingCircuitGraphQueryFixture.js";

async function runQuery(graph: CircuitGraphDocument, query: QueryInput) {
  const { queryCircuitGraph } = await importCircuitGraphQueryModule();
  return queryCircuitGraph(graph, query);
}

function expectResult(
  result: Awaited<ReturnType<typeof runQuery>>,
  queryKind: QueryInput["kind"],
  expectedNodes: readonly CircuitNode[],
): void {
  expect(Object.keys(result)).toEqual(["queryKind", "nodeCount", "nodes"]);
  expect(result.queryKind).toBe(queryKind);
  expect(result.nodeCount).toBe(expectedNodes.length);
  expect(nodeIds(result.nodes)).toEqual(nodeIds(expectedNodes));
}

describe("circuit graph query foundation", () => {
  it("uses a Foundation-valid independent graph fixture", () => {
    const first = makeQueryNode({ id: "fixture-first" });
    const second = makeQueryNode({ id: "fixture-second" });
    const graph = makeQueryGraph({
      nodes: [second, first],
      edges: [
        makeQueryEdge({
          id: "fixture-edge",
          sourceNodeId: first.nodeId,
          targetNodeId: second.nodeId,
          edgeType: CircuitEdgeType.CONNECTED,
        }),
      ],
    });
    expect(validateCircuitGraphDocument(graph)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("finds one node by exact ID", async () => {
    const panel = makeQueryNode({
      id: "panel",
      nodeType: CircuitNodeType.PANEL,
    });
    const cable = makeQueryNode({
      id: "cable",
      nodeType: CircuitNodeType.CABLE,
    });
    const graph = makeQueryGraph({ nodes: [panel, cable] });
    const result = await runQuery(graph, {
      kind: "FIND_NODE",
      nodeId: panel.nodeId,
    });
    expectResult(result, "FIND_NODE", [panel]);
  });

  it("returns an empty result for a missing node ID", async () => {
    const graph = makeQueryGraph({ nodes: [makeQueryNode({ id: "panel" })] });
    const result = await runQuery(graph, {
      kind: "FIND_NODE",
      nodeId: "cgn_" + "0".repeat(64),
    });
    expectResult(result, "FIND_NODE", []);
  });

  it("finds a single node by type", async () => {
    const panel = makeQueryNode({
      id: "panel",
      nodeType: CircuitNodeType.PANEL,
    });
    const cable = makeQueryNode({
      id: "cable",
      nodeType: CircuitNodeType.CABLE,
    });
    const graph = makeQueryGraph({ nodes: [panel, cable] });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.PANEL,
    });
    expectResult(result, "FIND_NODES_BY_TYPE", [panel]);
  });

  it("finds multiple same-type nodes in Foundation node order", async () => {
    const first = makeQueryNode({
      id: "first",
      nodeType: CircuitNodeType.CABLE,
    });
    const second = makeQueryNode({
      id: "second",
      nodeType: CircuitNodeType.CABLE,
    });
    const other = makeQueryNode({
      id: "other",
      nodeType: CircuitNodeType.PANEL,
    });
    const graph = makeQueryGraph({ nodes: [second, other, first] });
    const expected = graph.nodes.filter(
      ({ nodeType }) => nodeType === CircuitNodeType.CABLE,
    );
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.CABLE,
    });
    expectResult(result, "FIND_NODES_BY_TYPE", expected);
  });

  it("returns no nodes when a valid type has no match", async () => {
    const graph = makeQueryGraph({
      nodes: [makeQueryNode({ id: "panel", nodeType: CircuitNodeType.PANEL })],
    });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.TRANSFORMER,
    });
    expectResult(result, "FIND_NODES_BY_TYPE", []);
  });

  it("matches display names byte-for-byte", async () => {
    const exact = makeQueryNode({ id: "exact", displayName: "Panel A" });
    const differentCase = makeQueryNode({ id: "case", displayName: "panel a" });
    const graph = makeQueryGraph({ nodes: [differentCase, exact] });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: "Panel A",
    });
    expectResult(result, "FIND_NODES_BY_DISPLAY_NAME", [exact]);
  });

  it("returns duplicate display-name matches in canonical node order", async () => {
    const first = makeQueryNode({ id: "first", displayName: "Same" });
    const second = makeQueryNode({ id: "second", displayName: "Same" });
    const graph = makeQueryGraph({ nodes: [second, first] });
    const expected = graph.nodes.filter(
      ({ displayName }) => displayName === "Same",
    );
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: "Same",
    });
    expectResult(result, "FIND_NODES_BY_DISPLAY_NAME", expected);
  });

  it("returns no display-name match for an absent exact string", async () => {
    const graph = makeQueryGraph({
      nodes: [makeQueryNode({ id: "panel", displayName: "Panel A" })],
    });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: "Panel B",
    });
    expectResult(result, "FIND_NODES_BY_DISPLAY_NAME", []);
  });

  it("does not index null display names", async () => {
    const graph = makeQueryGraph({
      nodes: [makeQueryNode({ id: "unnamed", displayName: null })],
    });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: "null",
    });
    expectResult(result, "FIND_NODES_BY_DISPLAY_NAME", []);
  });

  it("preserves whitespace during display-name lookup", async () => {
    const spaced = makeQueryNode({ id: "spaced", displayName: " Panel A " });
    const plain = makeQueryNode({ id: "plain", displayName: "Panel A" });
    const graph = makeQueryGraph({ nodes: [spaced, plain] });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: " Panel A ",
    });
    expectResult(result, "FIND_NODES_BY_DISPLAY_NAME", [spaced]);
  });

  it("does not Unicode-normalize display names", async () => {
    const composed = makeQueryNode({ id: "composed", displayName: "é" });
    const decomposed = makeQueryNode({
      id: "decomposed",
      displayName: "e\u0301",
    });
    const graph = makeQueryGraph({ nodes: [decomposed, composed] });
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: "é",
    });
    expectResult(result, "FIND_NODES_BY_DISPLAY_NAME", [composed]);
  });

  it("returns only one-hop CONNECTED neighbors", async () => {
    const source = makeQueryNode({ id: "source" });
    const direct = makeQueryNode({ id: "direct" });
    const transitive = makeQueryNode({ id: "transitive" });
    const graph = makeQueryGraph({
      nodes: [source, direct, transitive],
      edges: [
        makeQueryEdge({
          id: "source-direct",
          sourceNodeId: source.nodeId,
          targetNodeId: direct.nodeId,
          edgeType: CircuitEdgeType.CONNECTED,
        }),
        makeQueryEdge({
          id: "direct-transitive",
          sourceNodeId: direct.nodeId,
          targetNodeId: transitive.nodeId,
          edgeType: CircuitEdgeType.CONNECTED,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_CONNECTED_NEIGHBORS",
      nodeId: source.nodeId,
    });
    expectResult(result, "FIND_CONNECTED_NEIGHBORS", [direct]);
  });

  it("ignores source-target direction for CONNECTED neighbors", async () => {
    const source = makeQueryNode({ id: "source" });
    const neighbor = makeQueryNode({ id: "neighbor" });
    const graph = makeQueryGraph({
      nodes: [source, neighbor],
      edges: [
        makeQueryEdge({
          id: "reverse",
          sourceNodeId: neighbor.nodeId,
          targetNodeId: source.nodeId,
          edgeType: CircuitEdgeType.CONNECTED,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_CONNECTED_NEIGHBORS",
      nodeId: source.nodeId,
    });
    expectResult(result, "FIND_CONNECTED_NEIGHBORS", [neighbor]);
  });

  it("deduplicates neighbors connected by parallel edges", async () => {
    const source = makeQueryNode({ id: "source" });
    const neighbor = makeQueryNode({ id: "neighbor" });
    const graph = makeQueryGraph({
      nodes: [source, neighbor],
      edges: ["first", "second"].map((id) =>
        makeQueryEdge({
          id,
          sourceNodeId: source.nodeId,
          targetNodeId: neighbor.nodeId,
          edgeType: CircuitEdgeType.CONNECTED,
        }),
      ),
    });
    const result = await runQuery(graph, {
      kind: "FIND_CONNECTED_NEIGHBORS",
      nodeId: source.nodeId,
    });
    expectResult(result, "FIND_CONNECTED_NEIGHBORS", [neighbor]);
  });

  it("ignores non-CONNECTED edges in connected-neighbor queries", async () => {
    const source = makeQueryNode({ id: "source" });
    const contained = makeQueryNode({ id: "contained" });
    const graph = makeQueryGraph({
      nodes: [source, contained],
      edges: [
        makeQueryEdge({
          id: "contains",
          sourceNodeId: source.nodeId,
          targetNodeId: contained.nodeId,
          edgeType: CircuitEdgeType.CONTAINS,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_CONNECTED_NEIGHBORS",
      nodeId: source.nodeId,
    });
    expectResult(result, "FIND_CONNECTED_NEIGHBORS", []);
  });

  it("returns only direct outgoing CONTAINS children", async () => {
    const parent = makeQueryNode({ id: "parent" });
    const child = makeQueryNode({ id: "child" });
    const grandchild = makeQueryNode({ id: "grandchild" });
    const graph = makeQueryGraph({
      nodes: [parent, child, grandchild],
      edges: [
        makeQueryEdge({
          id: "parent-child",
          sourceNodeId: parent.nodeId,
          targetNodeId: child.nodeId,
          edgeType: CircuitEdgeType.CONTAINS,
        }),
        makeQueryEdge({
          id: "child-grandchild",
          sourceNodeId: child.nodeId,
          targetNodeId: grandchild.nodeId,
          edgeType: CircuitEdgeType.CONTAINS,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_CONTAINED_NODES",
      nodeId: parent.nodeId,
    });
    expectResult(result, "FIND_CONTAINED_NODES", [child]);
  });

  it("does not return incoming CONTAINS parents", async () => {
    const parent = makeQueryNode({ id: "parent" });
    const child = makeQueryNode({ id: "child" });
    const graph = makeQueryGraph({
      nodes: [parent, child],
      edges: [
        makeQueryEdge({
          id: "contains",
          sourceNodeId: parent.nodeId,
          targetNodeId: child.nodeId,
          edgeType: CircuitEdgeType.CONTAINS,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_CONTAINED_NODES",
      nodeId: child.nodeId,
    });
    expectResult(result, "FIND_CONTAINED_NODES", []);
  });

  it("returns only direct outgoing REFERENCE targets", async () => {
    const source = makeQueryNode({ id: "source" });
    const direct = makeQueryNode({ id: "direct" });
    const transitive = makeQueryNode({ id: "transitive" });
    const graph = makeQueryGraph({
      nodes: [source, direct, transitive],
      edges: [
        makeQueryEdge({
          id: "source-direct",
          sourceNodeId: source.nodeId,
          targetNodeId: direct.nodeId,
          edgeType: CircuitEdgeType.REFERENCE,
        }),
        makeQueryEdge({
          id: "direct-transitive",
          sourceNodeId: direct.nodeId,
          targetNodeId: transitive.nodeId,
          edgeType: CircuitEdgeType.REFERENCE,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_REFERENCED_NODES",
      nodeId: source.nodeId,
    });
    expectResult(result, "FIND_REFERENCED_NODES", [direct]);
  });

  it("handles REFERENCE cycles without recursion or transitive results", async () => {
    const first = makeQueryNode({ id: "first" });
    const second = makeQueryNode({ id: "second" });
    const third = makeQueryNode({ id: "third" });
    const graph = makeQueryGraph({
      nodes: [first, second, third],
      edges: [
        makeQueryEdge({
          id: "first-second",
          sourceNodeId: first.nodeId,
          targetNodeId: second.nodeId,
          edgeType: CircuitEdgeType.REFERENCE,
        }),
        makeQueryEdge({
          id: "second-first",
          sourceNodeId: second.nodeId,
          targetNodeId: first.nodeId,
          edgeType: CircuitEdgeType.REFERENCE,
        }),
        makeQueryEdge({
          id: "second-third",
          sourceNodeId: second.nodeId,
          targetNodeId: third.nodeId,
          edgeType: CircuitEdgeType.REFERENCE,
        }),
      ],
    });
    const result = await runQuery(graph, {
      kind: "FIND_REFERENCED_NODES",
      nodeId: first.nodeId,
    });
    expectResult(result, "FIND_REFERENCED_NODES", [second]);
  });

  it.each([
    "FIND_CONNECTED_NEIGHBORS",
    "FIND_CONTAINED_NODES",
    "FIND_REFERENCED_NODES",
  ] as const)(
    "returns empty %s results for an unknown anchor",
    async (kind) => {
      const graph = makeQueryGraph({ nodes: [makeQueryNode({ id: "known" })] });
      const result = await runQuery(graph, {
        kind,
        nodeId: "cgn_" + "0".repeat(64),
      });
      expectResult(result, kind, []);
    },
  );

  it("supports every query against an empty graph", async () => {
    const graph = makeQueryGraph();
    const queries: QueryInput[] = [
      { kind: "FIND_NODE", nodeId: "cgn_" + "0".repeat(64) },
      { kind: "FIND_NODES_BY_TYPE", nodeType: CircuitNodeType.PANEL },
      { kind: "FIND_NODES_BY_DISPLAY_NAME", displayName: "Panel" },
      { kind: "FIND_CONNECTED_NEIGHBORS", nodeId: "cgn_" + "0".repeat(64) },
      { kind: "FIND_CONTAINED_NODES", nodeId: "cgn_" + "0".repeat(64) },
      { kind: "FIND_REFERENCED_NODES", nodeId: "cgn_" + "0".repeat(64) },
    ];
    for (const query of queries) {
      const result = await runQuery(graph, query);
      expectResult(result, query.kind, []);
    }
  });

  it("keeps repeated output byte-deterministic", async () => {
    const nodes = [
      makeQueryNode({ id: "z", nodeType: CircuitNodeType.PANEL }),
      makeQueryNode({ id: "a", nodeType: CircuitNodeType.PANEL }),
    ];
    const graph = makeQueryGraph({ nodes });
    const query = {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.PANEL,
    } as const;
    const bytes = await Promise.all(
      Array.from({ length: 100 }, async () =>
        JSON.stringify(await runQuery(graph, query)),
      ),
    );
    expect(new Set(bytes).size).toBe(1);
  });

  it("uses Foundation node order without reordering the graph", async () => {
    const graph = makeQueryGraph({
      nodes: [
        makeQueryNode({ id: "한", nodeType: CircuitNodeType.PANEL }),
        makeQueryNode({ id: "A", nodeType: CircuitNodeType.PANEL }),
        makeQueryNode({ id: "é", nodeType: CircuitNodeType.PANEL }),
      ],
    });
    const before = nodeIds(graph.nodes);
    const expected = graph.nodes.filter(
      ({ nodeType }) => nodeType === CircuitNodeType.PANEL,
    );
    const result = await runQuery(graph, {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.PANEL,
    });
    expectResult(result, "FIND_NODES_BY_TYPE", expected);
    expect(nodeIds(graph.nodes)).toEqual(before);
  });

  it("does not retain a stale index for mutable graph inputs", async () => {
    const node = makeQueryNode({ id: "mutable", displayName: "Before" });
    const graph = makeQueryGraph({ nodes: [node] });
    expect(
      (
        await runQuery(graph, {
          kind: "FIND_NODES_BY_DISPLAY_NAME",
          displayName: "Before",
        })
      ).nodeCount,
    ).toBe(1);
    (graph.nodes[0] as { displayName: string | null }).displayName = "After";
    expect(
      (
        await runQuery(graph, {
          kind: "FIND_NODES_BY_DISPLAY_NAME",
          displayName: "Before",
        })
      ).nodeCount,
    ).toBe(0);
    expect(
      (
        await runQuery(graph, {
          kind: "FIND_NODES_BY_DISPLAY_NAME",
          displayName: "After",
        })
      ).nodeCount,
    ).toBe(1);
  });
});
