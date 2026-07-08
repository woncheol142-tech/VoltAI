import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { placeholderTool } from "./tools/placeholder.js";

export function createServer() {
  return createVoltAiMcpServer({
    name: "mcp-estimate",
    version: "0.1.0",
    tools: [placeholderTool],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
