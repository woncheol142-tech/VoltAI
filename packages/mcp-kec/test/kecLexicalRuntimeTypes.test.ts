import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KnowledgeChunk, PageLocator } from "@voltai/knowledge-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { KecKnowledgeMetadata } from "../src/knowledge/kecKnowledgeAdapter.js";
import type {
  KecLexicalSearchDependencies,
  KecLexicalSearchResult,
  KecLexicalSourceChunk,
  searchKecLexically,
} from "../src/searchLexical/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const lexicalIndex = join(packageRoot, "src", "searchLexical", "index.ts");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedSourceChunk = Readonly<
  KnowledgeChunk<KecKnowledgeMetadata, PageLocator>
>;

type ExpectedResult = {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly locator: Readonly<PageLocator>;
  readonly metadata: Readonly<KecKnowledgeMetadata>;
  readonly text: string;
  readonly lexicalScore: number;
};

type ExpectedDependencies = Readonly<{
  listChunks: () => Promise<readonly KecLexicalSourceChunk[]>;
}>;

type ExpectedSearch = (
  query: string,
  limit: number,
  dependencies: KecLexicalSearchDependencies,
) => Promise<readonly KecLexicalSearchResult[]>;

describe("KEC lexical runtime public type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(lexicalIndex)).toBe(true);

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

  it("reuses the actual persisted KnowledgeChunk schema", () => {
    expectTypeOf<KecLexicalSourceChunk>().toEqualTypeOf<ExpectedSourceChunk>();
  });

  it("fixes the exact readonly result and injected-reader dependency types", () => {
    expectTypeOf<KecLexicalSearchResult>().toEqualTypeOf<ExpectedResult>();
    expectTypeOf<KecLexicalSearchDependencies>().toEqualTypeOf<ExpectedDependencies>();
  });

  it("exposes one function instead of a class, service, or factory hierarchy", () => {
    expectTypeOf<typeof searchKecLexically>().toEqualTypeOf<ExpectedSearch>();
  });

  it("keeps dependencies and runtime results readonly at compile time", () => {
    const mutateDependencies = (
      dependencies: KecLexicalSearchDependencies,
    ): void => {
      // @ts-expect-error lexical runtime dependencies are readonly
      dependencies.listChunks = async () => [];
    };
    const mutateResult = (result: KecLexicalSearchResult): void => {
      // @ts-expect-error lexical runtime results are readonly
      result.lexicalScore = 0;
      // @ts-expect-error chunkIndex is source-only and not public output
      result.chunkIndex = 1;
    };

    expect([mutateDependencies, mutateResult]).toHaveLength(2);
  });
});
