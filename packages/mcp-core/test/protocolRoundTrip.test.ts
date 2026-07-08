import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createVoltAiMcpServer, type VoltAiTool } from "../src/index.js";

async function connectInMemory(server: ReturnType<typeof createVoltAiMcpServer>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "voltai-test-client",
    version: "0.1.0",
  });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return client;
}

describe("mcp-core protocol round-trip", () => {
  it("passes tool arguments through a real MCP client/server round-trip", async () => {
    const echoTool: VoltAiTool = {
      name: "echo_path",
      description: "Echo a path.",
      inputSchema: {
        relativePath: z.string().min(1),
      },
      handler: (input) => JSON.stringify(input),
    };
    const client = await connectInMemory(
      createVoltAiMcpServer({
        name: "mcp-core-round-trip",
        version: "0.1.0",
        tools: [echoTool],
      }),
    );

    const result = await client.callTool({
      name: "echo_path",
      arguments: { relativePath: "docs/panel.pdf" },
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ relativePath: "docs/panel.pdf" }),
      },
    ]);
  });

  it("returns an MCP error response for invalid protocol input", async () => {
    const echoTool: VoltAiTool = {
      name: "echo_path",
      description: "Echo a path.",
      inputSchema: {
        relativePath: z.string().min(1),
      },
      handler: (input) => JSON.stringify(input),
    };
    const client = await connectInMemory(
      createVoltAiMcpServer({
        name: "mcp-core-round-trip",
        version: "0.1.0",
        tools: [echoTool],
      }),
    );

    const result = await client.callTool({
      name: "echo_path",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("relativePath");
  });

  it("exposes non-empty input schemas through listTools", async () => {
    const readTool: VoltAiTool = {
      name: "read_pdf",
      description: "Read a PDF.",
      inputSchema: {
        relativePath: z.string().min(1),
        maxChars: z.number().int().positive().optional(),
      },
      handler: () => "ok",
    };
    const client = await connectInMemory(
      createVoltAiMcpServer({
        name: "mcp-core-round-trip",
        version: "0.1.0",
        tools: [readTool],
      }),
    );

    const result = await client.listTools();
    const tool = result.tools.find((candidate) => candidate.name === "read_pdf");

    expect(tool?.inputSchema.properties).toHaveProperty("relativePath");
    expect(tool?.inputSchema.properties).toHaveProperty("maxChars");
  });
});
