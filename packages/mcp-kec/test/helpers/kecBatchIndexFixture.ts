import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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
export const task59PackageScriptName = "index:directory";
export const task59PackageScriptValue = "tsx src/indexKecDirectory.ts";
export const task59ReadmeStart = "<!-- TASK59_KEC_DIRECTORY_BATCH_START -->";
export const task59ReadmeEnd = "<!-- TASK59_KEC_DIRECTORY_BATCH_END -->";
export const task60PackageScriptName = "prune:directory";
export const task60PackageScriptValue = "tsx src/pruneKecDirectory.ts";
export const task60ReadmeStart = "<!-- TASK60_KEC_DIRECTORY_PRUNE_START -->";
export const task60ReadmeEnd = "<!-- TASK60_KEC_DIRECTORY_PRUNE_END -->";
const task57ReadmeEnd = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_END -->";

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
  if (
    readme.includes(task58ReadmeStart) ||
    readme.includes(task58ReadmeEnd) ||
    section.includes(task58ReadmeStart) ||
    section.includes(task58ReadmeEnd)
  ) {
    throw new Error("Task 58 README markers are not allowed in the baseline");
  }
  if (readme.split(task57ReadmeEnd).length !== 2) {
    throw new Error("Task 57 README anchor must occur exactly once");
  }

  const insertion = readme.indexOf(task57ReadmeEnd) + task57ReadmeEnd.length;
  return `${readme.slice(0, insertion)}\n\n${task58ReadmeStart}\n${section}\n${task58ReadmeEnd}${readme.slice(insertion)}`;
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

export function normalizeTask58PackageBaseline(
  committedPackageText: string,
): string {
  const occurrences = committedPackageText.match(/"index:batch"\s*:/gu) ?? [];
  if (occurrences.length !== 1) {
    throw new Error("Task 58 package script key must occur exactly once");
  }

  const manifest = JSON.parse(committedPackageText) as {
    scripts?: Record<string, unknown>;
  };
  if (
    manifest.scripts === undefined ||
    manifest.scripts[task58PackageScriptName] !== task58PackageScriptValue
  ) {
    throw new Error("Task 58 package script is malformed");
  }

  const baseline = removeTask58PackageScript(committedPackageText);
  const baselineManifest = JSON.parse(baseline) as {
    scripts?: Record<string, unknown>;
  };
  if (
    baselineManifest.scripts !== undefined &&
    Object.hasOwn(baselineManifest.scripts, task58PackageScriptName)
  ) {
    throw new Error("Task 58 package script normalization failed");
  }
  return baseline;
}

export function normalizeTask58ReadmeBaseline(committedReadme: string): string {
  if (committedReadme.split(task57ReadmeEnd).length !== 2) {
    throw new Error("Task 57 README anchor must occur exactly once");
  }
  const expectedStart =
    committedReadme.indexOf(task57ReadmeEnd) + task57ReadmeEnd.length + 2;
  if (committedReadme.indexOf(task58ReadmeStart) !== expectedStart) {
    throw new Error("Task 58 README section must immediately follow Task 57");
  }
  return removeTask58ReadmeSection(committedReadme);
}

export function addTask59PackageScript(packageText: string): string {
  const anchor = `    "${task58PackageScriptName}": "${task58PackageScriptValue}",\n`;
  if (
    packageText.split(anchor).length !== 2 ||
    (packageText.match(/"index:directory"\s*:/gu) ?? []).length !== 0
  ) {
    throw new Error("Task 59 package script baseline is malformed");
  }
  return packageText.replace(
    anchor,
    `${anchor}    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`,
  );
}

export function removeTask59PackageScript(packageText: string): string {
  const occurrences = packageText.match(/"index:directory"\s*:/gu) ?? [];
  const line = `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`;
  if (occurrences.length !== 1 || packageText.split(line).length !== 2) {
    throw new Error("Task 59 package script must occur exactly once");
  }
  return packageText.replace(line, "");
}

