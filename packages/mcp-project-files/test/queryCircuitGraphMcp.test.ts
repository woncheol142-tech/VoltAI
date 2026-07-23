import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { CircuitNodeType } from "../src/drawingCircuitGraph/types.js";
import { queryCircuitGraph } from "../src/drawingCircuitGraphQuery/index.js";
import { createServer } from "../src/index.js";
import {
  makeQueryGraph,
  makeQueryNode,
} from "./helpers/drawingCircuitGraphQueryFixture.js";

async function connectServer() {
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "query-circuit-graph-test-client",
    version: "0.1.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function responseText(
  response: Awaited<ReturnType<Client["callTool"]>>,
): string {
  const content = response.content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

describe("query_circuit_graph MCP registration", () => {
  it("registers the tool exactly once without removing existing tools", async () => {
    const { client, server } = await connectServer();
    try {
      const response = await client.listTools();
      const names = response.tools.map(({ name }) => name);

      expect(names.filter((name) => name === "query_circuit_graph")).toEqual([
        "query_circuit_graph",
      ]);
      expect(names).toEqual(
        expect.arrayContaining([
          "list_project_files",
          "read_pdf",
          "render_pdf_page",
          "search_drawings",
          "extract_drawing_spatial_relations",
          "query_circuit_graph",
        ]),
      );
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("exposes only the required document/query pass-through envelope", async () => {
    const { client, server } = await connectServer();
    try {
      const response = await client.listTools();
      const tool = response.tools.find(
        ({ name }) => name === "query_circuit_graph",
      );

      expect(tool?.inputSchema.required).toEqual(["document", "query"]);
      expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
        "document",
        "query",
      ]);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it.each(["document", "query"] as const)(
    "rejects a missing %s at the MCP transport boundary",
    async (missingField) => {
      const node = makeQueryNode({ id: `missing-${missingField}` });
      const graph = makeQueryGraph({ nodes: [node] });
      const query = { kind: "FIND_NODE", nodeId: node.nodeId } as const;
      const argumentsValue =
        missingField === "document" ? { query } : { document: graph };
      const { client, server } = await connectServer();
      try {
        const response = await client.callTool({
          name: "query_circuit_graph",
          arguments: argumentsValue,
        });

        expect(response.isError).toBe(true);
        const text = responseText(response);
        expect(text).toContain("Input validation error");
        expect(text).toContain(missingField);
        expect(text).not.toContain("not found");
      } finally {
        await Promise.allSettled([client.close(), server.close()]);
      }
    },
  );

  it("returns Task 44A JSON without a wrapper, DTO, rename, or metadata", async () => {
    const node = makeQueryNode({
      id: "mcp-success",
      nodeType: CircuitNodeType.PANEL,
      displayName: "MCP Panel",
    });
    const graph = makeQueryGraph({ nodes: [node] });
    const query = { kind: "FIND_NODE", nodeId: node.nodeId } as const;
    const expected = queryCircuitGraph(graph, query);
    const { client, server } = await connectServer();
    try {
      const response = await client.callTool({
        name: "query_circuit_graph",
        arguments: { document: graph, query },
      });
      const text = responseText(response);
      const parsed = JSON.parse(text) as unknown;

      expect(response.isError).not.toBe(true);
      expect(text).toBe(JSON.stringify(expected));
      expect(parsed).toEqual(expected);
      expect(Reflect.ownKeys(parsed as object)).toEqual([
        "queryKind",
        "nodeCount",
        "nodes",
      ]);
      expect(parsed).not.toHaveProperty("result");
      expect(parsed).not.toHaveProperty("data");
      expect(parsed).not.toHaveProperty("metadata");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it.each([
    {
      code: "INVALID_GRAPH",
      document: {},
      query: { kind: "FIND_NODE", nodeId: "missing" },
    },
    {
      code: "INVALID_QUERY",
      document: makeQueryGraph(),
      query: { kind: "FIND_NODE", nodeId: 42 },
    },
  ] as const)(
    "preserves the $code message prefix through MCP",
    async ({ code, document, query }) => {
      const { client, server } = await connectServer();
      try {
        const response = await client.callTool({
          name: "query_circuit_graph",
          arguments: { document, query },
        });

        expect(response.isError).toBe(true);
        expect(responseText(response)).toMatch(new RegExp(`^${code}:`));
      } finally {
        await Promise.allSettled([client.close(), server.close()]);
      }
    },
  );

  it("does not dump raw domain input in MCP errors", async () => {
    const secret = "PRIVATE-MCP-GRAPH-58cb";
    const { client, server } = await connectServer();
    try {
      const response = await client.callTool({
        name: "query_circuit_graph",
        arguments: {
          document: { secret },
          query: { kind: "FIND_NODE", nodeId: "missing" },
        },
      });
      const text = responseText(response);

      expect(response.isError).toBe(true);
      expect(text).toMatch(/^INVALID_GRAPH:/);
      expect(text).not.toContain(secret);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
