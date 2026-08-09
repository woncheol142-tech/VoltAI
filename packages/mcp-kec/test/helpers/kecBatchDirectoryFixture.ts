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

export const directoryErrors = Object.freeze({
  invalidArgument: "KEC_BATCH_DIRECTORY: INVALID_ARGUMENT",
  invalidConfiguration: "KEC_BATCH_DIRECTORY: INVALID_CONFIGURATION",
  invalidDirectory: "KEC_BATCH_DIRECTORY: INVALID_DIRECTORY",
  invalidSource: "KEC_BATCH_DIRECTORY: INVALID_SOURCE",
  noSources: "KEC_BATCH_DIRECTORY: NO_SOURCES",
  discoveryFailed: "KEC_BATCH_DIRECTORY: DISCOVERY_FAILED",
  internalError: "KEC_BATCH_DIRECTORY: INTERNAL_ERROR",
});

export const approvedDirectoryErrors = Object.freeze(
  Object.values(directoryErrors),
);

export const task59PackageScriptName = "index:directory";
export const task59PackageScriptValue = "tsx src/indexKecDirectory.ts";
export const task59ReadmeStart = "<!-- TASK59_KEC_DIRECTORY_BATCH_START -->";
export const task59ReadmeEnd = "<!-- TASK59_KEC_DIRECTORY_BATCH_END -->";
export const task58ReadmeEnd = "<!-- TASK58_KEC_BATCH_INDEX_END -->";

const fixturePdfBytes = "%PDF-1.4\n% Task 59 metadata-only fixture\n%%EOF\n";
const testFile = fileURLToPath(import.meta.url);
export const packageRoot = join(dirname(testFile), "..", "..");
export const workspaceRoot = join(packageRoot, "..", "..");
export const directoryRoot = join(packageRoot, "src", "directoryBatchIndexing");
export const directoryTypesPath = join(directoryRoot, "types.ts");
export const directoryDiscoveryPath = join(
  directoryRoot,
  "discoverKecBatchDirectory.ts",
);
export const directoryBarrelPath = join(directoryRoot, "index.ts");
export const directoryCliPath = join(
  packageRoot,
  "src",
  "indexKecDirectory.ts",
);

export type KecBatchDirectoryFixture = Readonly<{
  fixtureRoot: string;
  projectRoot: string;
  outsideRoot: string;
  directoryRelativePath: string;
  directoryAbsolutePath: string;
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

export function createKecBatchDirectoryFixture(): KecBatchDirectoryFixture {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "voltai-kec-directory-"));
  const projectRoot = join(fixtureRoot, "project");
  const outsideRoot = join(fixtureRoot, "outside");
  const directoryRelativePath = "manuals";
  const directoryAbsolutePath = join(projectRoot, directoryRelativePath);
  mkdirSync(directoryAbsolutePath, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  let cleaned = false;

  const fixture: KecBatchDirectoryFixture = Object.freeze({
    fixtureRoot,
    projectRoot,
    outsideRoot,
    directoryRelativePath,
    directoryAbsolutePath,
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
      const expectedParent = `${resolve(tmpdir())}${sep}`;
      const resolvedRoot = resolve(fixtureRoot);
      if (
        !resolvedRoot.startsWith(expectedParent) ||
        !basename(resolvedRoot).startsWith("voltai-kec-directory-")
      ) {
        throw new Error("Refusing to clean a non-owned Task 59 fixture root");
      }
      rmSync(resolvedRoot, { recursive: true, force: true });
    },
  });
  return fixture;
}

export async function withDirectoryFixture(
  operation: (fixture: KecBatchDirectoryFixture) => Promise<void> | void,
): Promise<void> {
  const fixture = createKecBatchDirectoryFixture();
  try {
    await operation(fixture);
  } finally {
    fixture.cleanup();
  }
}

export function directoryEnvironment(
  projectRoot: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    PROJECT_ROOT: projectRoot,
    KEC_EMBED_PROVIDER: "placeholder",
    ...overrides,
  });
}

export function captureErrorMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    const descriptor =
      typeof error === "object" && error !== null
        ? Object.getOwnPropertyDescriptor(error, "message")
        : undefined;
    if (
      descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
    ) {
      return descriptor.value;
    }
    return "NON_ERROR_FAILURE";
  }
  throw new Error("Expected operation to fail");
}

export function createHostileValue(counter: { count: number }): object {
  return Object.freeze({
    toString: () => {
      counter.count += 1;
      throw new Error("hostile toString sentinel");
    },
    valueOf: () => {
      counter.count += 1;
      throw new Error("hostile valueOf sentinel");
    },
    [Symbol.toPrimitive]: () => {
      counter.count += 1;
      throw new Error("hostile Symbol.toPrimitive sentinel");
    },
  });
}

export function expectedSourceId(sourcePath: string): string {
  return `kecsrc_${createHash("sha256").update(sourcePath, "utf8").digest("hex")}`;
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

export function assertNoTask59Artifacts(rootPath: string): void {
  const forbidden =
    /(?:\.sqlite|\.sqlite3|\.db|-(?:wal|shm|journal)|\.tsbuildinfo|coverage|\.log|\.pid|\.tmp)$/u;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (forbidden.test(entry.name)) {
        throw new Error("Unexpected Task 59 fixture artifact");
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        visit(join(directory, entry.name));
      }
    }
  };
  if (existsSync(rootPath)) visit(rootPath);
}

export function moduleExists(): boolean {
  return [
    directoryTypesPath,
    directoryDiscoveryPath,
    directoryBarrelPath,
  ].every(existsSync);
}

export type DirectoryDiscoveryModule = Readonly<{
  discoverKecBatchDirectory: (
    projectRoot: string,
    request: unknown,
    dependencies?: unknown,
  ) => Readonly<{ sources: readonly string[] }>;
}>;

export async function loadDirectoryDiscoveryModule(): Promise<DirectoryDiscoveryModule> {
  const loaded = (await import(
    /* @vite-ignore */ directoryDiscoveryPath
  )) as Record<string, unknown>;
  return Object.freeze({
    discoverKecBatchDirectory:
      loaded.discoverKecBatchDirectory as DirectoryDiscoveryModule["discoverKecBatchDirectory"],
  });
}