export function normalizeTask59PackageBaseline(packageText: string): string {
  const occurrences = packageText.match(/"index:directory"\s*:/gu) ?? [];
  if (occurrences.length === 0) return packageText;
  if (occurrences.length !== 1) {
    throw new Error("Task 59 package script key must occur at most once");
  }
  return removeTask59PackageScript(packageText);
}

export function addTask60PackageScript(packageText: string): string {
  const anchor = `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`;
  if (
    packageText.split(anchor).length !== 2 ||
    (packageText.match(/"prune:directory"\s*:/gu) ?? []).length !== 0
  ) {
    throw new Error("Task 60 package script baseline is malformed");
  }
  return packageText.replace(
    anchor,
    `${anchor}    "${task60PackageScriptName}": "${task60PackageScriptValue}",\n`,
  );
}

export function removeTask60PackageScript(packageText: string): string {
  const occurrences = packageText.match(/"prune:directory"\s*:/gu) ?? [];
  const line = `    "${task60PackageScriptName}": "${task60PackageScriptValue}",\n`;
  const orderedBlock = `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n${line}`;
  if (
    occurrences.length !== 1 ||
    packageText.split(line).length !== 2 ||
    packageText.split(orderedBlock).length !== 2
  ) {
    throw new Error("Task 60 package script must occur exactly once");
  }
  return packageText.replace(line, "");
}

function task59ReadmeBounds(readme: string): Readonly<{
  start: number;
  sectionEnd: number;
}> {
  if (
    readme.split(task59ReadmeStart).length !== 2 ||
    readme.split(task59ReadmeEnd).length !== 2 ||
    readme.split(task58ReadmeEnd).length !== 2
  ) {
    throw new Error("Task 59 README markers must occur exactly once");
  }

  const start = readme.indexOf(task59ReadmeStart);
  const end = readme.indexOf(task59ReadmeEnd, start);
  const expectedStart =
    readme.indexOf(task58ReadmeEnd) + task58ReadmeEnd.length + 2;
  if (start !== expectedStart || end <= start) {
    throw new Error("Task 59 README section is malformed or misplaced");
  }
  const sectionEnd = end + task59ReadmeEnd.length;
  if (readme[sectionEnd] !== "\n") {
    throw new Error("Task 59 README section must end with LF");
  }
  return Object.freeze({ start, sectionEnd });
}

export function task59ReadmeBlock(readme: string): string {
  const { start, sectionEnd } = task59ReadmeBounds(readme);
  return readme.slice(start, sectionEnd);
}

export function addTask59ReadmeBlock(readme: string, block: string): string {
  if (
    readme.split(task58ReadmeEnd).length !== 2 ||
    readme.includes(task59ReadmeStart) ||
    readme.includes(task59ReadmeEnd) ||
    !block.startsWith(task59ReadmeStart) ||
    !block.endsWith(task59ReadmeEnd) ||
    block.split(task59ReadmeStart).length !== 2 ||
    block.split(task59ReadmeEnd).length !== 2
  ) {
    throw new Error("Task 59 README block or baseline is malformed");
  }
  const insertion = readme.indexOf(task58ReadmeEnd) + task58ReadmeEnd.length;
  return `${readme.slice(0, insertion)}\n\n${block}${readme.slice(insertion)}`;
}

export function removeTask59ReadmeSection(readme: string): string {
  const { start, sectionEnd } = task59ReadmeBounds(readme);
  return `${readme.slice(0, start - 1)}${readme.slice(sectionEnd + 1)}`;
}

export function normalizeTask59ReadmeBaseline(readme: string): string {
  const starts = readme.split(task59ReadmeStart).length - 1;
  const ends = readme.split(task59ReadmeEnd).length - 1;
  if (starts === 0 && ends === 0) return readme;
  if (starts !== 1 || ends !== 1) {
    throw new Error("Task 59 README markers are malformed");
  }
  return removeTask59ReadmeSection(readme);
}

