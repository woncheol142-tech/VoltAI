import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const batchRoot = join(packageRoot, "src", "batchIndexing");
const typesPath = join(batchRoot, "types.ts");
const configPath = join(batchRoot, "readKecBatchIndexConfig.ts");
const preflightPath = join(batchRoot, "prepareKecBatchIndex.ts");
const executionPath = join(batchRoot, "executeKecBatchIndex.ts");
const serializerPath = join(batchRoot, "serializeKecBatchIndexResult.ts");
const barrelPath = join(batchRoot, "index.ts");
const packageRootIndex = join(packageRoot, "src", "index.ts");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);
const approvedProductionPaths = Object.freeze([
  typesPath,
  configPath,
  preflightPath,
  barrelPath,
]);
const approvedBarrelExports = Object.freeze([
  "KecBatchFailureCode",
  "KecBatchIndexExecutionDependencies",
  "KecBatchIndexConfig",
  "KecBatchIndexRequest",
  "KecBatchIndexResultV1",
  "KecBatchIndexStatus",
  "KecBatchSourceResult",
  "KecBatchSourceStatus",
  "PreparedKecBatchIndex",
  "PreparedKecBatchSource",
  "executeKecBatchIndex",
  "prepareKecBatchIndex",
  "readKecBatchIndexConfig",
  "serializeKecBatchIndexResult",
]);

function approvedProductionExists(): boolean {
  return approvedProductionPaths.every((path) => existsSync(path));
}

function toModuleSpecifier(fromDirectory: string, targetPath: string): string {
  const relativePath = relative(fromDirectory, targetPath)
    .replaceAll("\\", "/")
    .replace(/\.ts$/u, ".js");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function compileTypeContract(): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "voltai-kec-batch-types-"));
  const contractPath = join(temporaryRoot, "contract.ts");
  const moduleSpecifier = toModuleSpecifier(temporaryRoot, barrelPath);
  const contract = `
import type {
  KecBatchFailureCode,
  KecBatchIndexExecutionDependencies,
  KecBatchIndexConfig,
  KecBatchIndexRequest,
  KecBatchIndexResultV1,
  KecBatchIndexStatus,
  KecBatchSourceResult,
  KecBatchSourceStatus,
  PreparedKecBatchIndex,
  PreparedKecBatchSource,
} from ${JSON.stringify(moduleSpecifier)};
import {
  executeKecBatchIndex,
  prepareKecBatchIndex,
  readKecBatchIndexConfig,
  serializeKecBatchIndexResult,
} from ${JSON.stringify(moduleSpecifier)};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Value extends true> = Value;
type HasStringIndex<Value> = string extends keyof Value ? true : false;

type ExpectedRequest = Readonly<{ sources: readonly string[] }>;
type ExpectedPreparedSource = Readonly<{
  sourcePath: string;
  sourceId: string;
}>;
type ExpectedConfig = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;
type ExpectedPlan = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  sources: readonly PreparedKecBatchSource[];
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;
type ExpectedSourceResult = Readonly<{
  sourceId: string;
  status: KecBatchSourceStatus;
  indexedChunkCount: number;
  failureCode: KecBatchFailureCode | null;
}>;
type ExpectedResult = Readonly<{
  schemaVersion: 1;
  status: KecBatchIndexStatus;
  requestedSourceCount: number;
  indexedSourceCount: number;
  failedSourceCount: number;
  notAttemptedSourceCount: number;
  indexedChunkCount: number;
  sources: readonly KecBatchSourceResult[];
}>;
type MaybePromise<Value> = Value | Promise<Value>;
type ExpectedExecutionDependencies = Readonly<{
  createProvider: (
    provider: KecBatchIndexConfig["provider"],
  ) => MaybePromise<unknown>;
  createStore: (databasePath: string) => MaybePromise<unknown>;
  indexSource: (
    projectRoot: string,
    input: Readonly<{
      relativePath: string;
      embeddingConcurrency: number;
      embeddingMaxAttempts: number;
      embeddingRetryDelayMs: number;
    }>,
    dependencies: Readonly<{
      embeddingProvider: unknown;
      vectorStore: unknown;
    }>,
  ) => Promise<Readonly<{ indexedChunks: number }>>;
  closeStore: (store: unknown) => MaybePromise<void>;
  closeProvider: (provider: unknown) => MaybePromise<void>;
}>;
type ExpectedReadConfig = (
  environment: unknown,
  cwd: string,
) => KecBatchIndexConfig;
type ExpectedPrepare = (
  config: KecBatchIndexConfig,
  request: unknown,
) => PreparedKecBatchIndex;
type ExpectedExecute = (
  prepared: PreparedKecBatchIndex,
  dependencies: KecBatchIndexExecutionDependencies,
) => Promise<KecBatchIndexResultV1>;
type ExpectedSerializer = (result: KecBatchIndexResultV1) => string;

type _RequestKeys = Assert<Equal<keyof KecBatchIndexRequest, "sources">>;
type _Request = Assert<Equal<KecBatchIndexRequest, ExpectedRequest>>;
type _SourceKeys = Assert<
  Equal<keyof PreparedKecBatchSource, "sourcePath" | "sourceId">
>;
type _Source = Assert<Equal<PreparedKecBatchSource, ExpectedPreparedSource>>;
type _ConfigKeys = Assert<
  Equal<
    keyof KecBatchIndexConfig,
    | "projectRoot"
    | "databasePath"
    | "provider"
    | "concurrency"
    | "maxAttempts"
    | "retryDelayMs"
  >
>;
type _Config = Assert<Equal<KecBatchIndexConfig, ExpectedConfig>>;
type _PlanKeys = Assert<
  Equal<
    keyof PreparedKecBatchIndex,
    | "projectRoot"
    | "databasePath"
    | "provider"
    | "sources"
    | "concurrency"
    | "maxAttempts"
    | "retryDelayMs"
  >
>;
type _Plan = Assert<Equal<PreparedKecBatchIndex, ExpectedPlan>>;
type _NoRequestIndex = Assert<Equal<HasStringIndex<KecBatchIndexRequest>, false>>;
type _NoPlanIndex = Assert<Equal<HasStringIndex<PreparedKecBatchIndex>, false>>;
type _BatchStatus = Assert<
  Equal<KecBatchIndexStatus, "SUCCEEDED" | "PARTIAL" | "FAILED">
>;
type _SourceStatus = Assert<
  Equal<KecBatchSourceStatus, "INDEXED" | "FAILED" | "NOT_ATTEMPTED">
>;
type _FailureCode = Assert<
  Equal<KecBatchFailureCode, "INDEXING_FAILED" | "NOT_ATTEMPTED">
>;
type _Provider = Assert<
  Equal<KecBatchIndexConfig["provider"], "placeholder" | "ollama">
>;
type _Schema = Assert<Equal<KecBatchIndexResultV1["schemaVersion"], 1>>;
type _SourceResultKeys = Assert<
  Equal<
    keyof KecBatchSourceResult,
    "sourceId" | "status" | "indexedChunkCount" | "failureCode"
  >
>;
type _SourceResult = Assert<Equal<KecBatchSourceResult, ExpectedSourceResult>>;
type _ResultKeys = Assert<
  Equal<
    keyof KecBatchIndexResultV1,
    | "schemaVersion"
    | "status"
    | "requestedSourceCount"
    | "indexedSourceCount"
    | "failedSourceCount"
    | "notAttemptedSourceCount"
    | "indexedChunkCount"
    | "sources"
  >
>;
type _Result = Assert<Equal<KecBatchIndexResultV1, ExpectedResult>>;
type _ExecutionDependencies = Assert<
  Equal<KecBatchIndexExecutionDependencies, ExpectedExecutionDependencies>
>;
type _NoSourceResultIndex = Assert<
  Equal<HasStringIndex<KecBatchSourceResult>, false>
>;
type _NoResultIndex = Assert<
  Equal<HasStringIndex<KecBatchIndexResultV1>, false>
>;
type _ReadConfig = Assert<Equal<typeof readKecBatchIndexConfig, ExpectedReadConfig>>;
type _Prepare = Assert<Equal<typeof prepareKecBatchIndex, ExpectedPrepare>>;
type _Execute = Assert<Equal<typeof executeKecBatchIndex, ExpectedExecute>>;
type _Serializer = Assert<
  Equal<typeof serializeKecBatchIndexResult, ExpectedSerializer>
>;

declare const request: KecBatchIndexRequest;
declare const plan: PreparedKecBatchIndex;
declare const result: KecBatchIndexResultV1;
declare const executionDependencies: KecBatchIndexExecutionDependencies;
// @ts-expect-error request sources are readonly
request.sources = [];
// @ts-expect-error request source array is readonly
request.sources.push("knowledge/other.pdf");
// @ts-expect-error prepared plan is readonly
plan.provider = "ollama";
// @ts-expect-error prepared source is readonly
plan.sources[0].sourcePath = "knowledge/other.pdf";
// @ts-expect-error result is readonly
result.status = "FAILED";
// @ts-expect-error result sources are readonly
result.sources.push(result.sources[0]);
// @ts-expect-error execution dependencies are readonly
executionDependencies.createStore = async () => ({});
`;

  try {
    writeFileSync(contractPath, contract, "utf8");
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
        contractPath,
      ],
      { cwd: workspaceRoot, stdio: "pipe" },
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

