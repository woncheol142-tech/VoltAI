import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { placeholderTool } from "./tools/placeholder.js";
import { createIndexMaterialTool } from "./tools/indexMaterial.js";
import { createSearchMaterialTool } from "./tools/searchMaterial.js";
import type { MaterialEnvironment } from "./config.js";

export {
  createMaterialEmbeddingProviderFromEnv,
  resolveMaterialKnowledgeDbPath,
} from "./config.js";
export { createIndexMaterialTool } from "./tools/indexMaterial.js";
export { createSearchMaterialTool } from "./tools/searchMaterial.js";
export { placeholderTool, placeholderToolName, createPlaceholderMessage } from "./tools/placeholder.js";
export type { MaterialEnvironment } from "./config.js";
export type { IndexMaterialResult } from "./tools/indexMaterial.js";
export type { SearchMaterialResult } from "./tools/searchMaterial.js";

export function createServer(options: { environment?: MaterialEnvironment } = {}) {
  return createVoltAiMcpServer({
    name: "mcp-material",
    version: "0.1.0",
    tools: [
      placeholderTool,
      createIndexMaterialTool({ environment: options.environment }),
      createSearchMaterialTool({ environment: options.environment }),
    ],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
