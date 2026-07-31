import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  KecHybridRuntimeConfig as ActualConfig,
  KecHybridRuntimeEnvironment as ActualEnvironment,
} from "../src/runtime/hybridRuntimeConfig.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const runtimeConfigPath = join(
  packageRoot,
  "src",
  "runtime",
  "hybridRuntimeConfig.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type WeightEnvironmentName =
  "KEC_HYBRID_SEMANTIC_WEIGHT" | "KEC_HYBRID_LEXICAL_WEIGHT";

type ExpectedEnvironment = Readonly<
  Partial<Record<WeightEnvironmentName, string | undefined>>
>;

type ExpectedConfig = Readonly<{
  rankingOptions: Readonly<{
    semanticWeight: number;
    lexicalWeight: number;
  }>;
}>;

type ExpectedReader = (environment: ExpectedEnvironment) => ExpectedConfig;
type RuntimeModule = typeof import("../src/runtime/hybridRuntimeConfig.js");
type ActualReader = RuntimeModule["readKecHybridRuntimeConfig"];

type EqualTypes<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;

describe("explicit KEC hybrid runtime type contracts", () => {
  it("reserves the approved runtime configuration module", () => {
    expect(existsSync(runtimeConfigPath)).toBe(true);
  });

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

  it("uses the exact explicit environment and immutable result types", () => {
    const exactEnvironment: EqualTypes<ActualEnvironment, ExpectedEnvironment> =
      true;
    const exactConfig: EqualTypes<ActualConfig, ExpectedConfig> = true;
    const exactReader: EqualTypes<ActualReader, ExpectedReader> = true;
    const exactParameters: EqualTypes<
      Parameters<ActualReader>,
      [environment: ExpectedEnvironment]
    > = true;
    const exactReturn: EqualTypes<
      ReturnType<ActualReader>,
      ExpectedConfig
    > = true;

    expect(exactEnvironment).toBe(true);
    expect(exactConfig).toBe(true);
    expect(exactReader).toBe(true);
    expect(exactParameters).toBe(true);
    expect(exactReturn).toBe(true);
  });

  it("keeps both ranking weights required, numeric, and readonly", () => {
    const compileOnly = (
      read: ExpectedReader,
      config: ExpectedConfig,
    ): KecWeightedRankingOptions => {
      const parsed = read({
        KEC_HYBRID_SEMANTIC_WEIGHT: "0.7",
        KEC_HYBRID_LEXICAL_WEIGHT: "0.3",
      });
      const options: KecWeightedRankingOptions = parsed.rankingOptions;

      // @ts-expect-error an explicit environment object is required
      read();
      read({
        KEC_HYBRID_SEMANTIC_WEIGHT: "1",
        KEC_HYBRID_LEXICAL_WEIGHT: "1",
        // @ts-expect-error unsupported environment names are not typed inputs
        KEC_HYBRID_WEIGHT: "1",
      });
      const missingSemantic: ExpectedConfig = {
        // @ts-expect-error semanticWeight is required
        rankingOptions: { lexicalWeight: 1 },
      };
      const missingLexical: ExpectedConfig = {
        // @ts-expect-error lexicalWeight is required
        rankingOptions: { semanticWeight: 1 },
      };
      // @ts-expect-error ranking weights are readonly
      config.rankingOptions.semanticWeight = 2;
      // @ts-expect-error ranking fields are numbers
      config.rankingOptions.lexicalWeight = "1";

      void missingSemantic;
      void missingLexical;
      return options;
    };

    expect(compileOnly).toBeTypeOf("function");
  });

  it("keeps runtime configuration and the future hybrid main off package root", () => {
    type PackageRoot = typeof import("../src/index.js");
    type ForbiddenRootExports = {
      // @ts-expect-error runtime configuration remains namespace-internal
      readonly config: PackageRoot["readKecHybridRuntimeConfig"];
      // @ts-expect-error the explicit hybrid entrypoint remains separate
      readonly hybridMain: PackageRoot["createKecHybridServerFromEnv"];
    };

    expectTypeOf<ForbiddenRootExports>().toBeObject();
  });
});