function task60ReadmeBounds(readme: string): Readonly<{
  start: number;
  sectionEnd: number;
}> {
  if (
    readme.split(task60ReadmeStart).length !== 2 ||
    readme.split(task60ReadmeEnd).length !== 2 ||
    readme.split(task59ReadmeEnd).length !== 2
  ) {
    throw new Error("Task 60 README markers must occur exactly once");
  }

  const start = readme.indexOf(task60ReadmeStart);
  const end = readme.indexOf(task60ReadmeEnd, start);
  const expectedStart =
    readme.indexOf(task59ReadmeEnd) + task59ReadmeEnd.length + 2;
  if (start !== expectedStart || end <= start) {
    throw new Error("Task 60 README section is malformed or misplaced");
  }
  const sectionEnd = end + task60ReadmeEnd.length;
  if (readme[sectionEnd] !== "\n") {
    throw new Error("Task 60 README section must end with LF");
  }
  return Object.freeze({ start, sectionEnd });
}

export function task60ReadmeBlock(readme: string): string {
  const { start, sectionEnd } = task60ReadmeBounds(readme);
  return readme.slice(start, sectionEnd);
}

export function addTask60ReadmeBlock(readme: string, block: string): string {
  if (
    readme.split(task59ReadmeEnd).length !== 2 ||
    readme.includes(task60ReadmeStart) ||
    readme.includes(task60ReadmeEnd) ||
    !block.startsWith(task60ReadmeStart) ||
    !block.endsWith(task60ReadmeEnd) ||
    block.split(task60ReadmeStart).length !== 2 ||
    block.split(task60ReadmeEnd).length !== 2
  ) {
    throw new Error("Task 60 README block or baseline is malformed");
  }
  const insertion = readme.indexOf(task59ReadmeEnd) + task59ReadmeEnd.length;
  return `${readme.slice(0, insertion)}\n\n${block}${readme.slice(insertion)}`;
}

export function removeTask60ReadmeSection(readme: string): string {
  const { start, sectionEnd } = task60ReadmeBounds(readme);
  return `${readme.slice(0, start - 1)}${readme.slice(sectionEnd + 1)}`;
}

export type Task60PackageLayers = Readonly<{
  preTask60: string;
  preTask59: string;
  preTask58: string;
}>;

export function task60PackageLayers(
  currentPackageText: string,
): Task60PackageLayers {
  const preTask60 = removeTask60PackageScript(currentPackageText);
  const preTask59 = removeTask59PackageScript(preTask60);
  const preTask58 = removeTask58PackageScript(preTask59);

  if (
    addTask58PackageScript(preTask58) !== preTask59 ||
    addTask59PackageScript(preTask59) !== preTask60 ||
    addTask60PackageScript(preTask60) !== currentPackageText
  ) {
    throw new Error("Task 58-60 package layering is not byte-reversible");
  }

  return Object.freeze({ preTask60, preTask59, preTask58 });
}

export type Task60ReadmeLayers = Readonly<{
  preTask60: string;
  preTask59: string;
  preTask58: string;
}>;

export function task60ReadmeLayers(currentReadme: string): Task60ReadmeLayers {
  const task60Block = task60ReadmeBlock(currentReadme);
  const preTask60 = removeTask60ReadmeSection(currentReadme);
  const task59Block = task59ReadmeBlock(preTask60);
  const preTask59 = removeTask59ReadmeSection(preTask60);
  const task58Start = preTask59.indexOf(task58ReadmeStart);
  const task58End = preTask59.indexOf(task58ReadmeEnd, task58Start);
  if (task58Start < 0 || task58End <= task58Start) {
    throw new Error("Task 58 README section is malformed");
  }
  const task58Content = preTask59.slice(
    task58Start + task58ReadmeStart.length + 1,
    task58End - 1,
  );
  const preTask58 = removeTask58ReadmeSection(preTask59);

  if (
    addTask58ReadmeSection(preTask58, task58Content) !== preTask59 ||
    addTask59ReadmeBlock(preTask59, task59Block) !== preTask60 ||
    addTask60ReadmeBlock(preTask60, task60Block) !== currentReadme
  ) {
    throw new Error("Task 58-60 README layering is not byte-reversible");
  }

  return Object.freeze({ preTask60, preTask59, preTask58 });
}

