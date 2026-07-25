import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  KecLexicalHit,
  KecLexicalSearcher,
  KecRankCandidate,
  KecRankSignals,
  KecRankingStrategy,
  KecSearchRequest,
  KecSemanticHit,
  KecSemanticSearcher,
} from "../src/searchFoundation/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const foundationIndex = join(
  packageRoot,
  "src",
  "searchFoundation",
  "index.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedSearchRequest = {
  readonly query: string;
  readonly limit: number;
};

type ExpectedSemanticHit = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly semanticScore: number;
};

type ExpectedLexicalHit = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly lexicalScore: number;
};

type ExpectedRankSignals = {
  readonly lexicalScore?: number;
  readonly semanticScore?: number;
};

type ExpectedRankCandidate = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly signals: KecRankSignals;
};

type ExpectedSemanticSearcher = {
  search(request: KecSearchRequest): Promise<readonly KecSemanticHit[]>;
};

type ExpectedLexicalSearcher = {
  search(request: KecSearchRequest): Promise<readonly KecLexicalHit[]>;
};

type ExpectedRankingStrategy = {
  rank(
    candidates: readonly KecRankCandidate[],
    limit: number,
  ): readonly KecRankCandidate[];
};

describe("KEC search foundation public type contracts", () => {
  it("compiles the approved interfaces and negative type contracts", () => {
    expect(existsSync(foundationIndex)).toBe(true);

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

  it("fixes the exact readonly request and hit shapes", () => {
    expectTypeOf<KecSearchRequest>().toEqualTypeOf<ExpectedSearchRequest>();
    expectTypeOf<KecSemanticHit>().toEqualTypeOf<ExpectedSemanticHit>();
    expectTypeOf<KecLexicalHit>().toEqualTypeOf<ExpectedLexicalHit>();
    expectTypeOf<KecRankSignals>().toEqualTypeOf<ExpectedRankSignals>();
    expectTypeOf<KecRankCandidate>().toEqualTypeOf<ExpectedRankCandidate>();
  });

  it("defines independent high-level search and ranking ports", () => {
    expectTypeOf<KecSemanticSearcher>().toEqualTypeOf<ExpectedSemanticSearcher>();
    expectTypeOf<KecLexicalSearcher>().toEqualTypeOf<ExpectedLexicalSearcher>();
    expectTypeOf<KecRankingStrategy>().toEqualTypeOf<ExpectedRankingStrategy>();
  });

  it("allows fake implementations through structural typing", async () => {
    const semanticSearcher: KecSemanticSearcher = {
      search: async () => [],
    };
    const lexicalSearcher: KecLexicalSearcher = {
      search: async () => [],
    };
    const rankingStrategy: KecRankingStrategy = {
      rank: (candidates) => candidates,
    };
    const request: KecSearchRequest = { query: "KEC cable", limit: 5 };

    await expect(semanticSearcher.search(request)).resolves.toEqual([]);
    await expect(lexicalSearcher.search(request)).resolves.toEqual([]);
    expect(rankingStrategy.rank([], request.limit)).toEqual([]);
  });

  it("rejects mutable contracts and low-level vector data at compile time", () => {
    const mutateRequest = (request: KecSearchRequest): void => {
      // @ts-expect-error search requests are readonly
      request.query = "changed";
      // @ts-expect-error search requests are readonly
      request.limit = 10;
    };
    const invalidSemanticHit: KecSemanticHit = {
      chunkId: "chunk-1",
      sourcePath: "knowledge/kec.pdf",
      page: 1,
      clause: null,
      text: "Cable requirement",
      semanticScore: 0.9,
      // @ts-expect-error embeddings are outside the high-level search contract
      embedding: [0.1, 0.2],
    };
    // @ts-expect-error lexicalScore is required for lexical hits
    const invalidLexicalHit: KecLexicalHit = {
      chunkId: "chunk-1",
      sourcePath: "knowledge/kec.pdf",
      page: 1,
      clause: null,
      text: "Cable requirement",
    };
    const invalidRankCandidate: KecRankCandidate = {
      chunkId: "chunk-1",
      sourcePath: "knowledge/kec.pdf",
      page: 1,
      clause: null,
      text: "Cable requirement",
      signals: {},
      // @ts-expect-error ranking scores must be nested under signals
      semanticScore: 0.9,
    };

    expect([
      mutateRequest,
      invalidSemanticHit,
      invalidLexicalHit,
      invalidRankCandidate,
    ]).toBeDefined();
  });
});
