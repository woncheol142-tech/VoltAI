import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import type { VoltAiTool } from "@voltai/mcp-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type { KecSearchRequest } from "../src/searchFoundation/index.js";
import type { KecHybridSearchResult } from "../src/searchHybrid/index.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import { createServer } from "../src/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ToolModule = typeof import("../src/tools/searchKecHybrid.js");
type SearchKecHybridInput = ToolModule["SearchKecHybridInput"];
type SearchKecHybridToolResult = ToolModule["SearchKecHybridToolResult"];
type SearchKecHybridToolDependencies =
  ToolModule["SearchKecHybridToolDependencies"];
type CreateSearchKecHybridTool = ToolModule["createSearchKecHybridTool"];

type GenericStore = Pick<
  KnowledgeVectorStore,
  "getIndexMetadata" | "search" | "listChunks"
>;

type HybridServerOptions = Readonly<{
  hybridSearch?: Readonly<{
    rankingOptions: KecWeightedRankingOptions;
    embeddingProvider?: EmbeddingProvider;
    vectorStore?: GenericStore;
  }>;
}>;

type ExpectedSearchKecHybridInput = Readonly<{
  query: string;
  limit: number;
}>;

type ExpectedSearchKecHybridToolResult = Readonly<{
  results: KecHybridSearchResult;
}>;

type ExpectedCreateSearchKecHybridTool = (
  dependencies: SearchKecHybridToolDependencies,
) => VoltAiTool<ExpectedSearchKecHybridToolResult>;

type EqualTypes<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;

describe("native KEC hybrid MCP type contracts", () => {
  it("compiles the approved positive and negative contracts", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("keeps no-argument, undefined, and empty createServer calls compatible", () => {
    const compileOnly = (): void => {
      createServer();
      createServer(undefined);
      createServer({});
    };

    expect(compileOnly).toBeTypeOf("function");
  });

  it("requires caller-owned ranking options only when hybrid is enabled", () => {
    const compileOnly = (
      options: KecWeightedRankingOptions,
      provider: EmbeddingProvider,
      vectorStore: GenericStore,
    ): void => {
      createServer({ hybridSearch: { rankingOptions: options } });
      createServer({
        hybridSearch: {
          rankingOptions: options,
          embeddingProvider: provider,
          vectorStore,
        },
      });

      const missingRanking: HybridServerOptions = {
        // @ts-expect-error rankingOptions is required
        hybridSearch: {},
      };
      const wrongRanking: HybridServerOptions = {
        hybridSearch: {
          rankingOptions: {
            // @ts-expect-error semanticWeight must be numeric
            semanticWeight: "1",
            lexicalWeight: 1,
          },
        },
      };
      const wrongProvider: HybridServerOptions = {
        hybridSearch: {
          rankingOptions: options,
          // @ts-expect-error provider must satisfy EmbeddingProvider
          embeddingProvider: {},
        },
      };

      void missingRanking;
      void wrongRanking;
      void wrongProvider;
      // These calls keep the future createServer parameter tied to the local
      // contract while avoiding diagnostics that depend on the current arity.
      // @ts-expect-error rankingOptions is required
      const impossible: HybridServerOptions = { hybridSearch: {} };
      void impossible;
    };

    expect(compileOnly).toBeTypeOf("function");
  });

  it("accepts only the generic store method subset", () => {
    const compileOnly = (
      ranking: KecWeightedRankingOptions,
      vectorStore: GenericStore,
    ): void => {
      createServer({
        hybridSearch: { rankingOptions: ranking, vectorStore },
      });

      const invalid: HybridServerOptions = {
        hybridSearch: {
          rankingOptions: ranking,
          // @ts-expect-error legacy VectorStore methods cannot satisfy generic store
          vectorStore: {
            getIndexMetadata: async () => null,
            search: async () => [],
          },
        },
      };
      void invalid;
    };

    expect(compileOnly).toBeTypeOf("function");
  });

  it("defines the exact transport input and wrapper result", () => {
    const assertInput = (
      actual: SearchKecHybridInput,
      expected: ExpectedSearchKecHybridInput,
    ): void => {
      const forward: ExpectedSearchKecHybridInput = actual;
      const reverse: SearchKecHybridInput = expected;
      void forward;
      void reverse;
    };
    const assertOutput = (
      actual: SearchKecHybridToolResult,
      expected: ExpectedSearchKecHybridToolResult,
    ): void => {
      const forward: ExpectedSearchKecHybridToolResult = actual;
      const reverse: SearchKecHybridToolResult = expected;
      void forward;
      void reverse;
    };

    const invalidInput = (input: ExpectedSearchKecHybridInput): void => {
      void input;
      const question: ExpectedSearchKecHybridInput = {
        // @ts-expect-error the transport input has no legacy question alias
        question: "cable",
        limit: 5,
      };
      const topK: ExpectedSearchKecHybridInput = {
        query: "cable",
        // @ts-expect-error the transport input has no topK alias
        topK: 5,
      };
      const weights: ExpectedSearchKecHybridInput = {
        query: "cable",
        limit: 5,
        // @ts-expect-error ranking weights are server configuration
        semanticWeight: 1,
      };
      void question;
      void topK;
      void weights;
    };

    expect(assertInput).toBeTypeOf("function");
    expect(assertOutput).toBeTypeOf("function");
    expect(invalidInput).toBeTypeOf("function");
  });

  it("preserves candidate signal types without legacy fields", () => {
    const invalidResult = (result: ExpectedSearchKecHybridToolResult): void => {
      const candidate = result.results[0]!;
      const chunkId: string = candidate.chunkId;
      const semanticScore: number | undefined = candidate.signals.semanticScore;
      const lexicalScore: number | undefined = candidate.signals.lexicalScore;
      // @ts-expect-error native candidates do not expose similarity
      void candidate.similarity;
      // @ts-expect-error weighted score remains private
      void candidate.weightedScore;
      // @ts-expect-error persisted documentId is not transported
      void candidate.documentId;
      void chunkId;
      void semanticScore;
      void lexicalScore;
    };

    expect(invalidResult).toBeTypeOf("function");
  });

  it("keeps the tool factory namespace-internal", () => {
    const assertFactory = (
      actual: CreateSearchKecHybridTool,
      expected: ExpectedCreateSearchKecHybridTool,
    ): void => {
      const forward: ExpectedCreateSearchKecHybridTool = actual;
      const reverse: CreateSearchKecHybridTool = expected;
      void forward;
      void reverse;
    };

    type PackageRoot = typeof import("../src/index.js");
    type ForbiddenRootExports = {
      // @ts-expect-error tool factory is not a package-root export
      readonly factory: PackageRoot["createSearchKecHybridTool"];
      // @ts-expect-error native Task 52 entry point remains internal
      readonly nativeSearch: PackageRoot["searchKecHybrid"];
    };

    expect(assertFactory).toBeTypeOf("function");
    expectTypeOf<ForbiddenRootExports>().toBeObject();
  });

  it("keeps the proposed server options structurally unambiguous", () => {
    const compileOnly = (options?: HybridServerOptions): void => {
      createServer(options);
    };
    const exactParameters: EqualTypes<
      Parameters<typeof createServer>,
      [options?: HybridServerOptions]
    > = true;

    expect(compileOnly).toBeTypeOf("function");
    expect(exactParameters).toBe(true);
    expectTypeOf<KecSearchRequest>().toEqualTypeOf<
      Readonly<{ query: string; limit: number }>
    >();
  });
});
