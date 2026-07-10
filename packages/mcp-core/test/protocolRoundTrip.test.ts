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
      handler: (input) => input,
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

  it("serializes object results as JSON text at the MCP boundary", async () => {
    const objectTool: VoltAiTool<{ ok: boolean; count: number }> = {
      name: "object_result",
      description: "Return an object.",
      inputSchema: {},
      handler: () => ({ ok: true, count: 2 }),
    };
    const client = await connectInMemory(
      createVoltAiMcpServer({
        name: "mcp-core-object-result",
        version: "0.1.0",
        tools: [objectTool],
      }),
    );

    const result = await client.callTool({ name: "object_result", arguments: {} });

    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ ok: true, count: 2 }),
      },
    ]);
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, count: 2 });
  });

  it("passes string results through unchanged at the MCP boundary", async () => {
    const textTool: VoltAiTool<string> = {
      name: "text_result",
      description: "Return text.",
      inputSchema: {},
      handler: () => "# 프로젝트 개요",
    };
    const client = await connectInMemory(
      createVoltAiMcpServer({
        name: "mcp-core-text-result",
        version: "0.1.0",
        tools: [textTool],
      }),
    );

    const result = await client.callTool({ name: "text_result", arguments: {} });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "# 프로젝트 개요",
      },
    ]);
  });

  it("uses a custom serializer when a tool provides one", async () => {
    const customTool: VoltAiTool<{ value: number }> = {
      name: "custom_result",
      description: "Return custom text.",
      inputSchema: {},
      handler: () => ({ value: 7 }),
      serializeResult: (result) => `value=${result.value}`,
    };
    const client = await connectInMemory(
      createVoltAiMcpServer({
        name: "mcp-core-custom-result",
        version: "0.1.0",
        tools: [customTool],
      }),
    );

    const result = await client.callTool({ name: "custom_result", arguments: {} });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "value=7",
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
