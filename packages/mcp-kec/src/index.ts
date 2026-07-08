import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { createIndexKecTool } from "./tools/indexKec.js";
import { placeholderTool } from "./tools/placeholder.js";
import { createSearchKecTool } from "./tools/searchKec.js";

export { createEmbeddingProviderFromEnv } from "./knowledge/embedding.js";
export { SqliteVectorStore } from "./knowledge/sqliteVectorStore.js";
export { searchKec } from "./tools/searchKec.js";
export type { KecSearchResult } from "./knowledge/vectorStore.js";

export function createServer() {
  return createVoltAiMcpServer({
    name: "mcp-kec",
    version: "0.1.0",
    tools: [placeholderTool, createIndexKecTool(), createSearchKecTool()],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
