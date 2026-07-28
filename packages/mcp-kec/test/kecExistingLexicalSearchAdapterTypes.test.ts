import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ExistingLexicalSearchAdapterDependencies,
  createExistingLexicalSearcher,
} from "../src/searchAdapters/index.js";
import type {
  KecLexicalHit,
  KecLexicalSearcher,
  KecSearchRequest,
} from "../src/searchFoundation/index.js";
import type { KecLexicalSearchResult } from "../src/searchLexical/index.js";
import {
  existingLexicalAdapterDependencies,
  type LexicalAdapterDependenciesFixture,
} from "./helpers/kecExistingLexicalSearchAdapterFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const lexicalAdapterSource = join(
  packageRoot,
  "src",
  "searchAdapters",
  "existingLexicalSearchAdapter.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedFactory = (
  dependencies: ExistingLexicalSearchAdapterDependencies,
) => KecLexicalSearcher;

describe("existing lexical search adapter public type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(lexicalAdapterSource)).toBe(true);

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

  it("uses the narrow Task 50A callback dependency contract", () => {
    expectTypeOf<ExistingLexicalSearchAdapterDependencies>().toEqualTypeOf<LexicalAdapterDependenciesFixture>();
    expectTypeOf<
      ExistingLexicalSearchAdapterDependencies["searchLexically"]
    >().returns.resolves.toEqualTypeOf<readonly KecLexicalSearchResult[]>();
  });

  it("returns the existing Task 46 lexical searcher contract", () => {
    expectTypeOf<
      typeof createExistingLexicalSearcher
    >().toEqualTypeOf<ExpectedFactory>();
    expectTypeOf<KecLexicalSearcher["search"]>()
      .parameter(0)
      .toEqualTypeOf<KecSearchRequest>();
    expectTypeOf<KecLexicalSearcher["search"]>().returns.resolves.toEqualTypeOf<
      readonly KecLexicalHit[]
    >();
  });

  it("reuses the existing request, hit, and runtime-result types", () => {
    const dependencies: ExistingLexicalSearchAdapterDependencies =
      existingLexicalAdapterDependencies();
    const request: KecSearchRequest = { query: "KEC cable", limit: 3 };
    const hit: KecLexicalHit = {
      chunkId: "persisted-lexical-chunk-1",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      clause: "KEC 232.5",
      text: "Cable sizing requirement.",
      lexicalScore: 0.91,
    };
    const runtimeResult: KecLexicalSearchResult = {
      ...hit,
      documentId: "kec:knowledge/kec.pdf",
      locator: { kind: "page", page: hit.page },
      metadata: { clause: hit.clause },
    };

    expectTypeOf(
      dependencies,
    ).toEqualTypeOf<LexicalAdapterDependenciesFixture>();
    expectTypeOf(request).toEqualTypeOf<KecSearchRequest>();
    expectTypeOf(hit).toEqualTypeOf<KecLexicalHit>();
    expectTypeOf(runtimeResult).toEqualTypeOf<KecLexicalSearchResult>();
  });

  it("rejects incompatible callback and result assumptions at compile time", () => {
    const compileContracts = (): void => {
      const dependencies: ExistingLexicalSearchAdapterDependencies =
        existingLexicalAdapterDependencies();

      // @ts-expect-error dependency properties are readonly
      dependencies.searchLexically = async () => [];

      const wrongCallback: ExistingLexicalSearchAdapterDependencies = {
        // @ts-expect-error callback limit must remain a number
        searchLexically: async (query: string, limit: string) => {
          void query;
          void limit;
          return [];
        },
      };

      // @ts-expect-error persisted chunkId is required
      const missingChunkId: KecLexicalSearchResult = {
        documentId: "kec:document",
        sourcePath: "knowledge/kec.pdf",
        locator: { kind: "page", page: 1 },
        metadata: { clause: null },
        text: "text",
        lexicalScore: 0.5,
      };

      const wrongScore: KecLexicalHit = {
        chunkId: "chunk",
        sourcePath: "knowledge/kec.pdf",
        page: 1,
        clause: null,
        text: "text",
        // @ts-expect-error lexicalScore must remain numeric
        lexicalScore: "0.5",
      };

      expectTypeOf(wrongCallback).toMatchTypeOf<unknown>();
      expectTypeOf(missingChunkId).toMatchTypeOf<unknown>();
      expectTypeOf(wrongScore).toMatchTypeOf<unknown>();
    };

    expect(compileContracts).toBeTypeOf("function");
  });

  it("keeps search results readonly at the public boundary", () => {
    const assertReadonly = (hits: readonly KecLexicalHit[]): void => {
      // @ts-expect-error public result arrays are readonly
      hits.push({} as KecLexicalHit);
      // @ts-expect-error public hits expose readonly fields
      hits[0]!.lexicalScore = 0;
    };

    expect(assertReadonly).toBeTypeOf("function");
  });
});
