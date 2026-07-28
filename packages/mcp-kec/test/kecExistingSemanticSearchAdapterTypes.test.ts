import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ExistingSemanticSearchAdapterDependencies,
  createExistingSemanticSearcher,
} from "../src/searchAdapters/index.js";
import type {
  KecSearchRequest,
  KecSemanticHit,
  KecSemanticSearcher,
} from "../src/searchFoundation/index.js";
import type { KecSemanticSearchCoreDependencies } from "../src/searchSemantic/semanticSearchCore.js";
import {
  existingSemanticCoreDependencies,
  type PersistedKecSemanticResult,
} from "./helpers/kecExistingSemanticSearchAdapterFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const adapterIndex = join(packageRoot, "src", "searchAdapters", "index.ts");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedDependencies =
  KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>;

type ExpectedFactory = (
  dependencies: ExistingSemanticSearchAdapterDependencies,
) => KecSemanticSearcher;

describe("existing semantic search adapter public type contracts", () => {
  it("compiles the approved public and negative type contracts", () => {
    expect(existsSync(adapterIndex)).toBe(true);

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

  it("reuses the Task 49A generic persisted-result dependency type", () => {
    expectTypeOf<ExistingSemanticSearchAdapterDependencies>().toEqualTypeOf<ExpectedDependencies>();
  });

  it("returns the existing Task 46 semantic searcher contract", () => {
    expectTypeOf<
      typeof createExistingSemanticSearcher
    >().toEqualTypeOf<ExpectedFactory>();
    expectTypeOf<KecSemanticSearcher["search"]>()
      .parameter(0)
      .toEqualTypeOf<KecSearchRequest>();
    expectTypeOf<
      KecSemanticSearcher["search"]
    >().returns.resolves.toEqualTypeOf<readonly KecSemanticHit[]>();
  });

  it("accepts structural explicit DI without a new request or hit DTO", () => {
    const dependencies: ExistingSemanticSearchAdapterDependencies =
      existingSemanticCoreDependencies();
    const request: KecSearchRequest = { query: "KEC cable", limit: 3 };
    const expectedHit: KecSemanticHit = {
      chunkId: "persisted-chunk-1",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      clause: "KEC 232.5",
      text: "Cable sizing requirement.",
      semanticScore: 0.91,
    };

    expectTypeOf(dependencies).toEqualTypeOf<ExpectedDependencies>();
    expectTypeOf(request).toEqualTypeOf<KecSearchRequest>();
    expectTypeOf(expectedHit).toEqualTypeOf<KecSemanticHit>();
  });

  it("keeps the adapter dependency object readonly at compile time", () => {
    const mutate = (
      dependencies: ExistingSemanticSearchAdapterDependencies,
    ): void => {
      // @ts-expect-error adapter dependencies are readonly
      dependencies.search = async () => [];
      // @ts-expect-error adapter dependencies are readonly
      dependencies.getIndexMetadata = async () => null;
    };

    expect(mutate).toBeTypeOf("function");
  });
});
