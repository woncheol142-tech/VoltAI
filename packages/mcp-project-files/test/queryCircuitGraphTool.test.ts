import { fileURLToPath } from "node:url";

import type { VoltAiTool } from "@voltai/mcp-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CircuitEdgeType,
  CircuitNodeType,
  type CircuitGraphDocument,
} from "../src/drawingCircuitGraph/types.js";
import { queryCircuitGraph } from "../src/drawingCircuitGraphQuery/index.js";
import { deepFreezeCircuitFixture } from "./helpers/drawingCircuitGraphFixture.js";
import {
  makeQueryEdge,
  makeQueryGraph,
  makeQueryNode,
  type QueryInput,
  type QueryResult,
} from "./helpers/drawingCircuitGraphQueryFixture.js";

type QueryCircuitGraphToolModule = {
  createQueryCircuitGraphTool(): VoltAiTool<QueryResult>;
};

type ToolScenario = {
  graph: CircuitGraphDocument;
  queries: Readonly<Record<QueryInput["kind"], QueryInput>>;
};

const QUERY_KINDS = [
  "FIND_NODE",
  "FIND_NODES_BY_TYPE",
  "FIND_NODES_BY_DISPLAY_NAME",
  "FIND_CONNECTED_NEIGHBORS",
  "FIND_CONTAINED_NODES",
  "FIND_REFERENCED_NODES",
] as const satisfies readonly QueryInput["kind"][];

async function importToolModule(): Promise<QueryCircuitGraphToolModule> {
  const moduleUrl = new URL(
    "../src/tools/queryCircuitGraph.ts",
    import.meta.url,
  );
  return import(
    /* @vite-ignore */ fileURLToPath(moduleUrl)
  ) as Promise<QueryCircuitGraphToolModule>;
}

async function createTool(): Promise<VoltAiTool<QueryResult>> {
  const { createQueryCircuitGraphTool } = await importToolModule();
  return createQueryCircuitGraphTool();
}

function makeScenario(): ToolScenario {
  const panel = makeQueryNode({
    id: "tool-panel",
    nodeType: CircuitNodeType.PANEL,
    displayName: "Panel A",
  });
  const breaker = makeQueryNode({
    id: "tool-breaker",
    nodeType: CircuitNodeType.BREAKER,
    displayName: "Breaker A",
  });
  const outlet = makeQueryNode({
    id: "tool-outlet",
    nodeType: CircuitNodeType.OUTLET,
    displayName: "Outlet A",
  });
  const annotation = makeQueryNode({
    id: "tool-reference",
    nodeType: CircuitNodeType.ANNOTATION,
    displayName: "Reference A",
  });
  const graph = makeQueryGraph({
    nodes: [panel, breaker, outlet, annotation],
    edges: [
      makeQueryEdge({
        id: "tool-connected",
        sourceNodeId: panel.nodeId,
        targetNodeId: breaker.nodeId,
        edgeType: CircuitEdgeType.CONNECTED,
      }),
      makeQueryEdge({
        id: "tool-contains",
        sourceNodeId: panel.nodeId,
        targetNodeId: outlet.nodeId,
        edgeType: CircuitEdgeType.CONTAINS,
      }),
      makeQueryEdge({
        id: "tool-reference",
        sourceNodeId: panel.nodeId,
        targetNodeId: annotation.nodeId,
        edgeType: CircuitEdgeType.REFERENCE,
      }),
    ],
  });

  return {
    graph,
    queries: {
      FIND_NODE: { kind: "FIND_NODE", nodeId: breaker.nodeId },
      FIND_NODES_BY_TYPE: {
        kind: "FIND_NODES_BY_TYPE",
        nodeType: CircuitNodeType.BREAKER,
      },
      FIND_NODES_BY_DISPLAY_NAME: {
        kind: "FIND_NODES_BY_DISPLAY_NAME",
        displayName: "Breaker A",
      },
      FIND_CONNECTED_NEIGHBORS: {
        kind: "FIND_CONNECTED_NEIGHBORS",
        nodeId: panel.nodeId,
      },
      FIND_CONTAINED_NODES: {
        kind: "FIND_CONTAINED_NODES",
        nodeId: panel.nodeId,
      },
      FIND_REFERENCED_NODES: {
        kind: "FIND_REFERENCED_NODES",
        nodeId: panel.nodeId,
      },
    },
  };
}

