import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const batchIndexErrors = Object.freeze({
  invalidConfiguration: "KEC_BATCH_INDEX: INVALID_CONFIGURATION",
  invalidArgument: "KEC_BATCH_INDEX: INVALID_ARGUMENT",
  duplicateSource: "KEC_BATCH_INDEX: DUPLICATE_SOURCE",
  sourceNotFound: "KEC_BATCH_INDEX: SOURCE_NOT_FOUND",
  sourceNotRegularFile: "KEC_BATCH_INDEX: SOURCE_NOT_REGULAR_FILE",
  unsupportedSource: "KEC_BATCH_INDEX: UNSUPPORTED_SOURCE",
  unsafeSource: "KEC_BATCH_INDEX: UNSAFE_SOURCE",
  databaseUnavailable: "KEC_BATCH_INDEX: DATABASE_UNAVAILABLE",
  finalizationFailed: "KEC_BATCH_INDEX: FINALIZATION_FAILED",
  internalError: "KEC_BATCH_INDEX: INTERNAL_ERROR",
});

export const task58PackageScriptName = "index:batch";
export const task58PackageScriptValue = "tsx src/indexKecBatch.ts";
export const task58ReadmeStart = "<!-- TASK58_KEC_BATCH_INDEX_START -->";
export const task58ReadmeEnd = "<!-- TASK58_KEC_BATCH_INDEX_END -->";

export const defaultBatchExecutionOptions = Object.freeze({
  concurrency: 4,
  maxAttempts: 3,
  retryDelayMs: 100,
});

export const firstCanonicalSource = "knowledge/kec-a.pdf";
export const secondCanonicalSource = "knowledge/nested/kec-b.pdf";
export const sameBytesSource = "knowledge/kec-a-copy.pdf";
export const unicodeCanonicalSource = "knowledge/한국전기설비규정.pdf";

const fixturePdfBytes = "%PDF-1.4\n% Task 58 preflight fixture only\n%%EOF\n";

export type KecBatchIndexFixture = Readonly<{
  fixtureRoot: string;
  projectRoot: string;
  outsideRoot: string;
  databasePath: string;
  firstAbsoluteSource: string;
  secondAbsoluteSource: string;
  outsideAbsoluteSource: string;
  writeProjectFile: (relativePath: string, content?: string) => string;
  writeOutsideFile: (fileName: string, content?: string) => string;
  createProjectDirectory: (relativePath: string) => string;
  tryCreateSymlink: (
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

export function createKecBatchIndexFixture(): KecBatchIndexFixture {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "voltai-kec-batch-index-"));
  const projectRoot = join(fixtureRoot, "project");
  const outsideRoot = join(fixtureRoot, "outside");
  const databasePath = join(projectRoot, ".voltai", "kec.sqlite");
  mkdirSync(projectRoot);
  mkdirSync(outsideRoot);

  const writeProjectFile = (
    relativePath: string,
    content = fixturePdfBytes,
  ): string => writeFileAt(projectRoot, relativePath, content);
  const writeOutsideFile = (
    fileName: string,
    content = fixturePdfBytes,
  ): string => writeFileAt(outsideRoot, fileName, content);
  const firstAbsoluteSource = writeProjectFile(firstCanonicalSource);
  const secondAbsoluteSource = writeProjectFile(secondCanonicalSource);
  writeProjectFile(sameBytesSource);
  writeProjectFile(unicodeCanonicalSource);
  const outsideAbsoluteSource = writeOutsideFile("outside.pdf");
  let cleaned = false;

  return Object.freeze({
    fixtureRoot,
    projectRoot,
    outsideRoot,
    databasePath,
    firstAbsoluteSource,
    secondAbsoluteSource,
    outsideAbsoluteSource,
    writeProjectFile,
    writeOutsideFile,
    createProjectDirectory: (relativePath: string): string => {
      const absolutePath = join(projectRoot, ...relativePath.split("/"));
      mkdirSync(absolutePath, { recursive: true });
      return absolutePath;
    },
    tryCreateSymlink: (
      targetPath: string,
      relativeLinkPath: string,
    ): Readonly<{ supported: boolean; linkPath: string }> => {
      const linkPath = join(projectRoot, ...relativeLinkPath.split("/"));
      mkdirSync(dirname(linkPath), { recursive: true });

      try {
        symlinkSync(targetPath, linkPath, "file");
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
    },
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      rmSync(fixtureRoot, { recursive: true, force: true });
    },
  });
}

