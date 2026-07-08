import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createVoltAiMcpServer,
  isMainModule,
  mapToolError,
  runStdioServer,
  type VoltAiTool,
} from "../src/index.js";

describe("mcp-core server factory", () => {
  it("creates an MCP server and registers VoltAI tools", () => {
    const tool: VoltAiTool = {
      name: "core_placeholder",
      description: "Core placeholder tool.",
      inputSchema: {},
      handler: () => "core tool response",
    };

    const server = createVoltAiMcpServer({
      name: "mcp-core-test",
      version: "0.1.0",
      tools: [tool],
    });

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  it("maps known and unknown tool errors to text responses", () => {
    expect(mapToolError(new Error("known failure"))).toBe("known failure");
    expect(mapToolError("string failure")).toBe("Unknown MCP tool error");
    expect(mapToolError(null)).toBe("Unknown MCP tool error");
  });

  it("connects a server over stdio transport", async () => {
    const server = {
      connect: vi.fn().mockResolvedValue(undefined),
    };

    await runStdioServer(server);

    expect(server.connect).toHaveBeenCalledTimes(1);
  });

  it("uses pathToFileURL semantics for entrypoint guards with spaces in paths", () => {
    expect(isMainModule("file:///tmp/Volt%20AI/dist/index.js", "/tmp/Volt AI/dist/index.js")).toBe(
      true,
    );
    expect(isMainModule("file:///tmp/Volt%20AI/dist/index.js", "/tmp/Other/dist/index.js")).toBe(
      false,
    );
    expect(isMainModule("file:///tmp/Volt%20AI/dist/index.js", undefined)).toBe(false);
  });

  it("requires VoltAiTool implementations to expose an inputSchema contract", () => {
    const tool: VoltAiTool = {
      name: "with_input",
      description: "Tool with input.",
      inputSchema: {
        relativePath: z.string().min(1),
      },
      handler: () => "ok",
    };

    expect(tool.inputSchema).toHaveProperty("relativePath");
  });
});
