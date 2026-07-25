import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createKecHybridSearchOrchestrator,
  type KecHybridSearchDependencies,
  type KecHybridSearchOrchestrator,
  type KecHybridSearchResult,
} from "../src/searchHybrid/index.js";
import type {
  KecLexicalSearcher,
  KecRankCandidate,
  KecRankingStrategy,
  KecSearchRequest,
  KecSemanticSearcher,
} from "../src/searchFoundation/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const hybridIndex = join(packageRoot, "src", "searchHybrid", "index.ts");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedDependencies = {
  readonly semanticSearcher: KecSemanticSearcher;
  readonly lexicalSearcher: KecLexicalSearcher;
  readonly rankingStrategy: KecRankingStrategy;
};

type ExpectedOrchestrator = {
  search(request: KecSearchRequest): Promise<readonly KecRankCandidate[]>;
};

type ExpectedFactory = (
  dependencies: KecHybridSearchDependencies,
) => KecHybridSearchOrchestrator;

describe("KEC hybrid search public type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(hybridIndex)).toBe(true);

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

  it("reuses the Task 46 request and rank candidate contracts", () => {
    expectTypeOf<KecHybridSearchResult>().toEqualTypeOf<
      readonly KecRankCandidate[]
    >();
    expectTypeOf<KecHybridSearchOrchestrator>().toEqualTypeOf<ExpectedOrchestrator>();
  });

  it("fixes readonly dependencies and the exact factory signature", () => {
    expectTypeOf<KecHybridSearchDependencies>().toEqualTypeOf<ExpectedDependencies>();
    expectTypeOf<
      typeof createKecHybridSearchOrchestrator
    >().toEqualTypeOf<ExpectedFactory>();
  });

  it("supports structural fake dependency injection", async () => {
    const ranked: readonly KecRankCandidate[] = [];
    const dependencies: KecHybridSearchDependencies = {
      semanticSearcher: { search: async () => [] },
      lexicalSearcher: { search: async () => [] },
      rankingStrategy: { rank: () => ranked },
    };
    const orchestrator = createKecHybridSearchOrchestrator(dependencies);
    const request: KecSearchRequest = { query: "cable", limit: 3 };

    await expect(orchestrator.search(request)).resolves.toBe(ranked);
  });

  it("rejects mutable dependency contracts at compile time", () => {
    const replaceDependencies = (
      dependencies: KecHybridSearchDependencies,
    ): void => {
      const semanticSearcher: KecSemanticSearcher = {
        search: async () => [],
      };
      const lexicalSearcher: KecLexicalSearcher = {
        search: async () => [],
      };
      const rankingStrategy: KecRankingStrategy = {
        rank: (candidates) => candidates,
      };

      // @ts-expect-error hybrid search dependencies are readonly
      dependencies.semanticSearcher = semanticSearcher;
      // @ts-expect-error hybrid search dependencies are readonly
      dependencies.lexicalSearcher = lexicalSearcher;
      // @ts-expect-error hybrid search dependencies are readonly
      dependencies.rankingStrategy = rankingStrategy;
    };

    expect(replaceDependencies).toBeTypeOf("function");
  });
});
