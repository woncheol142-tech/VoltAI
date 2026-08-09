import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertTask61KnowledgeSqliteCompatibility,
  canonicalizeTask61KnowledgeSqliteSnapshot,
  canonicalTask61SqliteSha256,
  classifyTask61SqliteState,
  normalizeTask61SqliteKnowledgeStore,
  obsoleteTask60SourceStoreTestPath,
  readCompatibilityBaseline,
  readCompatibilityWorkingTree,
  task61SqliteStorePath,
  type CompatibilitySnapshot,
  type CompatibilitySnapshotEntry,
} from "./helpers/knowledgeSqliteCompatibility.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const rawStorePath = join(
  workspaceRoot,
  "packages",
  "knowledge-sqlite",
  task61SqliteStorePath,
);

function headTask60Snapshot(): CompatibilitySnapshot {
  return readCompatibilityBaseline(workspaceRoot);
}

function snapshotStoreText(snapshot: CompatibilitySnapshot): string {
  const entry = snapshot.get(task61SqliteStorePath);
  if (entry === undefined || entry.kind !== "file") {
    throw new Error("Synthetic snapshot lacks its regular SQLite store");
  }
  return entry.bytes.toString("utf8");
}

function task60AndTask61Text(): Readonly<{
  task60: string;
  task61: string;
}> {
  const task60 = snapshotStoreText(headTask60Snapshot());
  return Object.freeze({
    task60,
    task61: normalizeTask61SqliteKnowledgeStore(task60),
  });
}

function lifecyclePositions(task60: string) {
  const preludeStart = task60.indexOf("function asciiOrder(");
  const classStart = task60.indexOf("export class SqliteKnowledgeStore");
  const methodsStart = task60.indexOf("  async listSourcePaths(");
  const pruneStart = task60.indexOf("  async pruneSourcePaths(");
  const searchStart = task60.indexOf("  async search<");
  const equalStart = task60.indexOf("function equalSourceSnapshots(");
  if (
    preludeStart < 0 ||
    classStart < 0 ||
    methodsStart < 0 ||
    pruneStart < 0 ||
    searchStart < 0 ||
    equalStart < 0
  ) {
    throw new Error("Task 60 synthetic fixture markers are missing");
  }
  return Object.freeze({
    preludeStart,
    classStart,
    methodsStart,
    pruneStart,
    searchStart,
    equalStart,
  });
}

function expectMalformed(source: string): void {
  expect(() => classifyTask61SqliteState(source)).toThrow();
  expect(() => normalizeTask61SqliteKnowledgeStore(source)).toThrow();
}

function changedEntry(bytes: string): CompatibilitySnapshotEntry {
  return Object.freeze({ kind: "file", bytes: Buffer.from(bytes, "utf8") });
}

