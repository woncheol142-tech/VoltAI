import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const pruneErrors = Object.freeze({
  invalidArgument: "KEC_DIRECTORY_PRUNE: INVALID_ARGUMENT",
  invalidConfiguration: "KEC_DIRECTORY_PRUNE: INVALID_CONFIGURATION",
  invalidDirectory: "KEC_DIRECTORY_PRUNE: INVALID_DIRECTORY",
  invalidSource: "KEC_DIRECTORY_PRUNE: INVALID_SOURCE",
  noSources: "KEC_DIRECTORY_PRUNE: NO_SOURCES",
  discoveryFailed: "KEC_DIRECTORY_PRUNE: DISCOVERY_FAILED",
  databaseUnavailable: "KEC_DIRECTORY_PRUNE: DATABASE_UNAVAILABLE",
  enumerationFailed: "KEC_DIRECTORY_PRUNE: ENUMERATION_FAILED",
  invalidIndexState: "KEC_DIRECTORY_PRUNE: INVALID_INDEX_STATE",
  indexChanged: "KEC_DIRECTORY_PRUNE: INDEX_CHANGED",
  pruneFailed: "KEC_DIRECTORY_PRUNE: PRUNE_FAILED",
  finalizationFailed: "KEC_DIRECTORY_PRUNE: FINALIZATION_FAILED",
  internalError: "KEC_DIRECTORY_PRUNE: INTERNAL_ERROR",
});

export const approvedPruneErrors = Object.freeze(Object.values(pruneErrors));
export const task60PackageScriptName = "prune:directory";
export const task60PackageScriptValue = "tsx src/pruneKecDirectory.ts";
export const task60ReadmeStart = "<!-- TASK60_KEC_DIRECTORY_PRUNE_START -->";
export const task60ReadmeEnd = "<!-- TASK60_KEC_DIRECTORY_PRUNE_END -->";

const fixturePdfBytes = "%PDF-1.4\n% Task 60 metadata-only fixture\n%%EOF\n";
const testFile = fileURLToPath(import.meta.url);
export const packageRoot = join(dirname(testFile), "..", "..");
export const workspaceRoot = join(packageRoot, "..", "..");
export const pruneRoot = join(packageRoot, "src", "directoryPruning");
export const pruneBarrelPath = join(pruneRoot, "index.ts");
export const pruneCliPath = join(packageRoot, "src", "pruneKecDirectory.ts");

export type KecDirectoryPruneDiscovery = Readonly<{
  directoryPath: string;
  sources: readonly string[];
}>;

export type KecDirectoryPrunePlan = Readonly<{
  directoryPath: string;
  desiredSourcePaths: readonly string[];
  expectedSourcePaths: readonly string[];
  staleSources: readonly Readonly<{ sourcePath: string; sourceId: string }>[];
  desiredSourceCount: number;
  indexedSourceCount: number;
}>;

export type KecDirectoryPruneResult = Readonly<{
  schemaVersion: 1;
  status: "SUCCEEDED";
  desiredSourceCount: number;
  indexedSourceCount: number;
  deletedSourceCount: number;
  sources: readonly Readonly<{
    sourceId: string;
    status: "DELETED";
  }>[];
}>;

export type DirectoryPruningModule = Readonly<{
  discoverKecDirectoryPruneScope: (
    projectRoot: string,
    request: unknown,
    dependencies?: unknown,
  ) => KecDirectoryPruneDiscovery;
  prepareKecDirectoryPrune: (
    discovery: KecDirectoryPruneDiscovery,
    indexedSourcePaths: readonly string[],
  ) => KecDirectoryPrunePlan;
  executeKecDirectoryPrune: (
    plan: KecDirectoryPrunePlan,
    dependencies: Readonly<{
      pruneSources: (
        expectedSourcePaths: readonly string[],
        staleSourcePaths: readonly string[],
      ) => Promise<void>;
    }>,
  ) => Promise<KecDirectoryPruneResult>;
  serializeKecDirectoryPruneResult: (result: KecDirectoryPruneResult) => string;
}>;

export type KecDirectoryPruneFixture = Readonly<{
  fixtureRoot: string;
  projectRoot: string;
  outsideRoot: string;
  directoryRelativePath: string;
  directoryAbsolutePath: string;
  databasePath: string;
  writeProjectFile: (relativePath: string, content?: string) => string;
  writeOutsideFile: (relativePath: string, content?: string) => string;
  createProjectDirectory: (relativePath: string) => string;
  tryCreateDirectorySymlink: (
    targetPath: string,
    relativeLinkPath: string,
  ) => Readonly<{ supported: boolean; linkPath: string }>;
  tryCreateFileSymlink: (
    targetPath: string,
    relativeLinkPath: string,
  ) => Readonly<{ supported: boolean; linkPath: string }>;
  cleanup: () => void;
}>;

function writeFileAt(
  root: string,
  relativePath: string,
  content: string,
): string {
  const absolutePath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
  return absolutePath;
}

function tryCreateSymlink(
  targetPath: string,
  linkPath: string,
  kind: "dir" | "file",
): Readonly<{ supported: boolean; linkPath: string }> {
  mkdirSync(dirname(linkPath), { recursive: true });
  try {
    symlinkSync(targetPath, linkPath, kind);
    return Object.freeze({ supported: true, linkPath });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null
        ? Object.getOwnPropertyDescriptor(error, "code")?.value
        : undefined;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      return Object.freeze({ supported: false, linkPath });
    }
    throw error;
  }
}