async function rejectedError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}

async function expectToolError(
  operation: () => unknown,
  code: "INVALID_GRAPH" | "INVALID_QUERY",
): Promise<Error> {
  const error = await rejectedError(operation);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ code });
  expect((error as Error).message).toMatch(new RegExp(`^${code}:`));
  return error as Error;
}

describe("query_circuit_graph thin adapter contract", () => {
  it("declares the approved tool name and only the document/query envelope", async () => {
    const tool = await createTool();
    const schema = z.object(tool.inputSchema);
    const scenario = makeScenario();

    expect(tool.name).toBe("query_circuit_graph");
    expect(Object.keys(tool.inputSchema).sort()).toEqual(["document", "query"]);
    expect(
      schema.safeParse({
        document: scenario.graph,
        query: scenario.queries.FIND_NODE,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: scenario.queries.FIND_NODE }).success,
    ).toBe(false);
    expect(schema.safeParse({ document: scenario.graph }).success).toBe(false);
  });

  it("keeps graph and query schemas under Task 44A validation authority", async () => {
    const tool = await createTool();
    const schema = z.object(tool.inputSchema);

    expect(schema.safeParse({ document: {}, query: {} }).success).toBe(true);
    await expectToolError(
      () => tool.handler({ document: {}, query: {} }),
      "INVALID_QUERY",
    );
  });

  it.each([null, undefined, "envelope", 1, [], () => undefined])(
    "rejects non-object envelope %# without adding an error code",
    async (input) => {
      const tool = await createTool();
      await expectToolError(() => tool.handler(input), "INVALID_QUERY");
    },
  );

  it("rejects an envelope accessor without executing its getter", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    let getterCalls = 0;
    const input = Object.defineProperty(
      { query: scenario.queries.FIND_NODE },
      "document",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return scenario.graph;
        },
      },
    );

    await expectToolError(() => tool.handler(input), "INVALID_QUERY");
    expect(getterCalls).toBe(0);
  });

  it("rejects a setter-backed envelope field", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    const input = { document: scenario.graph };
    Object.defineProperty(input, "query", {
      enumerable: true,
      set() {},
    });

    await expectToolError(() => tool.handler(input), "INVALID_QUERY");
  });

  it("rejects symbol envelope keys", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    const input = {
      document: scenario.graph,
      query: scenario.queries.FIND_NODE,
      [Symbol("private")]: true,
    };

    await expectToolError(() => tool.handler(input), "INVALID_QUERY");
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects the unsafe envelope key %s",
    async (unsafeKey) => {
      const tool = await createTool();
      const scenario = makeScenario();
      const input = {
        document: scenario.graph,
        query: scenario.queries.FIND_NODE,
      };
      Object.defineProperty(input, unsafeKey, {
        value: "pollution",
        enumerable: true,
      });

      await expectToolError(() => tool.handler(input), "INVALID_QUERY");
    },
  );

  it("rejects custom envelope prototypes", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    const input = Object.assign(Object.create({ inherited: true }), {
      document: scenario.graph,
      query: scenario.queries.FIND_NODE,
    });

    await expectToolError(() => tool.handler(input), "INVALID_QUERY");
  });

  it.each(QUERY_KINDS)(
    "returns the exact Task 44A result for %s",
    async (queryKind) => {
      const tool = await createTool();
      const scenario = makeScenario();
      const query = scenario.queries[queryKind];
      const expected = queryCircuitGraph(scenario.graph, query);
      const actual = await tool.handler({
        document: scenario.graph,
        query,
      });

      expect(actual).toEqual(expected);
      expect(Reflect.ownKeys(actual)).toEqual([
        "queryKind",
        "nodeCount",
        "nodes",
      ]);
      expect(actual).not.toHaveProperty("result");
      expect(actual).not.toHaveProperty("data");
      expect(actual).not.toHaveProperty("metadata");
    },
  );

  it("passes the source graph through to Task 44A and does not clone its result nodes", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    deepFreezeCircuitFixture(scenario.graph);
    const query = scenario.queries.FIND_NODE;
    const direct = queryCircuitGraph(scenario.graph, query);
    const throughTool = await tool.handler({
      document: scenario.graph,
      query,
    });

    expect(throughTool).toEqual(direct);
    expect(throughTool.nodes[0]).toBe(direct.nodes[0]);
  });

  it("does not mutate, normalize, or freeze the envelope and domain inputs", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    const query = { ...scenario.queries.FIND_NODE } as QueryInput;
    const input = { document: scenario.graph, query };
    const graphBefore = structuredClone(scenario.graph);
    const queryBefore = structuredClone(query);

    await tool.handler(input);

    expect(input.document).toBe(scenario.graph);
    expect(input.query).toBe(query);
    expect(scenario.graph).toEqual(graphBefore);
    expect(query).toEqual(queryBefore);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(scenario.graph)).toBe(false);
    expect(Object.isFrozen(query)).toBe(false);
  });

  it("does not create a stale tool cache or freeze mutable graphs", async () => {
    const tool = await createTool();
    const node = makeQueryNode({
      id: "mutable-name",
      displayName: "Before",
    });
    const graph = makeQueryGraph({ nodes: [node] });

    expect(
      await tool.handler({
        document: graph,
        query: {
          kind: "FIND_NODES_BY_DISPLAY_NAME",
          displayName: "Before",
        },
      }),
    ).toMatchObject({ nodeCount: 1 });

    (graph.nodes[0] as { displayName: string | null }).displayName = "After";

    expect(
      await tool.handler({
        document: graph,
        query: {
          kind: "FIND_NODES_BY_DISPLAY_NAME",
          displayName: "After",
        },
      }),
    ).toMatchObject({ nodeCount: 1 });
    expect(Object.isFrozen(graph)).toBe(false);
    expect(Object.isFrozen(graph.nodes[0])).toBe(false);
  });

  it("preserves Task 44A INVALID_GRAPH and INVALID_QUERY errors", async () => {
    const tool = await createTool();
    const scenario = makeScenario();

    await expectToolError(
      () =>
        tool.handler({
          document: {},
          query: scenario.queries.FIND_NODE,
        }),
      "INVALID_GRAPH",
    );
    await expectToolError(
      () =>
        tool.handler({
          document: scenario.graph,
          query: { kind: "FIND_NODE", nodeId: 1 },
        }),
      "INVALID_QUERY",
    );
  });

  it("passes unknown programming errors through unchanged", async () => {
    const tool = await createTool();
    const sentinel = new RangeError("sentinel programming error");
    const query = new Proxy(
      { kind: "FIND_NODE", nodeId: "missing" },
      {
        get(target, property, receiver) {
          if (property === "kind") throw sentinel;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const error = await rejectedError(() =>
      tool.handler({
        document: makeQueryGraph(),
        query,
      }),
    );
    expect(error).toBe(sentinel);
  });

  it("does not include raw graph or query values in error messages", async () => {
    const tool = await createTool();
    const secret = "PRIVATE-CIRCUIT-DATA-7f1c";
    const error = await expectToolError(
      () =>
        tool.handler({
          document: { secret },
          query: { kind: "FIND_NODE", nodeId: "missing" },
        }),
      "INVALID_GRAPH",
    );

    expect(error.message).not.toContain(secret);
  });

  it("returns the existing deeply frozen Task 44A result contract", async () => {
    const tool = await createTool();
    const scenario = makeScenario();
    const result = await tool.handler({
      document: scenario.graph,
      query: scenario.queries.FIND_NODE,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.nodes)).toBe(true);
    expect(Object.isFrozen(result.nodes[0])).toBe(true);
    expect(Object.isFrozen(result.nodes[0]!.attributes)).toBe(true);
    expect(Reflect.set(result, "nodeCount", 99)).toBe(false);
    expect(Reflect.set(result.nodes[0]!, "displayName", "changed")).toBe(false);
  });
});
