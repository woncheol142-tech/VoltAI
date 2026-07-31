import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type { KecHybridRuntimeEnvironment } from "../src/runtime/hybridRuntimeConfig.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import {
  closeHybridMcpConnection,
  connectHybridMcpServer,
} from "./helpers/kecHybridSearchToolFixture.js";

const runStdioServerMock = vi.hoisted(() =>
  vi.fn(async (server: unknown) => {
    void server;
  }),
);
const createServerMock = vi.hoisted(() => vi.fn());
const embeddingProviderFactoryMock = vi.hoisted(() => vi.fn());
const sqliteStoreConstructorMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@voltai/mcp-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voltai/mcp-core")>();

  return {
    ...actual,
    isMainModule: () => false,
    runStdioServer: runStdioServerMock,
  };
});

vi.mock("@voltai/knowledge-sqlite", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@voltai/knowledge-sqlite")>();

  return {
    ...actual,
    SqliteKnowledgeStore: class ForbiddenSqliteKnowledgeStore {
      constructor(...argumentsValue: unknown[]) {
        sqliteStoreConstructorMock(...argumentsValue);
        throw new Error("SQLite construction is forbidden during startup");
      }
    },
  };
});

vi.mock("../src/knowledge/embedding.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/knowledge/embedding.js")>();

  return {
    ...actual,
    createEmbeddingProviderFromEnv: embeddingProviderFactoryMock,
  };
});

vi.mock("../src/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/index.js")>();

  return {
    ...actual,
    createServer: (
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
    ) => {
      createServerMock(options);
      return actual.createServer(options);
    },
  };
});

type RuntimeModule = typeof import("../src/hybrid.js");

const semanticName = "KEC_HYBRID_SEMANTIC_WEIGHT";
const lexicalName = "KEC_HYBRID_LEXICAL_WEIGHT";
const legacyTools = ["kec_placeholder", "index_kec", "search_kec"];
const hybridTools = [...legacyTools, "search_kec_hybrid"];

let runtime: RuntimeModule;
let importSideEffects: Readonly<{
  transport: number;
  embeddingProvider: number;
  sqliteStore: number;
  fetch: number;
}>;

function environment(
  semanticWeight = "0.7",
  lexicalWeight = "0.3",
): KecHybridRuntimeEnvironment {
  return {
    [semanticName]: semanticWeight,
    [lexicalName]: lexicalWeight,
  };
}

async function defaultCreateServer() {
  return (await import("../src/index.js")).createServer;
}

async function toolNames(server: McpServer): Promise<string[]> {
  const connection = await connectHybridMcpServer(server);

  try {
    return (await connection.client.listTools()).tools.map(({ name }) => name);
  } finally {
    await closeHybridMcpConnection(connection);
  }
}

describe("explicit KEC hybrid runtime MCP composition", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    vi.clearAllMocks();

    runtime = await import("../src/hybrid.js");
    importSideEffects = {
      transport: runStdioServerMock.mock.calls.length,
      embeddingProvider: embeddingProviderFactoryMock.mock.calls.length,
      sqliteStore: sqliteStoreConstructorMock.mock.calls.length,
      fetch: fetchMock.mock.calls.length,
    };
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports the smallest explicit composition API", () => {
    expect(runtime.createHybridServer).toBeTypeOf("function");
    expect(runtime.main).toBeTypeOf("function");
    expectTypeOf<ReturnType<typeof runtime.createHybridServer>>().toEqualTypeOf<
      ReturnType<Awaited<ReturnType<typeof defaultCreateServer>>>
    >();
  });

  it("does not start transport or runtime dependencies when imported", () => {
    expect(importSideEffects).toEqual({
      transport: 0,
      embeddingProvider: 0,
      sqliteStore: 0,
      fetch: 0,
    });
  });

  it("keeps the default server at the exact legacy baseline", async () => {
    const createServer = await defaultCreateServer();

    await expect(toolNames(createServer())).resolves.toEqual(legacyTools);
  });

  it("registers exactly one hybrid tool after all legacy tools", async () => {
    const names = await toolNames(runtime.createHybridServer(environment()));

    expect(names).toEqual(hybridTools);
    expect(names.filter((name) => name === "search_kec_hybrid")).toHaveLength(
      1,
    );
  });

  it("forwards ranking weights without normalization, swapping, or mutation", () => {
    const input = Object.freeze(environment("2", "0.25"));

    runtime.createHybridServer(input);

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(createServerMock).toHaveBeenCalledWith({
      hybridSearch: {
        rankingOptions: {
          semanticWeight: 2,
          lexicalWeight: 0.25,
        },
      },
    });
    expect(input).toEqual(environment("2", "0.25"));
  });

  it("keeps tool ordering independent of valid ranking values", async () => {
    const first = runtime.createHybridServer(environment("1", "0"));
    const second = runtime.createHybridServer(environment("0", "3"));

    await expect(toolNames(first)).resolves.toEqual(hybridTools);
    await expect(toolNames(second)).resolves.toEqual(hybridTools);
  });

  it("creates independent servers and independently allocated options", () => {
    const first = runtime.createHybridServer(environment());
    const second = runtime.createHybridServer(environment());
    const firstOptions = createServerMock.mock.calls[0]?.[0];
    const secondOptions = createServerMock.mock.calls[1]?.[0];

    expect(first).not.toBe(second);
    expect(firstOptions).toEqual(secondOptions);
    expect(firstOptions).not.toBe(secondOptions);
    expect(firstOptions?.hybridSearch?.rankingOptions).not.toBe(
      secondOptions?.hybridSearch?.rankingOptions,
    );
  });

  it("fails invalid configuration before server or transport composition", () => {
    expect(() =>
      runtime.createHybridServer(environment("invalid-secret-weight", "1")),
    ).toThrow(/^INVALID_HYBRID_RUNTIME_CONFIG:/);

    expect(createServerMock).not.toHaveBeenCalled();
    expect(runStdioServerMock).not.toHaveBeenCalled();
    expect(embeddingProviderFactoryMock).not.toHaveBeenCalled();
    expect(sqliteStoreConstructorMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates and lists tools without provider, store, network, or STDIO", async () => {
    const names = await toolNames(runtime.createHybridServer(environment()));

    expect(names).toEqual(hybridTools);
    expect(embeddingProviderFactoryMock).not.toHaveBeenCalled();
    expect(sqliteStoreConstructorMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runStdioServerMock).not.toHaveBeenCalled();
  });

  it("starts only the explicit server through the existing transport helper", async () => {
    vi.stubEnv(semanticName, "0.8");
    vi.stubEnv(lexicalName, "0.2");

    await runtime.main();

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(createServerMock).toHaveBeenCalledWith({
      hybridSearch: {
        rankingOptions: {
          semanticWeight: 0.8,
          lexicalWeight: 0.2,
        },
      },
    });
    expect(runStdioServerMock).toHaveBeenCalledTimes(1);
    expect(runStdioServerMock.mock.calls[0]?.[0]).toBeInstanceOf(Object);
  });

  it("rejects invalid process configuration before STDIO startup", async () => {
    vi.stubEnv(semanticName, "bad-runtime-secret");
    vi.stubEnv(lexicalName, "1");

    await expect(runtime.main()).rejects.toThrow(
      /^INVALID_HYBRID_RUNTIME_CONFIG:/,
    );
    expect(createServerMock).not.toHaveBeenCalled();
    expect(runStdioServerMock).not.toHaveBeenCalled();
  });
});
