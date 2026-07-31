import { isMainModule, runStdioServer } from "@voltai/mcp-core";

import { createServer } from "./index.js";
import {
  type KecHybridRuntimeEnvironment,
  readKecHybridRuntimeConfig,
} from "./runtime/hybridRuntimeConfig.js";

export function createHybridServer(
  environment: KecHybridRuntimeEnvironment,
): ReturnType<typeof createServer> {
  const config = readKecHybridRuntimeConfig(environment);

  return createServer({
    hybridSearch: {
      rankingOptions: config.rankingOptions,
    },
  });
}

export async function main(): Promise<void> {
  const server = createHybridServer({
    KEC_HYBRID_SEMANTIC_WEIGHT: process.env.KEC_HYBRID_SEMANTIC_WEIGHT,
    KEC_HYBRID_LEXICAL_WEIGHT: process.env.KEC_HYBRID_LEXICAL_WEIGHT,
  });

  await runStdioServer(server);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
