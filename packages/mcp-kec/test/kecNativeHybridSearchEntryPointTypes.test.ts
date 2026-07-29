import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  KecRankCandidate,
  KecSearchRequest,
} from "../src/searchFoundation/index.js";
import type {
  KecHybridSearchOrchestrator,
  KecHybridSearchResult,
} from "../src/searchHybrid/index.js";
import type { ExistingKecHybridSearchDependencies } from "../src/searchIntegration/index.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import { searchKecHybrid } from "../src/searchEntryPoints/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const entryPointIndex = join(
  packageRoot,
  "src",
  "searchEntryPoints",
  "index.ts",
);
const entryPointTypes = join(
  packageRoot,
  "src",
  "searchEntryPoints",
  "types.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExistingHybridReturnType = ReturnType<
  KecHybridSearchOrchestrator["search"]
>;

type ExpectedSearchKecHybrid = (
  request: KecSearchRequest,
  dependencies: ExistingKecHybridSearchDependencies,
  rankingOptions: KecWeightedRankingOptions,
) => ExistingHybridReturnType;

describe("native KEC hybrid search entry-point type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(entryPointIndex)).toBe(true);
    expect(existsSync(entryPointTypes)).toBe(false);

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

  it("exports the exact three-parameter one-shot API", () => {
    expectTypeOf<
      typeof searchKecHybrid
    >().toEqualTypeOf<ExpectedSearchKecHybrid>();
    expectTypeOf<Parameters<typeof searchKecHybrid>>().toEqualTypeOf<
      [
        KecSearchRequest,
        ExistingKecHybridSearchDependencies,
        KecWeightedRankingOptions,
      ]
    >();
  });

  it("reuses the existing Task 47 return type authority", () => {
    expectTypeOf<KecHybridSearchResult>().toEqualTypeOf<
      readonly KecRankCandidate[]
    >();
    expectTypeOf<ReturnType<typeof searchKecHybrid>>().toEqualTypeOf<
      ReturnType<KecHybridSearchOrchestrator["search"]>
    >();
  });

  it("rejects legacy request aliases at compile time", () => {
    const invalidRequests = (
      search: ExpectedSearchKecHybrid,
      dependencies: ExistingKecHybridSearchDependencies,
      rankingOptions: KecWeightedRankingOptions,
    ): void => {
      // @ts-expect-error native requests use limit, not topK
      search({ query: "cable", topK: 5 }, dependencies, rankingOptions);
      // @ts-expect-error native requests do not support question
      search({ question: "cable", topK: 5 }, dependencies, rankingOptions);
    };

    expect(invalidRequests).toBeTypeOf("function");
  });

  it("requires both exact request fields", () => {
    const invalidRequests = (
      search: ExpectedSearchKecHybrid,
      dependencies: ExistingKecHybridSearchDependencies,
      rankingOptions: KecWeightedRankingOptions,
    ): void => {
      // @ts-expect-error limit is required
      search({ query: "cable" }, dependencies, rankingOptions);
      // @ts-expect-error query is required
      search({ limit: 5 }, dependencies, rankingOptions);
    };

    expect(invalidRequests).toBeTypeOf("function");
  });

  it("requires the existing dependency contract", () => {
    const invalidDependencies = (
      search: ExpectedSearchKecHybrid,
      request: KecSearchRequest,
      rankingOptions: KecWeightedRankingOptions,
    ): void => {
      // @ts-expect-error both provider and generic store are required
      search(request, {}, rankingOptions);
      // @ts-expect-error vectorStore is required
      search(request, { embeddingProvider: {} }, rankingOptions);
    };

    expect(invalidDependencies).toBeTypeOf("function");
  });

  it("requires explicit existing ranking options", () => {
    const invalidOptions = (
      search: ExpectedSearchKecHybrid,
      request: KecSearchRequest,
      dependencies: ExistingKecHybridSearchDependencies,
    ): void => {
      // @ts-expect-error lexicalWeight is required
      search(request, dependencies, { semanticWeight: 1 });
      search(request, dependencies, {
        // @ts-expect-error weights must be numbers
        semanticWeight: "1",
        lexicalWeight: 1,
      });
    };

    expect(invalidOptions).toBeTypeOf("function");
  });

  it("does not make any parameter optional", () => {
    const invalidCalls = (
      search: ExpectedSearchKecHybrid,
      request: KecSearchRequest,
      dependencies: ExistingKecHybridSearchDependencies,
    ): void => {
      // @ts-expect-error ranking options are required
      search(request, dependencies);
      // @ts-expect-error dependencies and ranking options are required
      search(request);
    };

    expect(invalidCalls).toBeTypeOf("function");
  });

  it("does not expose legacy or wrapper result assumptions", () => {
    const invalidAssumptions = (
      result: Awaited<ReturnType<ExpectedSearchKecHybrid>>,
    ): void => {
      // @ts-expect-error native results are arrays, not { results } wrappers
      void result.results;
      // @ts-expect-error native candidates expose score channels, not similarity
      void result[0]!.similarity;
      // @ts-expect-error weightedScore remains private to Task 48
      void result[0]!.weightedScore;
    };

    expect(invalidAssumptions).toBeTypeOf("function");
  });

  it("does not expose lifecycle on the returned Promise", () => {
    const invalidLifecycle = (
      result: ReturnType<ExpectedSearchKecHybrid>,
    ): void => {
      // @ts-expect-error the entry point does not own close
      result.close();
      // @ts-expect-error the entry point does not own dispose
      result.dispose();
    };

    expect(invalidLifecycle).toBeTypeOf("function");
  });

  it("does not expose the native entry point from the package root", () => {
    type PackageRoot = typeof import("../src/index.js");

    type RootEntryPointLookup = {
      // @ts-expect-error Task 52 remains namespace-internal
      readonly entryPoint: PackageRoot["searchKecHybrid"];
    };

    expectTypeOf<RootEntryPointLookup>().toBeObject();
  });
});
