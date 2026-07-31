import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import {
  createVoltAiMcpServer,
  isMainModule,
  runStdioServer,
  type VoltAiTool,
} from "@voltai/mcp-core";

import type { EmbeddingProvider } from "./knowledge/embedding.js";
import type { KecWeightedRankingOptions } from "./searchRanking/index.js";
import { createIndexKecTool } from "./tools/indexKec.js";
import { placeholderTool } from "./tools/placeholder.js";
import { createSearchKecTool } from "./tools/searchKec.js";
import { createSearchKecHybridTool } from "./tools/searchKecHybrid.js";

export { createEmbeddingProviderFromEnv } from "./knowledge/embedding.js";
export {
  kecChunkToKnowledgeChunk,
  kecEmbeddedChunkToKnowledgeEmbeddedChunk,
  kecIndexMetadataToKnowledgeIndexMetadata,
  kecKnowledgeCodecs,
  kecSearchResultToKnowledgeSearchResult,
  knowledgeChunkToKecChunk,
  knowledgeEmbeddedChunkToKecEmbeddedChunk,
  knowledgeIndexMetadataToKecIndexMetadata,
  knowledgeSearchResultToKecSearchResult,
} from "./knowledge/kecKnowledgeAdapter.js";
export { SqliteVectorStore } from "./knowledge/sqliteVectorStore.js";
export { searchKec } from "./tools/searchKec.js";
export type { EmbeddingProvider } from "./knowledge/embedding.js";
export type { KecKnowledgeMetadata } from "./knowledge/kecKnowledgeAdapter.js";
export type { KecSearchResult } from "./knowledge/vectorStore.js";
export type { VectorStore } from "./knowledge/vectorStore.js";

export function createServer(
  options?: Readonly<{
    hybridSearch?: Readonly<{
      rankingOptions: KecWeightedRankingOptions;
      embeddingProvider?: EmbeddingProvider;
      vectorStore?: Pick<
        KnowledgeVectorStore,
        "getIndexMetadata" | "search" | "listChunks"
      >;
    }>;
  }>,
) {
  const tools: VoltAiTool[] = [
    placeholderTool,
    createIndexKecTool(),
    createSearchKecTool(),
  ];

  if (options?.hybridSearch) {
    tools.push(createSearchKecHybridTool(options.hybridSearch));
  }

  return createVoltAiMcpServer({
    name: "mcp-kec",
    version: "0.1.0",
    tools,
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
