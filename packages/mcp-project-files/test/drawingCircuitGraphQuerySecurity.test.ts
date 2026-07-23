import { describe, expect, it } from "vitest";

import {
  CircuitNodeType,
  type CircuitGraphDocument,
} from "../src/drawingCircuitGraph/types.js";
import { deepFreezeCircuitFixture } from "./helpers/drawingCircuitGraphFixture.js";
import {
  importCircuitGraphQueryModule,
  makeQueryGraph,
  makeQueryNode,
  type QueryInput,
} from "./helpers/drawingCircuitGraphQueryFixture.js";

async function queryRaw(graph: unknown, query: unknown) {
  const { queryCircuitGraph } = await importCircuitGraphQueryModule();
  return queryCircuitGraph(graph as CircuitGraphDocument, query as QueryInput);
}

function expectErrorCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("circuit graph query validation and security", () => {
  it.each([
    null,
    undefined,
    "FIND_NODE",
    [],
    {},
    { kind: "UNKNOWN_QUERY", nodeId: "node" },
    { kind: "FIND_NODE" },
    { kind: "FIND_NODE", nodeId: "" },
    { kind: "FIND_NODE", nodeId: 1 },
    { kind: "FIND_NODE", nodeId: "node", extra: true },
    { kind: "FIND_NODES_BY_TYPE", nodeType: "NOT_A_NODE_TYPE" },
    { kind: "FIND_NODES_BY_DISPLAY_NAME", displayName: null },
    { kind: "FIND_CONNECTED_NEIGHBORS", nodeId: null },
  ])("rejects malformed query %# with INVALID_QUERY", async (query) => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    const graph = makeQueryGraph();
    expectErrorCode(
      () => queryCircuitGraph(graph, query as QueryInput),
      "INVALID_QUERY",
    );
  });

  it("accepts an empty display-name string as an exact non-null query", async () => {
    const result = await queryRaw(makeQueryGraph(), {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      displayName: "",
    });
    expect(result).toMatchObject({
      queryKind: "FIND_NODES_BY_DISPLAY_NAME",
      nodeCount: 0,
      nodes: [],
    });
  });

  it.each([
    null,
    undefined,
    {},
    [],
    { schemaVersion: 1 },
    makeQueryGraph({ nodes: [makeQueryNode({ id: "invalid" })] }),
  ])("rejects malformed graph %# with INVALID_GRAPH", async (input) => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    const graph =
      input && typeof input === "object" && "graphId" in input
        ? { ...input, graphId: "cgg_" + "0".repeat(64) }
        : input;
    expectErrorCode(
      () =>
        queryCircuitGraph(graph as CircuitGraphDocument, {
          kind: "FIND_NODE",
          nodeId: "missing",
        }),
      "INVALID_GRAPH",
    );
  });

  it("rejects a query accessor without executing its getter", async () => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    let getterCalls = 0;
    const query = Object.defineProperty({ nodeId: "missing" }, "kind", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "FIND_NODE";
      },
    });
    expectErrorCode(
      () => queryCircuitGraph(makeQueryGraph(), query as QueryInput),
      "INVALID_QUERY",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects a graph accessor without executing its getter", async () => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    let getterCalls = 0;
    const graph = { ...makeQueryGraph() } as Record<string, unknown>;
    Object.defineProperty(graph, "nodes", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });
    expectErrorCode(
      () =>
        queryCircuitGraph(graph as CircuitGraphDocument, {
          kind: "FIND_NODE",
          nodeId: "missing",
        }),
      "INVALID_GRAPH",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects custom query prototypes", async () => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    const query = Object.assign(Object.create({ inherited: true }), {
      kind: "FIND_NODE",
      nodeId: "missing",
    });
    expectErrorCode(
      () => queryCircuitGraph(makeQueryGraph(), query as QueryInput),
      "INVALID_QUERY",
    );
  });

  it("rejects custom graph prototypes", async () => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    const graph = Object.assign(
      Object.create({ inherited: true }),
      makeQueryGraph(),
    );
    expectErrorCode(
      () =>
        queryCircuitGraph(graph as CircuitGraphDocument, {
          kind: "FIND_NODE",
          nodeId: "missing",
        }),
      "INVALID_GRAPH",
    );
  });

  it("rejects symbol keys on queries", async () => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    const query = {
      kind: "FIND_NODE",
      nodeId: "missing",
      [Symbol("private")]: true,
    };
    expectErrorCode(
      () => queryCircuitGraph(makeQueryGraph(), query as QueryInput),
      "INVALID_QUERY",
    );
  });

  it("rejects symbol keys on graphs", async () => {
    const { queryCircuitGraph } = await importCircuitGraphQueryModule();
    const graph = Object.assign(makeQueryGraph(), {
      [Symbol("private")]: true,
    });
    expectErrorCode(
      () => queryCircuitGraph(graph, { kind: "FIND_NODE", nodeId: "missing" }),
      "INVALID_GRAPH",
    );
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the unsafe query key %s",
    async (unsafeKey) => {
      const { queryCircuitGraph } = await importCircuitGraphQueryModule();
      const query = { kind: "FIND_NODE", nodeId: "missing" };
      Object.defineProperty(query, unsafeKey, {
        value: "pollution",
        enumerable: true,
      });
      expectErrorCode(
        () => queryCircuitGraph(makeQueryGraph(), query as QueryInput),
        "INVALID_QUERY",
      );
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the unsafe graph key %s",
    async (unsafeKey) => {
      const { queryCircuitGraph } = await importCircuitGraphQueryModule();
      const graph = makeQueryGraph() as CircuitGraphDocument &
        Record<string, unknown>;
      Object.defineProperty(graph, unsafeKey, {
        value: "pollution",
        enumerable: true,
      });
      expectErrorCode(
        () =>
          queryCircuitGraph(graph, {
            kind: "FIND_NODE",
            nodeId: "missing",
          }),
        "INVALID_GRAPH",
      );
    },
  );

  it("does not mutate mutable graph or query inputs", async () => {
    const node = makeQueryNode({
      id: "immutable",
      nodeType: CircuitNodeType.PANEL,
    });
    const graph = makeQueryGraph({ nodes: [node] });
    const query = {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.PANEL,
    } as const;
    const graphBefore = structuredClone(graph);
    const queryBefore = structuredClone(query);
    await queryRaw(graph, query);
    expect(graph).toEqual(graphBefore);
    expect(query).toEqual(queryBefore);
  });

  it("accepts deeply frozen inputs without attempting source sorting", async () => {
    const graph = makeQueryGraph({
      nodes: [
        makeQueryNode({ id: "first", nodeType: CircuitNodeType.PANEL }),
        makeQueryNode({ id: "second", nodeType: CircuitNodeType.PANEL }),
      ],
    });
    const query = {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.PANEL,
    } as const;
    deepFreezeCircuitFixture(graph);
    deepFreezeCircuitFixture(query);
    const result = await queryRaw(graph, query);
    expect(result.nodeCount).toBe(2);
  });

  it("returns a deeply frozen result", async () => {
    const graph = makeQueryGraph({
      nodes: [makeQueryNode({ id: "frozen", nodeType: CircuitNodeType.PANEL })],
    });
    const result = await queryRaw(graph, {
      kind: "FIND_NODES_BY_TYPE",
      nodeType: CircuitNodeType.PANEL,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.nodes)).toBe(true);
    expect(Object.isFrozen(result.nodes[0])).toBe(true);
    expect(Object.isFrozen(result.nodes[0]!.objectIds)).toBe(true);
    expect(Object.isFrozen(result.nodes[0]!.attributes)).toBe(true);
    expect(Object.isFrozen(result.nodes[0]!.attributes.nested)).toBe(true);
    expect(Object.isFrozen(result.nodes[0]!.metadata)).toBe(true);
    expect(Reflect.set(result, "nodeCount", 99)).toBe(false);
    expect(Reflect.set(result.nodes[0]!, "displayName", "changed")).toBe(false);
  });

  it("returns cloned nodes and arrays without source aliases", async () => {
    const sourceNode = makeQueryNode({
      id: "clone",
      nodeType: CircuitNodeType.PANEL,
    });
    const graph = makeQueryGraph({ nodes: [sourceNode] });
    const result = await queryRaw(graph, {
      kind: "FIND_NODE",
      nodeId: sourceNode.nodeId,
    });
    expect(result.nodes).not.toBe(graph.nodes);
    expect(result.nodes[0]).not.toBe(graph.nodes[0]);
    expect(result.nodes[0]!.objectIds).not.toBe(graph.nodes[0]!.objectIds);
    expect(result.nodes[0]!.attributes).not.toBe(graph.nodes[0]!.attributes);
    expect(result.nodes[0]!.metadata).not.toBe(graph.nodes[0]!.metadata);
    expect(result.nodes[0]).toEqual(graph.nodes[0]);
  });
});