export function createKecDirectoryPruneFixture(): KecDirectoryPruneFixture {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "voltai-kec-prune-"));
  const projectRoot = join(fixtureRoot, "project");
  const outsideRoot = join(fixtureRoot, "outside");
  const directoryRelativePath = "manuals";
  const directoryAbsolutePath = join(projectRoot, directoryRelativePath);
  const databasePath = join(projectRoot, ".voltai", "kec.sqlite");
  mkdirSync(directoryAbsolutePath, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  let cleaned = false;

  return Object.freeze({
    fixtureRoot,
    projectRoot,
    outsideRoot,
    directoryRelativePath,
    directoryAbsolutePath,
    databasePath,
    writeProjectFile: (relativePath, content = fixturePdfBytes) =>
      writeFileAt(projectRoot, relativePath, content),
    writeOutsideFile: (relativePath, content = fixturePdfBytes) =>
      writeFileAt(outsideRoot, relativePath, content),
    createProjectDirectory: (relativePath) => {
      const absolutePath = join(projectRoot, ...relativePath.split("/"));
      mkdirSync(absolutePath, { recursive: true });
      return absolutePath;
    },
    tryCreateDirectorySymlink: (targetPath, relativeLinkPath) =>
      tryCreateSymlink(
        targetPath,
        join(projectRoot, ...relativeLinkPath.split("/")),
        "dir",
      ),
    tryCreateFileSymlink: (targetPath, relativeLinkPath) =>
      tryCreateSymlink(
        targetPath,
        join(projectRoot, ...relativeLinkPath.split("/")),
        "file",
      ),
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      const resolvedRoot = resolve(fixtureRoot);
      const expectedParent = `${resolve(tmpdir())}${sep}`;
      if (
        !resolvedRoot.startsWith(expectedParent) ||
        !basename(resolvedRoot).startsWith("voltai-kec-prune-")
      ) {
        throw new Error("Refusing to clean a non-owned Task 60 fixture root");
      }
      rmSync(resolvedRoot, { recursive: true, force: true });
    },
  });
}

export async function withPruneFixture(
  operation: (fixture: KecDirectoryPruneFixture) => Promise<void> | void,
): Promise<void> {
  const fixture = createKecDirectoryPruneFixture();
  try {
    await operation(fixture);
  } finally {
    fixture.cleanup();
  }
}

export function pruneEnvironment(
  projectRoot: string,
  databasePath: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    PROJECT_ROOT: projectRoot,
    KEC_DB_PATH: databasePath,
    ...overrides,
  });
}

export function expectedPruneSourceId(sourcePath: string): string {
  return `kecsrc_${createHash("sha256").update(sourcePath, "utf8").digest("hex")}`;
}

export function sourceIdOrder(
  sourcePaths: readonly string[],
): readonly string[] {
  return sourcePaths
    .map(expectedPruneSourceId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function captureErrorMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error("Expected operation to fail");
}

export async function captureAsyncErrorMessage(
  operation: () => Promise<unknown>,
): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error("Expected operation to fail");
}

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "NON_ERROR_FAILURE";
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : "NON_ERROR_FAILURE";
  } catch {
    return "NON_ERROR_FAILURE";
  }
}

export function createPlan(
  overrides: Partial<KecDirectoryPrunePlan> = {},
): KecDirectoryPrunePlan {
  const stalePath = "manuals/stale.pdf";
  return Object.freeze({
    directoryPath: "manuals",
    desiredSourcePaths: Object.freeze(["manuals/active.pdf"]),
    expectedSourcePaths: Object.freeze([
      "manuals/active.pdf",
      stalePath,
      "other/retained.pdf",
    ]),
    staleSources: Object.freeze([
      Object.freeze({
        sourcePath: stalePath,
        sourceId: expectedPruneSourceId(stalePath),
      }),
    ]),
    desiredSourceCount: 1,
    indexedSourceCount: 2,
    ...overrides,
  });
}

export function task60ModulesExist(): boolean {
  return existsSync(pruneBarrelPath);
}

export async function loadDirectoryPruningModule(): Promise<DirectoryPruningModule> {
  return (await import(
    /* @vite-ignore */ pruneBarrelPath
  )) as DirectoryPruningModule;
}

export function captureFixtureBoundary(rootPath: string): string {
  const entries: string[] = [];
  const visit = (absolutePath: string, relativePath: string): void => {
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      entries.push(`link:${relativePath}:${readlinkSync(absolutePath)}`);
      return;
    }
    if (stats.isDirectory()) {
      entries.push(`directory:${relativePath}`);
      for (const child of readdirSync(absolutePath).sort()) {
        visit(join(absolutePath, child), `${relativePath}/${child}`);
      }
      return;
    }
    if (stats.isFile()) {
      entries.push(
        `file:${relativePath}:${createHash("sha256")
          .update(readFileSync(absolutePath))
          .digest("hex")}`,
      );
      return;
    }
    entries.push(`other:${relativePath}`);
  };
  if (existsSync(rootPath)) visit(rootPath, ".");
  return JSON.stringify(entries);
}