describe("Task 61 SQLite compatibility green harness", () => {
  it("R6 classifies both legitimate states and normalizes only State-A", () => {
    const { task60, task61 } = task60AndTask61Text();
    expect(classifyTask61SqliteState(task60)).toBe("TASK60");
    expect(classifyTask61SqliteState(task61)).toBe("TASK61");
    expect(normalizeTask61SqliteKnowledgeStore(task60)).toBe(task61);
    expect(normalizeTask61SqliteKnowledgeStore(task61)).toBe(task61);
  });

  it("R6 rejects ten malformed lifecycle-region states loudly", () => {
    const { task60 } = task60AndTask61Text();
    const positions = lifecyclePositions(task60);
    const prelude = task60.slice(positions.preludeStart, positions.classStart);
    const methods = task60.slice(positions.methodsStart, positions.searchStart);
    const preludeOnly = `${task60.slice(0, positions.methodsStart)}${task60.slice(
      positions.searchStart,
    )}`;
    const methodsOnly = `${task60.slice(0, positions.preludeStart)}${task60.slice(
      positions.classStart,
    )}`;
    const oneHelperMissing = `${task60.slice(
      0,
      positions.equalStart,
    )}${task60.slice(positions.classStart)}`;
    const oneMethodMissing = `${task60.slice(
      0,
      positions.methodsStart,
    )}${task60.slice(positions.pruneStart)}`;
    const duplicateHelper = `${task60.slice(
      0,
      positions.classStart,
    )}${prelude}${task60.slice(positions.classStart)}`;
    const duplicateMethod = `${task60.slice(
      0,
      positions.searchStart,
    )}${methods}${task60.slice(positions.searchStart)}`;
    const wrongOrdering = `${task60.slice(
      0,
      positions.preludeStart,
    )}${task60.slice(
      positions.classStart,
      positions.methodsStart,
    )}${prelude}${task60.slice(positions.methodsStart)}`;
    const unexpectedDeclaration = `${task60.slice(
      0,
      positions.classStart,
    )}const task61Unexpected = true;\n\n${task60.slice(positions.classStart)}`;
    const unexpectedClassMember = `${task60.slice(
      0,
      positions.searchStart,
    )}  private task61Unexpected = true;\n\n${task60.slice(
      positions.searchStart,
    )}`;
    const partialMarker = task60.replace(
      "function asciiOrder(",
      "function asciiOrde(",
    );

    for (const malformed of [
      preludeOnly,
      methodsOnly,
      oneHelperMissing,
      oneMethodMissing,
      duplicateHelper,
      duplicateMethod,
      wrongOrdering,
      unexpectedDeclaration,
      unexpectedClassMember,
      partialMarker,
    ]) {
      expectMalformed(malformed);
    }
  });

  it("R6 satisfies idempotence and the State-B closing property", () => {
    const { task60, task61 } = task60AndTask61Text();
    const normalized = normalizeTask61SqliteKnowledgeStore(task60);
    expect(normalizeTask61SqliteKnowledgeStore(normalized)).toBe(normalized);
    expect(normalizeTask61SqliteKnowledgeStore(task61)).toBe(task61);
    expect(classifyTask61SqliteState(normalized)).toBe("TASK61");
  });

  it("R7 resolves a synthetic Task60 baseline to the Task61 target", () => {
    const task60Baseline = headTask60Snapshot();
    const task61Target =
      canonicalizeTask61KnowledgeSqliteSnapshot(task60Baseline);
    expect(() =>
      assertTask61KnowledgeSqliteCompatibility(task60Baseline, task61Target),
    ).not.toThrow();
  });

  it("R7 resolves a synthetic Task61 baseline to the same Task61 target", () => {
    const task61Baseline =
      canonicalizeTask61KnowledgeSqliteSnapshot(headTask60Snapshot());
    expect(() =>
      assertTask61KnowledgeSqliteCompatibility(task61Baseline, task61Baseline),
    ).not.toThrow();
    expect(task61Baseline.has(obsoleteTask60SourceStoreTestPath)).toBe(false);
  });

  it("R7 never normalizes a raw Task60 working-tree side", () => {
    const task60Baseline = headTask60Snapshot();
    expect(() =>
      assertTask61KnowledgeSqliteCompatibility(task60Baseline, task60Baseline),
    ).toThrow("Raw working-tree SQLite store is not Task 61 State-B");
  });

  it("validates whole-directory bytes and detects synthetic path or byte drift", () => {
    const task60Baseline = headTask60Snapshot();
    const task61Target =
      canonicalizeTask61KnowledgeSqliteSnapshot(task60Baseline);
    expect(task60Baseline.size).toBeGreaterThan(2);
    expect(task61Target.size).toBe(task60Baseline.size - 1);

    const byteDrift = new Map(task61Target);
    byteDrift.set("package.json", changedEntry("{}\n"));
    expect(() =>
      assertTask61KnowledgeSqliteCompatibility(task60Baseline, byteDrift),
    ).toThrow("Task 61 knowledge-sqlite bytes changed: package.json");

    const pathDrift = new Map(task61Target);
    pathDrift.set("test/untracked-sentinel.ts", changedEntry("export {};\n"));
    expect(() =>
      assertTask61KnowledgeSqliteCompatibility(task60Baseline, pathDrift),
    ).toThrow("Task 61 knowledge-sqlite path set changed");
  });

  it("rejects empty baseline and working-tree enumerations", () => {
    const emptyReader = () => Buffer.alloc(0);
    expect(() =>
      readCompatibilityBaseline(workspaceRoot, "HEAD", emptyReader),
    ).toThrow("Task 61 knowledge-sqlite snapshot is empty");
    expect(() =>
      readCompatibilityWorkingTree(workspaceRoot, emptyReader),
    ).toThrow("Task 61 knowledge-sqlite enumerator returned no paths");
  });
});

