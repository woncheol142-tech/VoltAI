import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createKecWeightedRankingStrategy,
  type KecWeightedRankingOptions,
} from "../src/searchRanking/index.js";
import type {
  KecRankCandidate,
  KecRankingStrategy,
} from "../src/searchFoundation/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const rankingIndex = join(packageRoot, "src", "searchRanking", "index.ts");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedOptions = {
  readonly semanticWeight: number;
  readonly lexicalWeight: number;
};

type ExpectedFactory = (
  options: KecWeightedRankingOptions,
) => KecRankingStrategy;

describe("KEC weighted ranking public type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(rankingIndex)).toBe(true);

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

  it("defines the exact readonly options and factory signature", () => {
    expectTypeOf<KecWeightedRankingOptions>().toEqualTypeOf<ExpectedOptions>();
    expectTypeOf<
      typeof createKecWeightedRankingStrategy
    >().toEqualTypeOf<ExpectedFactory>();
  });

  it("returns the existing Task 46 ranking strategy contract", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 0.6,
      lexicalWeight: 0.4,
    });

    expectTypeOf(strategy).toEqualTypeOf<KecRankingStrategy>();
    expectTypeOf(strategy.rank).returns.toEqualTypeOf<
      readonly KecRankCandidate[]
    >();
  });

  it("supports structural use without a separate candidate DTO", () => {
    const candidate: KecRankCandidate = {
      chunkId: "chunk-1",
      sourcePath: "knowledge/kec.pdf",
      page: 1,
      clause: null,
      text: "Grounding requirement.",
      signals: { semanticScore: 0.8 },
    };
    const strategy: KecRankingStrategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 0,
    });

    expect(strategy.rank([candidate], 1)).toEqual([candidate]);
  });

  it("keeps both option fields readonly at compile time", () => {
    const mutate = (options: KecWeightedRankingOptions): void => {
      // @ts-expect-error weighted ranking options are readonly
      options.semanticWeight = 1;
      // @ts-expect-error weighted ranking options are readonly
      options.lexicalWeight = 1;
    };

    expect(mutate).toBeTypeOf("function");
  });
});
