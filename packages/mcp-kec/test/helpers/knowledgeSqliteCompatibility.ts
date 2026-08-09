import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export const canonicalTask61SqliteSha256 =
  "820384df711fa796acd3db88cd607231136cc173380cfffe316f1f74face6ff3";

export const task61KnowledgeSqliteRoot = "packages/knowledge-sqlite";
export const task61SqliteStorePath = "src/sqliteKnowledgeStore.ts";
export const obsoleteTask60SourceStoreTestPath =
  "test/sqliteKnowledgeSourceStore.test.ts";

const approvedPreludeSha256 =
  "ce4765af20833ab3e2816fa90e912838060285f82ea1cc95bb29098ae40a27a8";
const approvedMethodsSha256 =
  "a941f6e9d957bfbc9a94ff6729a5b0defbe092b65b0a8d106f312f03e511cd10";

const preludeStartMarker = "function asciiOrder(";
const classStartMarker = "export class SqliteKnowledgeStore";
const methodsStartMarker = "  async listSourcePaths(";
const searchStartMarker = "  async search<";
const lifecycleSignals = [
  "asciiOrder",
  "canonicalSourcePaths",
  "equalSourceSnapshots",
  "async listSourcePaths",
  "async pruneSourcePaths",
  "Knowledge source snapshot contains duplicate paths",
  "Knowledge prune source is outside the expected snapshot",
  "BEGIN IMMEDIATE",
] as const;

export type Task61SqliteState = "TASK60" | "TASK61";

export type CompatibilitySnapshotEntry = Readonly<{
  kind: "file" | "symlink";
  bytes: Buffer;
}>;

export type CompatibilitySnapshot = ReadonlyMap<
  string,
  CompatibilitySnapshotEntry
>;

export type GitCompatibilityReader = (arguments_: readonly string[]) => Buffer;