export function batchEnvironment(
  projectRoot: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    PROJECT_ROOT: projectRoot,
    KEC_EMBED_PROVIDER: "placeholder",
    ...overrides,
  };
}

export function batchRequest(
  sources: readonly unknown[],
): Readonly<{ sources: readonly unknown[] }> {
  return { sources: [...sources] };
}

export function nullPrototypeBatchRequest(
  sources: readonly unknown[],
): Readonly<Record<string, unknown>> {
  const request = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(request, "sources", {
    enumerable: true,
    value: [...sources],
  });
  return request;
}

export function expectedBatchSourceId(sourcePath: string): string {
  return `kecsrc_${createHash("sha256").update(sourcePath, "utf8").digest("hex")}`;
}

export function expectedSourceIdOrder(
  sourcePaths: readonly string[],
): readonly string[] {
  return sourcePaths
    .map(expectedBatchSourceId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function createHostileCoercionValue(counter: {
  count: number;
}): Readonly<Record<PropertyKey, unknown>> {
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

export function createHostileThrownValue(): Readonly<{
  thrown: Readonly<Record<PropertyKey, unknown>>;
  calls: () => number;
}> {
  const counter = { count: 0 };
  const hostile = createHostileCoercionValue(counter);
  const thrown = Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(hostile)) {
    Object.defineProperty(
      thrown,
      key,
      Object.getOwnPropertyDescriptor(hostile, key)!,
    );
  }
  Object.defineProperty(thrown, "message", {
    get: () => {
      counter.count += 1;
      throw new Error("hostile message getter sentinel");
    },
  });

  return Object.freeze({
    thrown: Object.freeze(thrown),
    calls: () => counter.count,
  });
}

export function addTask58PackageScript(packageText: string): string {
  const anchor = '    "test": "vitest run --root ../.. packages/mcp-kec/test"';
  if (!packageText.includes(anchor)) {
    throw new Error("Task 58 package script anchor is missing");
  }
  return packageText.replace(
    anchor,
    `    "${task58PackageScriptName}": "${task58PackageScriptValue}",\n${anchor}`,
  );
}

export function removeTask58PackageScript(packageText: string): string {
  const line = `    "${task58PackageScriptName}": "${task58PackageScriptValue}",\n`;
  if (packageText.split(line).length !== 2) {
    throw new Error("Task 58 package script must occur exactly once");
  }
  return packageText.replace(line, "");
}

export function addTask58ReadmeSection(
  readme: string,
  section: string,
): string {
  if (!readme.endsWith("\n")) {
    throw new Error("README baseline must end with LF");
  }
  return `${readme}\n${task58ReadmeStart}\n${section}\n${task58ReadmeEnd}\n`;
}

export function removeTask58ReadmeSection(readme: string): string {
  if (
    readme.split(task58ReadmeStart).length !== 2 ||
    readme.split(task58ReadmeEnd).length !== 2
  ) {
    throw new Error("Task 58 README markers must occur exactly once");
  }

  const start = readme.indexOf(task58ReadmeStart);
  const end = readme.indexOf(task58ReadmeEnd, start);
  if (
    start < 1 ||
    end <= start ||
    readme.slice(start, end).includes(task58ReadmeEnd)
  ) {
    throw new Error("Task 58 README markers are malformed");
  }
  const sectionEnd = end + task58ReadmeEnd.length;
  if (readme[sectionEnd] !== "\n") {
    throw new Error("Task 58 README section must end with LF");
  }

  const removalStart = readme[start - 1] === "\n" ? start - 1 : start;
  return `${readme.slice(0, removalStart)}${readme.slice(sectionEnd + 1)}`;
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

export function assertNoBatchArtifacts(rootPath: string): void {
  const forbidden =
    /(?:\.sqlite|\.db|-(?:wal|shm|journal)|coverage|\.log|\.pid|\.tmp)$/u;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (forbidden.test(entry.name)) {
        throw new Error("Unexpected Task 58 fixture artifact");
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(absolutePath);
    }
  };

  if (existsSync(rootPath)) visit(rootPath);
}

export function isRegularFile(path: string): boolean {
  return lstatSync(path).isFile();
}
