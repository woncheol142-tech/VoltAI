import type { KnowledgeVectorStore, PageLocator } from "@voltai/knowledge-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, vi } from "vitest";

import type { EmbeddingProvider } from "../../src/knowledge/embedding.js";
import type { KecKnowledgeMetadata } from "../../src/knowledge/kecKnowledgeAdapter.js";
import type { KecRankCandidate } from "../../src/searchFoundation/index.js";
import type { KecHybridSearchResult } from "../../src/searchHybrid/index.js";
import type { ExistingKecHybridSearchDependencies } from "../../src/searchIntegration/index.js";
import type { KecWeightedRankingOptions } from "../../src/searchRanking/index.js";
import {
  integrationHarness,
  type IntegrationHarness,
  type IntegrationHarnessOptions,
  type PersistedKecLexicalChunk,
  type PersistedKecSemanticHit,
} from "./kecHybridSearchIntegrationFixture.js";

export type ClosableHybridStore = Pick<
  KnowledgeVectorStore,
  "getIndexMetadata" | "search" | "listChunks"
> & {
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

export type HybridToolHarness = IntegrationHarness & {
  readonly closableStore: ClosableHybridStore;
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

export type HybridToolHarnessOptions = IntegrationHarnessOptions & {
  readonly closeError?: unknown;
};

export function rankingOptions(
  overrides: Partial<KecWeightedRankingOptions> = {},
): KecWeightedRankingOptions {
  return {
    semanticWeight: 0.7,
    lexicalWeight: 0.3,
    ...overrides,
  };
}

export function semanticCandidate(
  overrides: Partial<KecRankCandidate> = {},
): KecRankCandidate {
  return {
    chunkId: "semantic-chunk",
    sourcePath: "knowledge/semantic.pdf",
    page: 11,
    clause: "KEC 232.5",
    text: "semantic candidate",
    signals: { semanticScore: 0.91 },
    ...overrides,
  };
}

export function lexicalCandidate(
  overrides: Partial<KecRankCandidate> = {},
): KecRankCandidate {
  return {
    chunkId: "lexical-chunk",
    sourcePath: "knowledge/lexical.pdf",
    page: 17,
    clause: null,
    text: "lexical candidate",
    signals: { lexicalScore: 4 },
    ...overrides,
  };
}

export function bothSignalsCandidate(
  overrides: Partial<KecRankCandidate> = {},
): KecRankCandidate {
  return {
    chunkId: "both-chunk",
    sourcePath: "knowledge/both.pdf",
    page: 23,
    clause: "KEC 211.2",
    text: "combined candidate",
    signals: { semanticScore: 0.82, lexicalScore: 3 },
    ...overrides,
  };
}

export function nativeHybridResult(
  candidates: readonly KecRankCandidate[] = [
    bothSignalsCandidate(),
    semanticCandidate(),
    lexicalCandidate(),
  ],
): KecHybridSearchResult {
  return Object.freeze([...candidates]);
}

export function hybridToolHarness(
  options: HybridToolHarnessOptions = {},
): HybridToolHarness {
  const harness = integrationHarness(options);
  const close = vi.fn(async () => {
    if (options.closeError !== undefined) {
      throw options.closeError;
    }
  });
  const closableStore: ClosableHybridStore = {
    ...harness.vectorStore,
    close,
  };

  return {
    ...harness,
    closableStore,
    close,
  };
}

export function injectedDependencies(
  harness: HybridToolHarness = hybridToolHarness(),
): {
  readonly embeddingProvider: EmbeddingProvider;
  readonly vectorStore: ExistingKecHybridSearchDependencies["vectorStore"];
} {
  return {
    embeddingProvider: harness.embeddingProvider,
    vectorStore: harness.closableStore,
  };
}

export function persistedSemanticResults(
  values: PersistedKecSemanticHit[],
): PersistedKecSemanticHit[] {
  return values;
}

export function persistedLexicalChunks(
  values: PersistedKecLexicalChunk[],
): PersistedKecLexicalChunk[] {
  return values;
}

export async function connectHybridMcpServer(server: McpServer): Promise<{
  readonly client: Client;
  readonly server: McpServer;
}> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "kec-hybrid-tool-test-client",
    version: "0.1.0",
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

export function mcpResponseText(
  response: Awaited<ReturnType<Client["callTool"]>>,
): string {
  const content = (response as { content: unknown[] }).content[0];
  expect(content).toMatchObject({ type: "text" });
  return (content as { type: "text"; text: string }).text;
}

export async function closeHybridMcpConnection(connection: {
  readonly client: Client;
  readonly server: McpServer;
}): Promise<void> {
  await Promise.allSettled([
    connection.client.close(),
    connection.server.close(),
  ]);
}

export type HybridGenericResult = {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly locator: PageLocator;
  readonly metadata: KecKnowledgeMetadata;
  readonly text: string;
  readonly similarity: number;
};
