import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type { KecHybridSearchOrchestrator } from "../src/searchHybrid/index.js";
import {
  createExistingKecHybridSearch,
  type ExistingKecHybridSearchDependencies,
} from "../src/searchIntegration/index.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const integrationIndex = join(
  packageRoot,
  "src",
  "searchIntegration",
  "index.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedStore = Pick<
  KnowledgeVectorStore,
  "getIndexMetadata" | "search" | "listChunks"
>;

type ExpectedDependencies = Readonly<{
  embeddingProvider: EmbeddingProvider;
  vectorStore: ExpectedStore;
}>;

type ExpectedFactory = (
  dependencies: ExistingKecHybridSearchDependencies,
  rankingOptions: KecWeightedRankingOptions,
) => KecHybridSearchOrchestrator;

describe("KEC hybrid search integration type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(integrationIndex)).toBe(true);

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

  it("reuses the existing provider, store, ranking, and orchestrator types", () => {
    expectTypeOf<ExistingKecHybridSearchDependencies>().toEqualTypeOf<ExpectedDependencies>();
    expectTypeOf<
      typeof createExistingKecHybridSearch
    >().toEqualTypeOf<ExpectedFactory>();
    expectTypeOf<
      ReturnType<typeof createExistingKecHybridSearch>
    >().toEqualTypeOf<KecHybridSearchOrchestrator>();
  });

  it("keeps integration dependencies readonly", () => {
    const replaceDependencies = (
      dependencies: ExistingKecHybridSearchDependencies,
      embeddingProvider: EmbeddingProvider,
      vectorStore: ExpectedStore,
    ): void => {
      // @ts-expect-error integration dependencies are readonly
      dependencies.embeddingProvider = embeddingProvider;
      // @ts-expect-error integration dependencies are readonly
      dependencies.vectorStore = vectorStore;
    };

    expect(replaceDependencies).toBeTypeOf("function");
  });

  it("requires both the embedding provider and vector store", () => {
    const invalidDependencies = (
      embeddingProvider: EmbeddingProvider,
      vectorStore: ExpectedStore,
    ): void => {
      // @ts-expect-error embeddingProvider is required
      const missingEmbedding: ExistingKecHybridSearchDependencies = {
        vectorStore,
      };
      // @ts-expect-error vectorStore is required
      const missingStore: ExistingKecHybridSearchDependencies = {
        embeddingProvider,
      };

      expectTypeOf(missingEmbedding).toMatchTypeOf<ExpectedDependencies>();
      expectTypeOf(missingStore).toMatchTypeOf<ExpectedDependencies>();
    };

    expect(invalidDependencies).toBeTypeOf("function");
  });

  it("requires all three approved store methods", () => {
    const invalidStores = (embeddingProvider: EmbeddingProvider): void => {
      const withoutMetadata = {} as Omit<ExpectedStore, "getIndexMetadata">;
      const withoutSearch = {} as Omit<ExpectedStore, "search">;
      const withoutList = {} as Omit<ExpectedStore, "listChunks">;

      const missingMetadata: ExistingKecHybridSearchDependencies = {
        embeddingProvider,
        // @ts-expect-error getIndexMetadata is required
        vectorStore: withoutMetadata,
      };
      const missingSearch: ExistingKecHybridSearchDependencies = {
        embeddingProvider,
        // @ts-expect-error search is required
        vectorStore: withoutSearch,
      };
      const missingList: ExistingKecHybridSearchDependencies = {
        embeddingProvider,
        // @ts-expect-error listChunks is required
        vectorStore: withoutList,
      };

      expect(missingMetadata).toBeDefined();
      expect(missingSearch).toBeDefined();
      expect(missingList).toBeDefined();
    };

    expect(invalidStores).toBeTypeOf("function");
  });

  it("reuses the exact weighted ranking option contract", () => {
    const dependencies = {} as ExistingKecHybridSearchDependencies;

    const invalidRankingOptions = (): void => {
      // @ts-expect-error lexicalWeight is required by Task 48
      createExistingKecHybridSearch(dependencies, { semanticWeight: 1 });
      createExistingKecHybridSearch(dependencies, {
        // @ts-expect-error ranking weights must be numbers
        semanticWeight: "1",
        lexicalWeight: 1,
      });
    };

    expectTypeOf<KecWeightedRankingOptions>().toEqualTypeOf<{
      readonly semanticWeight: number;
      readonly lexicalWeight: number;
    }>();
    expect(invalidRankingOptions).toBeTypeOf("function");
  });

  it("does not add lifecycle methods to the returned orchestrator", () => {
    const assumeLifecycle = (
      orchestrator: ReturnType<typeof createExistingKecHybridSearch>,
    ): void => {
      // @ts-expect-error integration does not own close
      orchestrator.close();
      // @ts-expect-error integration does not own dispose
      orchestrator.dispose();
    };

    expect(assumeLifecycle).toBeTypeOf("function");
  });

  it("does not expose the internal factory from the package root", () => {
    type PackageRoot = typeof import("../src/index.js");

    type RootFactoryLookup = {
      // @ts-expect-error Task 51 remains internal-only
      readonly factory: PackageRoot["createExistingKecHybridSearch"];
    };

    expectTypeOf<RootFactoryLookup>().toBeObject();
  });
});