describe("Task 61 final invariants", () => {
  it("R1 removes the shared prune lifecycle from knowledge-sqlite production", () => {
    const source = readFileSync(rawStorePath, "utf8");
    expect(source).not.toContain("function asciiOrder(");
    expect(source).not.toContain("function canonicalSourcePaths(");
    expect(source).not.toContain("function equalSourceSnapshots(");
    expect(source).not.toContain("  async listSourcePaths(");
    expect(source).not.toContain("  async pruneSourcePaths(");
  });

  it("R2 contains the complete T1-T16 shipped-store coverage", () => {
    const shippedTest = readFileSync(
      join(packageRoot, "test", "kecDirectoryPruneSqliteSourceStore.test.ts"),
      "utf8",
    );
    const labels = shippedTest.match(/it\("T(?:[1-9]|1[0-6])\b/gu) ?? [];
    expect(labels).toHaveLength(16);
    expect(shippedTest).not.toMatch(/\.(?:skip|todo|only)\s*\(/u);
  });

  it("R3 removes the old Task60 SQLite SHA/block machinery and call sites", () => {
    const locations = [
      "helpers/kecBatchIndexFixture.ts",
      "kecHybridSearchIntegrationBoundaries.test.ts",
      "kecNativeHybridSearchEntryPointBoundaries.test.ts",
      "kecIndexWriteCompatibilityBoundaries.test.ts",
      "kecIndexDiagnosticsBoundaries.test.ts",
    ];
    const offenders = locations.filter((relativePath) =>
      readFileSync(join(packageRoot, "test", relativePath), "utf8").includes(
        "normalizeTask60SqliteKnowledgeStore",
      ),
    );
    expect(offenders).toEqual([]);

    const oldFixture = readFileSync(
      join(packageRoot, "test", "helpers", "kecBatchIndexFixture.ts"),
      "utf8",
    );
    for (const oldSymbol of [
      "task60SqlitePreludeSha256",
      "task60SqliteMethodsSha256",
      "preTask60SqliteStoreSha256",
      "function sha256Text(",
      "function exactlyOnePosition(",
    ]) {
      expect(oldFixture).not.toContain(oldSymbol);
    }
  });

  it("R4 requires raw State-B, normalized HEAD equality, and the fixed SHA", () => {
    const rawWorktree = readFileSync(rawStorePath, "utf8");
    const normalizedHead = normalizeTask61SqliteKnowledgeStore(
      snapshotStoreText(headTask60Snapshot()),
    );
    expect(classifyTask61SqliteState(rawWorktree)).toBe("TASK61");
    expect(rawWorktree).toBe(normalizedHead);
    expect(canonicalTask61SqliteSha256).toBe(
      "820384df711fa796acd3db88cd607231136cc173380cfffe316f1f74face6ff3",
    );
  });

  it("R5 matches canonical HEAD to the raw whole-directory working tree", () => {
    expect(() =>
      assertTask61KnowledgeSqliteCompatibility(
        headTask60Snapshot(),
        readCompatibilityWorkingTree(workspaceRoot),
      ),
    ).not.toThrow();
  });
});
