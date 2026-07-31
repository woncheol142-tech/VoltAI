import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import {
  closeHybridMcpConnection,
  connectHybridMcpServer,
  hybridToolHarness,
  mcpResponseText,
  nativeHybridResult,
  rankingOptions,
} from "./helpers/kecHybridSearchToolFixture.js";

const searchKecHybridMock = vi.hoisted(() => vi.fn());

vi.mock("../src/searchEntryPoints/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/searchEntryPoints/index.js")>();
  return { ...actual, searchKecHybrid: searchKecHybridMock };
});

type GenericStore = Pick<
  KnowledgeVectorStore,
  "getIndexMetadata" | "search" | "listChunks"
>;

type CreateServer = (
  options?: Readonly<{
    hybridSearch?: Readonly<{
      rankingOptions: KecWeightedRankingOptions;
      embeddingProvider?: EmbeddingProvider;
      vectorStore?: GenericStore;
    }>;
  }>,
) => ReturnType<(typeof import("../src/index.js"))["createServer"]>;

async function createServerFunction(): Promise<CreateServer> {
  const module = await import("../src/index.js");
  return module.createServer as CreateServer;
}

async function configuredConnection() {
  const harness = hybridToolHarness();
  const createServer = await createServerFunction();
  const server = createServer({
    hybridSearch: {
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    },
  });
  return {
    connection: await connectHybridMcpServer(server),
    harness,
  };
}

async function callHybrid(
  client: Client,
  argumentsValue: Record<string, unknown>,
) {
  return client.callTool({
    name: "search_kec_hybrid",
    arguments: argumentsValue,
  });
}