describe("Task 58 batch indexing type contracts", () => {
  it("is RED until the four approved pure preflight modules exist", () => {
    for (const path of approvedProductionPaths)
      expect(existsSync(path)).toBe(true);
  });

  it("compiles the approved public, readonly, and negative type contracts", () => {
    expect(approvedProductionExists()).toBe(true);
    if (!approvedProductionExists()) return;

    expect(() => compileTypeContract()).not.toThrow();
  });

  it("is RED until the approved execution and serializer modules exist", () => {
    expect(existsSync(executionPath)).toBe(true);
    expect(existsSync(serializerPath)).toBe(true);
  });

  it("keeps Task 58 internal and free of package-root or MCP DTO exports", () => {
    const packageIndex = readFileSync(packageRootIndex, "utf8");
    expect(packageIndex).not.toMatch(/batchIndex|KecBatch/iu);

    expect(existsSync(barrelPath)).toBe(true);
    if (!existsSync(barrelPath)) return;

    const barrel = readFileSync(barrelPath, "utf8");
    expect(barrel).not.toMatch(/VoltAiTool|zod|modelcontextprotocol|MCP/iu);
  });

  it("exports exactly the approved internal barrel members", () => {
    expect(existsSync(barrelPath)).toBe(true);
    if (!existsSync(barrelPath)) return;

    const source = ts.createSourceFile(
      barrelPath,
      readFileSync(barrelPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const exportDeclarations = source.statements.filter(ts.isExportDeclaration);
    expect(
      exportDeclarations.every(
        (declaration) =>
          declaration.exportClause !== undefined &&
          ts.isNamedExports(declaration.exportClause),
      ),
    ).toBe(true);
    const names = exportDeclarations.flatMap((declaration) =>
      declaration.exportClause !== undefined &&
      ts.isNamedExports(declaration.exportClause)
        ? declaration.exportClause.elements.map((element) => element.name.text)
        : [],
    );
    expect([...names].sort()).toEqual([...approvedBarrelExports].sort());
  });
});
