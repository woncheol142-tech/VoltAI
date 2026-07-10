import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { mapToolError } from "./errors.js";
import type { VoltAiTool } from "./tools.js";

export type VoltAiMcpServerConfig = {
  name: string;
  version: string;
  tools: VoltAiTool[];
};

export type ConnectableMcpServer = {
  connect: (transport: StdioServerTransport) => Promise<void>;
};

function serializeToolResult<TResult>(tool: VoltAiTool<TResult>, result: TResult): string {
  if (tool.serializeResult) {
    return tool.serializeResult(result);
  }

  if (typeof result === "string") {
    return result;
  }

  return JSON.stringify(result);
}

export function createVoltAiMcpServer(config: VoltAiMcpServerConfig): McpServer {
  const server = new McpServer({
    name: config.name,
    version: config.version,
  });

  for (const tool of config.tools) {
    server.tool(tool.name, tool.description, tool.inputSchema, async (input) => {
      try {
        const result = await tool.handler(input);
        const text = serializeToolResult(tool, result);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: mapToolError(error) }],
        };
      }
    });
  }

  return server;
}

export async function runStdioServer(server: ConnectableMcpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
