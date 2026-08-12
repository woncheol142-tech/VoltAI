import {
  createVoltAiMcpServer,
  isMainModule,
  runStdioServer,
} from "@voltai/mcp-core";

import { createReviewProjectTool } from "./tools/reviewProjectTool.js";
import { createReviewElectricalRequestTool } from "./tools/reviewElectricalRequestTool.js";

export function createServer() {
  return createVoltAiMcpServer({
    name: "mcp-agent",
    version: "0.1.0",
    tools: [createReviewProjectTool(), createReviewElectricalRequestTool()],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
