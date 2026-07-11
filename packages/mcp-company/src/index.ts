import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { createIndexCompanyTool } from "./tools/indexCompany.js";
import { createSearchCompanyTool } from "./tools/searchCompany.js";
import type { CompanyEnvironment } from "./config.js";

export {
  createCompanyEmbeddingProviderFromEnv,
  resolveCompanyKnowledgeDbPath,
} from "./config.js";
export { createIndexCompanyTool } from "./tools/indexCompany.js";
export { createSearchCompanyTool } from "./tools/searchCompany.js";
export type { IndexCompanyResult } from "./tools/indexCompany.js";
export type { SearchCompanyResult } from "./tools/searchCompany.js";
export type { CompanyEnvironment } from "./config.js";

export function createServer(options: { environment?: CompanyEnvironment } = {}) {
  return createVoltAiMcpServer({
    name: "mcp-company",
    version: "0.1.0",
    tools: [
      createIndexCompanyTool({ environment: options.environment }),
      createSearchCompanyTool({ environment: options.environment }),
    ],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