describe("native KEC hybrid MCP registration and transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the default server at the existing three-tool baseline", async () => {
    const createServer = await createServerFunction();
    const connection = await connectHybridMcpServer(createServer());
    try {
      const tools = await connection.client.listTools();
      expect(tools.tools.map(({ name }) => name)).toEqual([
        "kec_placeholder",
        "index_kec",
        "search_kec",
      ]);
    } finally {
      await closeHybridMcpConnection(connection);
    }
  }, 15_000);

  it("registers one configured hybrid tool after the unchanged legacy tools", async () => {
    const { connection } = await configuredConnection();
    try {
      const tools = await connection.client.listTools();
      const names = tools.tools.map(({ name }) => name);

      expect(names).toEqual([
        "kec_placeholder",
        "index_kec",
        "search_kec",
        "search_kec_hybrid",
      ]);
      expect(names.filter((name) => name === "search_kec_hybrid")).toHaveLength(
        1,
      );
      expect(
        tools.tools.find(({ name }) => name === "search_kec_hybrid")
          ?.description,
      ).toEqual(expect.any(String));
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("isolates configured and unconfigured server instances", async () => {
    const createServer = await createServerFunction();
    const harness = hybridToolHarness();
    const configured = await connectHybridMcpServer(
      createServer({
        hybridSearch: {
          rankingOptions: rankingOptions(),
          embeddingProvider: harness.embeddingProvider,
          vectorStore: harness.closableStore,
        },
      }),
    );
    const unconfigured = await connectHybridMcpServer(createServer());
    try {
      expect(
        (await configured.client.listTools()).tools.map(({ name }) => name),
      ).toContain("search_kec_hybrid");
      expect(
        (await unconfigured.client.listTools()).tools.map(({ name }) => name),
      ).not.toContain("search_kec_hybrid");
    } finally {
      await closeHybridMcpConnection(configured);
      await closeHybridMcpConnection(unconfigured);
    }
  });

  it("exposes the exact required transport schema", async () => {
    const { connection } = await configuredConnection();
    try {
      const tools = await connection.client.listTools();
      const hybrid = tools.tools.find(
        ({ name }) => name === "search_kec_hybrid",
      );

      expect(hybrid?.inputSchema.required).toEqual(["query", "limit"]);
      expect(Object.keys(hybrid?.inputSchema.properties ?? {}).sort()).toEqual([
        "limit",
        "query",
      ]);
      expect(hybrid?.inputSchema.properties?.query).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 4096,
      });
      expect(hybrid?.inputSchema.properties?.limit).toMatchObject({
        type: "integer",
        minimum: 0,
        maximum: 100,
      });
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("returns the Task 52 result inside only the approved wrapper", async () => {
    const result = nativeHybridResult();
    searchKecHybridMock.mockResolvedValueOnce(result);
    const { connection } = await configuredConnection();
    try {
      const response = await callHybrid(connection.client, {
        query: "cable",
        limit: 3,
      });
      const parsed = JSON.parse(mcpResponseText(response)) as {
        results: unknown[];
      };

      expect(response.isError).not.toBe(true);
      expect(parsed).toEqual({ results: result });
      expect(Reflect.ownKeys(parsed)).toEqual(["results"]);
      expect(
        parsed.results.map((candidate) => Reflect.ownKeys(candidate!)),
      ).toEqual(
        result.map(() => [
          "chunkId",
          "sourcePath",
          "page",
          "clause",
          "text",
          "signals",
        ]),
      );
      expect(JSON.stringify(parsed)).not.toMatch(
        /similarity|weightedScore|documentId|embedding|metadata|rankingOptions/,
      );
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("preserves optional semantic, lexical, and combined signals in JSON", async () => {
    const result = nativeHybridResult();
    searchKecHybridMock.mockResolvedValueOnce(result);
    const { connection } = await configuredConnection();
    try {
      const response = await callHybrid(connection.client, {
        query: "signals",
        limit: 3,
      });
      const parsed = JSON.parse(mcpResponseText(response)) as {
        results: Array<{ chunkId: string; signals: Record<string, number> }>;
      };

      expect(
        parsed.results.map(({ chunkId, signals }) => [chunkId, signals]),
      ).toEqual(result.map(({ chunkId, signals }) => [chunkId, signals]));
      expect(parsed.results[0]?.signals).toEqual({
        semanticScore: 0.82,
        lexicalScore: 3,
      });
      expect(parsed.results[1]?.signals).toEqual({ semanticScore: 0.91 });
      expect(parsed.results[2]?.signals).toEqual({ lexicalScore: 4 });
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("strips unknown transport keys before exact Task 52 delegation", async () => {
    searchKecHybridMock.mockResolvedValueOnce(nativeHybridResult([]));
    const { connection } = await configuredConnection();
    try {
      const response = await callHybrid(connection.client, {
        query: "unknown",
        limit: 1,
        question: "legacy",
        topK: 99,
        semanticWeight: 999,
        dbPath: "/tmp/injected.sqlite",
      });

      expect(response.isError).not.toBe(true);
      expect(searchKecHybridMock).toHaveBeenCalledTimes(1);
      expect(searchKecHybridMock.mock.calls[0]?.[0]).toEqual({
        query: "unknown",
        limit: 1,
      });
      expect(
        Reflect.ownKeys(searchKecHybridMock.mock.calls[0]?.[0] as object),
      ).toEqual(["query", "limit"]);
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it.each([
    [{ query: "", limit: 1 }, "query"],
    [{ query: "a".repeat(4097), limit: 1 }, "query"],
    [{ query: "cable", limit: -1 }, "limit"],
    [{ query: "cable", limit: 101 }, "limit"],
    [{ query: "cable", limit: 1.5 }, "limit"],
    [{ query: "cable" }, "limit"],
    [{ limit: 1 }, "query"],
  ] as const)("rejects invalid transport input %#", async (input, field) => {
    const { connection } = await configuredConnection();
    try {
      const response = await callHybrid(
        connection.client,
        input as Record<string, unknown>,
      );
      const text = mcpResponseText(response);

      expect(response.isError).toBe(true);
      expect(text).toContain("Input validation error");
      expect(text).toContain(field);
      expect(searchKecHybridMock).not.toHaveBeenCalled();
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("preserves Error.message mapping through MCP", async () => {
    const primary = new Error("task52 transport failure");
    searchKecHybridMock.mockRejectedValueOnce(primary);
    const { connection } = await configuredConnection();
    try {
      const response = await callHybrid(connection.client, {
        query: "error",
        limit: 1,
      });

      expect(response.isError).toBe(true);
      expect(mcpResponseText(response)).toBe(primary.message);
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("maps non-Error failures to the existing generic MCP text", async () => {
    searchKecHybridMock.mockRejectedValueOnce({ secret: "raw-provider-data" });
    const { connection } = await configuredConnection();
    try {
      const response = await callHybrid(connection.client, {
        query: "non-error",
        limit: 1,
      });
      const text = mcpResponseText(response);

      expect(response.isError).toBe(true);
      expect(text).toBe("Unknown MCP tool error");
      expect(text).not.toContain("raw-provider-data");
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });

  it("keeps existing legacy tools available on the configured server", async () => {
    const { connection } = await configuredConnection();
    try {
      const names = (await connection.client.listTools()).tools.map(
        ({ name }) => name,
      );
      expect(names).toEqual(
        expect.arrayContaining(["kec_placeholder", "index_kec", "search_kec"]),
      );
    } finally {
      await closeHybridMcpConnection(connection);
    }
  });
});