const task60SqlitePreludeSha256 =
  "ce4765af20833ab3e2816fa90e912838060285f82ea1cc95bb29098ae40a27a8";
const task60SqliteMethodsSha256 =
  "a941f6e9d957bfbc9a94ff6729a5b0defbe092b65b0a8d106f312f03e511cd10";
const preTask60SqliteStoreSha256 =
  "820384df711fa796acd3db88cd607231136cc173380cfffe316f1f74face6ff3";

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactlyOnePosition(source: string, marker: string): number {
  const position = source.indexOf(marker);
  if (position < 0 || source.indexOf(marker, position + marker.length) >= 0) {
    throw new Error("Task 60 SQLite compatibility marker is not unique");
  }
  return position;
}

export function normalizeTask60SqliteKnowledgeStore(source: string): string {
  const preludeStart = exactlyOnePosition(source, "function asciiOrder(");
  const classStart = exactlyOnePosition(
    source,
    "export class SqliteKnowledgeStore",
  );
  const methodsStart = exactlyOnePosition(source, "  async listSourcePaths(");
  const searchStart = exactlyOnePosition(source, "  async search<");
  if (!(
    preludeStart < classStart &&
    classStart < methodsStart &&
    methodsStart < searchStart
  )) {
    throw new Error("Task 60 SQLite compatibility blocks are misplaced");
  }

  const prelude = source.slice(preludeStart, classStart);
  const methods = source.slice(methodsStart, searchStart);
  if (
    sha256Text(prelude) !== task60SqlitePreludeSha256 ||
    sha256Text(methods) !== task60SqliteMethodsSha256
  ) {
    throw new Error("Task 60 SQLite compatibility blocks changed");
  }

  const normalized = `${source.slice(0, preludeStart)}${source.slice(
    classStart,
    methodsStart,
  )}${source.slice(searchStart)}`;
  if (sha256Text(normalized) !== preTask60SqliteStoreSha256) {
    throw new Error("Pre-Task 60 SQLite store boundary changed");
  }

  const reconstructed = `${normalized.slice(0, preludeStart)}${prelude}${normalized.slice(
    preludeStart,
    methodsStart - prelude.length,
  )}${methods}${normalized.slice(methodsStart - prelude.length)}`;
  if (reconstructed !== source) {
    throw new Error("Task 60 SQLite layering is not byte-reversible");
  }

  return normalized;
}

export function captureTask58ArtifactBoundary(rootPath: string): string {
  const entries: string[] = [];

  const visit = (absolutePath: string, relativePath: string): void => {
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      entries.push(`link:${relativePath}:${readlinkSync(absolutePath)}`);
      return;
    }
    if (stats.isDirectory()) {
      entries.push(`directory:${relativePath}:${stats.mode}:${stats.mtimeMs}`);
      for (const child of readdirSync(absolutePath).sort()) {
        visit(join(absolutePath, child), `${relativePath}/${child}`);
      }
      return;
    }
    if (stats.isFile()) {
      const digest = createHash("sha256")
        .update(readFileSync(absolutePath))
        .digest("hex");
      entries.push(
        `file:${relativePath}:${stats.mode}:${stats.size}:${stats.mtimeMs}:${digest}`,
      );
      return;
    }
    entries.push(
      `other:${relativePath}:${stats.mode}:${stats.size}:${stats.mtimeMs}`,
    );
  };

  for (const name of [".voltai", ".volt-ai"] as const) {
    const boundaryPath = join(rootPath, name);
    if (existsSync(boundaryPath)) visit(boundaryPath, name);
    else entries.push(`missing:${name}`);
  }

  return JSON.stringify(entries);
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