type LifecycleBounds = Readonly<{
  preludeStart: number;
  classStart: number;
  methodsStart: number;
  searchStart: number;
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniquePosition(source: string, marker: string): number {
  const position = source.indexOf(marker);
  if (position < 0 || source.indexOf(marker, position + marker.length) >= 0) {
    throw new Error(
      `Task 61 SQLite marker is missing or duplicated: ${marker}`,
    );
  }
  return position;
}

function task60LifecycleBounds(source: string): LifecycleBounds {
  const bounds = Object.freeze({
    preludeStart: uniquePosition(source, preludeStartMarker),
    classStart: uniquePosition(source, classStartMarker),
    methodsStart: uniquePosition(source, methodsStartMarker),
    searchStart: uniquePosition(source, searchStartMarker),
  });
  if (!(
    bounds.preludeStart < bounds.classStart &&
    bounds.classStart < bounds.methodsStart &&
    bounds.methodsStart < bounds.searchStart
  )) {
    throw new Error("Task 61 SQLite lifecycle regions are misordered");
  }
  return bounds;
}

function normalizedTask60Source(
  source: string,
  bounds: LifecycleBounds,
): string {
  return `${source.slice(0, bounds.preludeStart)}${source.slice(
    bounds.classStart,
    bounds.methodsStart,
  )}${source.slice(bounds.searchStart)}`;
}

export function classifyTask61SqliteState(source: string): Task61SqliteState {
  const hasLifecycleSignal = lifecycleSignals.some((signal) =>
    source.includes(signal),
  );
  if (!hasLifecycleSignal) {
    if (sha256(source) !== canonicalTask61SqliteSha256) {
      throw new Error("Task 61 SQLite State-B boundary is not canonical");
    }
    return "TASK61";
  }

  const bounds = task60LifecycleBounds(source);
  const prelude = source.slice(bounds.preludeStart, bounds.classStart);
  const methods = source.slice(bounds.methodsStart, bounds.searchStart);
  if (
    sha256(prelude) !== approvedPreludeSha256 ||
    sha256(methods) !== approvedMethodsSha256
  ) {
    throw new Error("Task 61 SQLite approved lifecycle regions changed");
  }

  const normalized = normalizedTask60Source(source, bounds);
  if (sha256(normalized) !== canonicalTask61SqliteSha256) {
    throw new Error("Task 61 SQLite removal boundary changed");
  }
  return "TASK60";
}

export function normalizeTask61SqliteKnowledgeStore(source: string): string {
  const state = classifyTask61SqliteState(source);
  if (state === "TASK61") return source;
  return normalizedTask60Source(source, task60LifecycleBounds(source));
}

function snapshotEntry(
  kind: CompatibilitySnapshotEntry["kind"],
  bytes: Buffer,
): CompatibilitySnapshotEntry {
  return Object.freeze({ kind, bytes: Buffer.from(bytes) });
}

function assertSnapshotSentinels(snapshot: CompatibilitySnapshot): void {
  if (snapshot.size === 0) {
    throw new Error("Task 61 knowledge-sqlite snapshot is empty");
  }
  for (const sentinel of ["package.json", task61SqliteStorePath]) {
    if (!snapshot.has(sentinel)) {
      throw new Error(
        `Task 61 knowledge-sqlite snapshot lacks sentinel: ${sentinel}`,
      );
    }
  }
}

function storeText(snapshot: CompatibilitySnapshot): string {
  const entry = snapshot.get(task61SqliteStorePath);
  if (entry === undefined || entry.kind !== "file") {
    throw new Error("Task 61 SQLite store must be a regular file");
  }
  return entry.bytes.toString("utf8");
}

export function canonicalizeTask61KnowledgeSqliteSnapshot(
  baseline: CompatibilitySnapshot,
): CompatibilitySnapshot {
  assertSnapshotSentinels(baseline);
  const state = classifyTask61SqliteState(storeText(baseline));
  const hasObsoleteTest = baseline.has(obsoleteTask60SourceStoreTestPath);
  if (state === "TASK60" && !hasObsoleteTest) {
    throw new Error("Task 60 baseline lacks its source-store test");
  }
  if (state === "TASK61" && hasObsoleteTest) {
    throw new Error("Task 61 baseline retains the obsolete source-store test");
  }

  const canonical = new Map<string, CompatibilitySnapshotEntry>();
  for (const [path, entry] of baseline) {
    if (path === obsoleteTask60SourceStoreTestPath) continue;
    if (path === task61SqliteStorePath) {
      canonical.set(
        path,
        snapshotEntry(
          "file",
          Buffer.from(
            normalizeTask61SqliteKnowledgeStore(entry.bytes.toString("utf8")),
            "utf8",
          ),
        ),
      );
      continue;
    }
    canonical.set(path, snapshotEntry(entry.kind, entry.bytes));
  }
  assertSnapshotSentinels(canonical);
  return canonical;
}

function defaultGitReader(workspaceRoot: string): GitCompatibilityReader {
  return (arguments_) =>
    execFileSync("git", [...arguments_], {
      cwd: workspaceRoot,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
}

function relativeKnowledgeSqlitePath(fullPath: string): string {
  const prefix = `${task61KnowledgeSqliteRoot}/`;
  if (!fullPath.startsWith(prefix) || fullPath.length === prefix.length) {
    throw new Error(`Unexpected knowledge-sqlite path: ${fullPath}`);
  }
  return fullPath.slice(prefix.length);
}

function addSnapshotEntry(
  snapshot: Map<string, CompatibilitySnapshotEntry>,
  path: string,
  entry: CompatibilitySnapshotEntry,
): void {
  if (snapshot.has(path)) {
    throw new Error(`Duplicate knowledge-sqlite snapshot path: ${path}`);
  }
  snapshot.set(path, entry);
}

export function readCompatibilityBaseline(
  workspaceRoot: string,
  revision = "HEAD",
  readGit: GitCompatibilityReader = defaultGitReader(workspaceRoot),
): CompatibilitySnapshot {
  const tree = readGit([
    "ls-tree",
    "-rz",
    "--full-tree",
    revision,
    "--",
    task61KnowledgeSqliteRoot,
  ]).toString("utf8");
  const snapshot = new Map<string, CompatibilitySnapshotEntry>();
  for (const record of tree.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("Malformed Git tree record");
    const [mode, type, objectId] = record.slice(0, tab).split(" ");
    if (type !== "blob" || objectId === undefined) {
      throw new Error(`Unsupported Git tree entry: ${record.slice(0, tab)}`);
    }
    const path = relativeKnowledgeSqlitePath(record.slice(tab + 1));
    const bytes = readGit(["cat-file", "blob", objectId]);
    const kind = mode === "120000" ? "symlink" : "file";
    addSnapshotEntry(snapshot, path, snapshotEntry(kind, bytes));
  }
  assertSnapshotSentinels(snapshot);
  return snapshot;
}

export function readCompatibilityWorkingTree(
  workspaceRoot: string,
  readGit: GitCompatibilityReader = defaultGitReader(workspaceRoot),
): CompatibilitySnapshot {
  const candidates = readGit([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    task61KnowledgeSqliteRoot,
  ])
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
  if (candidates.length === 0) {
    throw new Error("Task 61 knowledge-sqlite enumerator returned no paths");
  }

  const snapshot = new Map<string, CompatibilitySnapshotEntry>();
  for (const fullPath of candidates) {
    const path = relativeKnowledgeSqlitePath(fullPath);
    const absolutePath = join(workspaceRoot, fullPath);
    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "ENOENT") continue;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      addSnapshotEntry(
        snapshot,
        path,
        snapshotEntry(
          "symlink",
          readlinkSync(absolutePath, { encoding: "buffer" }),
        ),
      );
    } else if (stats.isFile()) {
      addSnapshotEntry(
        snapshot,
        path,
        snapshotEntry("file", readFileSync(absolutePath)),
      );
    } else {
      throw new Error(`Unsupported working-tree entry: ${fullPath}`);
    }
  }
  assertSnapshotSentinels(snapshot);
  return snapshot;
}

function asciiOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertTask61KnowledgeSqliteCompatibility(
  baseline: CompatibilitySnapshot,
  workingTree: CompatibilitySnapshot,
): void {
  assertSnapshotSentinels(workingTree);
  if (classifyTask61SqliteState(storeText(workingTree)) !== "TASK61") {
    throw new Error("Raw working-tree SQLite store is not Task 61 State-B");
  }

  const canonicalBaseline = canonicalizeTask61KnowledgeSqliteSnapshot(baseline);
  const baselinePaths = [...canonicalBaseline.keys()].sort(asciiOrder);
  const workingPaths = [...workingTree.keys()].sort(asciiOrder);
  if (JSON.stringify(baselinePaths) !== JSON.stringify(workingPaths)) {
    throw new Error("Task 61 knowledge-sqlite path set changed");
  }
  for (const path of baselinePaths) {
    const expected = canonicalBaseline.get(path);
    const actual = workingTree.get(path);
    if (
      expected === undefined ||
      actual === undefined ||
      expected.kind !== actual.kind ||
      !expected.bytes.equals(actual.bytes)
    ) {
      throw new Error(`Task 61 knowledge-sqlite bytes changed: ${path}`);
    }
  }

  if (sha256(storeText(workingTree)) !== canonicalTask61SqliteSha256) {
    throw new Error("Task 61 SQLite canonical SHA changed");
  }
}
