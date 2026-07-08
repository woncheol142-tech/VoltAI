import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { createReviewProjectTool } from "./tools/reviewProjectTool.js";

export function createServer() {
  return createVoltAiMcpServer({
    name: "mcp-agent",
    version: "0.1.0",
    tools: [createReviewProjectTool()],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
