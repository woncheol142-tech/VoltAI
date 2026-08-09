import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  directoryBarrelPath,
  directoryCliPath,
  directoryDiscoveryPath,
  directoryTypesPath,
  packageRoot,
  workspaceRoot,
} from "./helpers/kecBatchDirectoryFixture.js";

const packageIndexPath = join(packageRoot, "src", "index.ts");
const batchCliPath = join(packageRoot, "src", "indexKecBatch.ts");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);
const approvedExports = Object.freeze([
  "KecBatchDirectoryDiscovery",
  "KecBatchDirectoryDiscoveryDependencies",
  "KecBatchDirectoryRequest",
  "discoverKecBatchDirectory",
]);

function allModulesExist(): boolean {
  return [
    directoryTypesPath,
    directoryDiscoveryPath,
    directoryBarrelPath,
  ].every(existsSync);
}

function moduleSpecifier(fromDirectory: string, targetPath: string): string {
  const path = relative(fromDirectory, targetPath)
    .replaceAll("\\", "/")
    .replace(/\.ts$/u, ".js");
  return path.startsWith(".") ? path : `./${path}`;
}

function compileTypeContract(): void {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "voltai-task59-types-"));
  const contractPath = join(temporaryRoot, "contract.ts");
  const barrel = moduleSpecifier(temporaryRoot, directoryBarrelPath);
  const cli = moduleSpecifier(temporaryRoot, directoryCliPath);
  const batch = moduleSpecifier(
    temporaryRoot,
    join(packageRoot, "src", "batchIndexing", "index.ts"),
  );
  const contract = `
import type {
  KecBatchDirectoryDiscovery,
  KecBatchDirectoryDiscoveryDependencies,
  KecBatchDirectoryRequest,
} from ${JSON.stringify(barrel)};
import { discoverKecBatchDirectory } from ${JSON.stringify(barrel)};
import type { KecBatchDirectoryCliDependencies } from ${JSON.stringify(cli)};
import { runKecBatchDirectoryCli } from ${JSON.stringify(cli)};
import type {
  KecBatchIndexConfig,
  KecBatchIndexExecutionDependencies,
  KecBatchIndexResultV1,
  PreparedKecBatchIndex,
} from ${JSON.stringify(batch)};

type Equal<L, R> =
  (<T>() => T extends L ? 1 : 2) extends (<T>() => T extends R ? 1 : 2)
    ? (<T>() => T extends R ? 1 : 2) extends (<T>() => T extends L ? 1 : 2)
      ? true
      : false
    : false;
type Assert<T extends true> = T;
type ExpectedRequest = Readonly<{ directory: string }>;
type ExpectedDiscovery = Readonly<{ sources: readonly string[] }>;
type ExpectedDependencies = Readonly<{
  lstat: (path: string) => Readonly<{
    kind: "directory" | "file" | "symlink" | "other";
    identity?: Readonly<{ device: bigint; inode: bigint }>;
  }>;
  realpath: (path: string) => string;
  readDirectory: (path: string) => readonly string[];
}>;
type ExpectedDiscover = (
  projectRoot: string,
  request: unknown,
  dependencies?: KecBatchDirectoryDiscoveryDependencies,
) => KecBatchDirectoryDiscovery;
type ExpectedCliDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  discover: (
    projectRoot: string,
    request: unknown,
  ) => KecBatchDirectoryDiscovery;
  prepareBatch: (
    config: KecBatchIndexConfig,
    request: unknown,
  ) => PreparedKecBatchIndex;
  executeBatch: (
    prepared: PreparedKecBatchIndex,
    dependencies: KecBatchIndexExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serializeBatch: (result: KecBatchIndexResultV1) => string;
  createExecutionDependencies: (
    prepared: PreparedKecBatchIndex,
  ) => KecBatchIndexExecutionDependencies;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;
type ExpectedRunner = (
  argv: readonly string[],
  environment: unknown,
  dependencies: KecBatchDirectoryCliDependencies,
) => Promise<number>;

type _Request = Assert<Equal<KecBatchDirectoryRequest, ExpectedRequest>>;
type _RequestKeys = Assert<Equal<keyof KecBatchDirectoryRequest, "directory">>;
type _Discovery = Assert<Equal<KecBatchDirectoryDiscovery, ExpectedDiscovery>>;
type _DiscoveryKeys = Assert<Equal<keyof KecBatchDirectoryDiscovery, "sources">>;
type _Dependencies = Assert<
  Equal<KecBatchDirectoryDiscoveryDependencies, ExpectedDependencies>
>;
type _Discover = Assert<Equal<typeof discoverKecBatchDirectory, ExpectedDiscover>>;
type _CliDependencies = Assert<
  Equal<KecBatchDirectoryCliDependencies, ExpectedCliDependencies>
>;
type _Runner = Assert<Equal<typeof runKecBatchDirectoryCli, ExpectedRunner>>;

declare const request: KecBatchDirectoryRequest;
declare const discovery: KecBatchDirectoryDiscovery;
declare const dependencies: KecBatchDirectoryDiscoveryDependencies;
declare const cliDependencies: KecBatchDirectoryCliDependencies;
// @ts-expect-error request is readonly
request.directory = "other";
// @ts-expect-error discovery is readonly
discovery.sources = [];
// @ts-expect-error discovery sources are readonly
discovery.sources.push("manuals/other.pdf");
// @ts-expect-error dependencies are readonly and expose no deletion authority
dependencies.remove = (path: string) => path;
// @ts-expect-error CLI dependencies are readonly
cliDependencies.discover = () => ({ sources: [] });
// @ts-expect-error exactly three parameters at most
discoverKecBatchDirectory("/project", request, dependencies, "extra");
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

describe("Task 59 directory batch package-local type contracts", () => {
  it("is RED until the approved directory modules exist", () => {
    expect(existsSync(directoryTypesPath)).toBe(true);
    expect(existsSync(directoryDiscoveryPath)).toBe(true);
    expect(existsSync(directoryBarrelPath)).toBe(true);
  });

  it("compiles exact readonly request, discovery, dependency, and function shapes", () => {
    if (!allModulesExist()) return;
    expect(() => compileTypeContract()).not.toThrow();
  });

  it("keeps Task 59 out of the package root and MCP registration", () => {
    const packageIndex = readFileSync(packageIndexPath, "utf8");
    expect(packageIndex).not.toMatch(
      /KecBatchDirectory|discoverKecBatchDirectory|runKecBatchDirectory/iu,
    );
    expect(packageIndex).not.toMatch(/index:directory/iu);

    if (!existsSync(directoryBarrelPath)) return;
    const barrel = readFileSync(directoryBarrelPath, "utf8");
    expect(barrel).not.toMatch(
      /VoltAiTool|modelcontextprotocol|runStdioServer|registerTool|zod/iu,
    );
  });

  it("exports exactly the approved package-local barrel members", () => {
    if (!existsSync(directoryBarrelPath)) return;
    const source = ts.createSourceFile(
      directoryBarrelPath,
      readFileSync(directoryBarrelPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declarations = source.statements.filter(ts.isExportDeclaration);
    expect(
      declarations.every(
        (declaration) =>
          declaration.exportClause !== undefined &&
          ts.isNamedExports(declaration.exportClause),
      ),
    ).toBe(true);
    const names = declarations.flatMap((declaration) =>
      declaration.exportClause !== undefined &&
      ts.isNamedExports(declaration.exportClause)
        ? declaration.exportClause.elements.map((element) => element.name.text)
        : [],
    );
    expect([...names].sort()).toEqual([...approvedExports].sort());
  });

  it("requires both CLI entry points to consume one Task-58-owned runtime binding", () => {
    const parse = (filePath: string): ts.SourceFile =>
      ts.createSourceFile(
        filePath,
        readFileSync(filePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
    type RuntimeImport = Readonly<{
      key: string;
      localName: string;
    }>;
    const importedRuntimeBindings = (
      filePath: string,
    ): readonly RuntimeImport[] =>
      parse(filePath).statements.flatMap((statement) => {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          !statement.moduleSpecifier.text.startsWith("./batchIndexing/") ||
          statement.importClause?.namedBindings === undefined ||
          !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          return [];
        }
        return statement.importClause.namedBindings.elements
          .filter(
            (element) =>
              !element.isTypeOnly &&
              /^create.*(?:Runtime|ExecutionDependencies)$/u.test(
                element.propertyName?.text ?? element.name.text,
              ),
          )
          .map((element) =>
            Object.freeze({
              key: `${statement.moduleSpecifier.text}:${element.propertyName?.text ?? element.name.text}`,
              localName: element.name.text,
            }),
          );
      });
    const identifierUseCount = (filePath: string, name: string): number => {
      let count = 0;
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === name) count += 1;
        ts.forEachChild(node, visit);
      };
      visit(parse(filePath));
      return count;
    };
    const ownsRuntimeLifecycle = (filePath: string): boolean => {
      const lifecycleMembers = new Set([
        "createProvider",
        "createStore",
        "closeStore",
        "closeProvider",
      ]);
      let found = false;
      const visit = (node: ts.Node): void => {
        if (
          (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
          ts.isIdentifier(node.name) &&
          lifecycleMembers.has(node.name.text)
        ) {
          found = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(filePath));
      return found;
    };
    const batchBindings = importedRuntimeBindings(batchCliPath);
    const directoryBindings = importedRuntimeBindings(directoryCliPath);
    const sharedBindings = batchBindings.filter((binding) =>
      directoryBindings.some((candidate) => candidate.key === binding.key),
    );
    const sharedBatchBinding = sharedBindings[0];
    const sharedDirectoryBinding = directoryBindings.find(
      (binding) => binding.key === sharedBatchBinding?.key,
    );

    expect({
      sharedBindingCount: sharedBindings.length,
      batchConsumesBinding:
        sharedBatchBinding !== undefined &&
        identifierUseCount(batchCliPath, sharedBatchBinding.localName) > 1,
      directoryConsumesBinding:
        sharedDirectoryBinding !== undefined &&
        identifierUseCount(directoryCliPath, sharedDirectoryBinding.localName) >
          1,
      batchOwnsRuntimeLifecycle: ownsRuntimeLifecycle(batchCliPath),
      directoryOwnsRuntimeLifecycle: ownsRuntimeLifecycle(directoryCliPath),
    }).toEqual({
      sharedBindingCount: 1,
      batchConsumesBinding: true,
      directoryConsumesBinding: true,
      batchOwnsRuntimeLifecycle: false,
      directoryOwnsRuntimeLifecycle: false,
    });
  });
});
