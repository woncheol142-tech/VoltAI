import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  addTask58PackageScript,
  addTask59PackageScript,
  addTask60PackageScript,
  addTask60ReadmeBlock,
  normalizeTask58PackageBaseline,
  removeTask59PackageScript,
  removeTask60PackageScript,
  removeTask60ReadmeSection,
  task60PackageScriptName,
  task60PackageScriptValue,
  task60ReadmeBlock,
} from "./helpers/kecBatchIndexFixture.js";
import {
  packageRoot,
  task60ReadmeEnd,
  task60ReadmeStart,
  workspaceRoot,
} from "./helpers/kecDirectoryPruneFixture.js";

const packagePath = join(packageRoot, "package.json");
const rootPackagePath = join(workspaceRoot, "package.json");
const lockfilePath = join(workspaceRoot, "pnpm-lock.yaml");
const readmePath = join(workspaceRoot, "README.md");
const task59ReadmeStart = "<!-- TASK59_KEC_DIRECTORY_BATCH_START -->";
const task59ReadmeEnd = "<!-- TASK59_KEC_DIRECTORY_BATCH_END -->";
const futureTask61 =
  "<!-- TASK61_FUTURE_START -->\nFuture Task 61 content.\n<!-- TASK61_FUTURE_END -->\n";
const approvedTask60Block = `${task60ReadmeStart}

### Deterministic provider-free stale KEC directory pruning

Run \`pnpm --filter @voltai/mcp-kec prune:directory kec/manuals\` with one explicit project-relative directory. The command prunes only stale direct-child KEC source identities, fails with \`NO_SOURCES\` for zero eligible lowercase PDFs, and never indexes, embeds, parses PDFs, uses Ollama/network authority, or registers MCP.

${task60ReadmeEnd}`;

type PackageJson = Readonly<{
  scripts: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
}>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Task 60 package script RED and layered compatibility", () => {
  it("is intentionally RED until the exact prune:directory script exists in order", () => {
    const manifest = JSON.parse(readText(packagePath)) as PackageJson;
    expect(manifest.scripts[task60PackageScriptName]).toBe(
      task60PackageScriptValue,
    );
    expect(Object.keys(manifest.scripts)).toEqual([
      "dev",
      "dev:hybrid",
      "build",
      "start",
      "start:hybrid",
      "inspect:index",
      "smoke:ollama",
      "index:batch",
      "index:directory",
      "prune:directory",
      "test",
    ]);
  });

  it("peels Task 60 then Task 59 before reconstructing Task 58 byte-for-byte", () => {
    const current = readText(packagePath);
    const task60Peeled = removeTask60PackageScript(current);
    const task59Peeled = removeTask59PackageScript(task60Peeled);
    const task58Baseline = normalizeTask58PackageBaseline(task59Peeled);
    const task58Reapplied = addTask58PackageScript(task58Baseline);
    const task59Reapplied = addTask59PackageScript(task58Reapplied);
    const task60Reapplied = addTask60PackageScript(task59Reapplied);

    expect(task58Reapplied).toBe(task59Peeled);
    expect(task59Reapplied).toBe(task60Peeled);
    expect(task60Reapplied).toBe(current);
  });

  it("rejects malformed, duplicate, misplaced, and wrongly ordered Task 60 scripts", () => {
    const current = readText(packagePath);
    const preTask60 = removeTask60PackageScript(current);
    expect(() => removeTask60PackageScript(preTask60)).toThrow();
    expect(() =>
      removeTask60PackageScript(
        current.replace(task60PackageScriptValue, "tsx src/wrong.ts"),
      ),
    ).toThrow();
    expect(() =>
      removeTask60PackageScript(
        current.replace(
          '    "index:directory": "tsx src/indexKecDirectory.ts",\n    "prune:directory": "tsx src/pruneKecDirectory.ts",\n',
          '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n    "index:directory": "tsx src/indexKecDirectory.ts",\n',
        ),
      ),
    ).toThrow();
    expect(() =>
      removeTask60PackageScript(
        current.replace(
          '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n    "test":',
          '    "test":',
        ) + '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n',
      ),
    ).toThrow();
    expect(() =>
      removeTask60PackageScript(
        current.replace(
          '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n',
          '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n    "prune:directory": "tsx src/pruneKecDirectory.ts",\n',
        ),
      ),
    ).toThrow();
    expect(addTask60PackageScript(removeTask60PackageScript(current))).toBe(
      current,
    );
  });

  it("changes no dependency set, root manifest, or lockfile in the current delta", () => {
    const current = readText(packagePath);
    const preTask60 = removeTask60PackageScript(current);
    const before = JSON.parse(preTask60) as PackageJson;
    const after = JSON.parse(current) as PackageJson;
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.devDependencies).toEqual(before.devDependencies);
    expect(readText(rootPackagePath)).not.toContain(task60PackageScriptValue);
    expect(readText(lockfilePath)).not.toContain(task60PackageScriptValue);
    const future = current.replace(
      '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n    "test":',
      '    "prune:directory": "tsx src/pruneKecDirectory.ts",\n    "future:task61": "tsx src/task61.ts",\n    "test":',
    );
    const futurePreTask60 = removeTask60PackageScript(future);
    expect(futurePreTask60).toContain(
      '    "future:task61": "tsx src/task61.ts",\n',
    );
    expect(addTask60PackageScript(futurePreTask60)).toBe(future);
  });
});

describe("Task 60 README RED and layered marker contract", () => {
  it("is intentionally RED until exactly one ordered Task 60 marker pair exists", () => {
    const readme = readText(readmePath);
    expect(readme.split(task60ReadmeStart)).toHaveLength(2);
    expect(readme.split(task60ReadmeEnd)).toHaveLength(2);
    expect(readme).toContain(`${task59ReadmeEnd}\n\n${task60ReadmeStart}\n`);
  });

  it("adds immediately after Task 59 and peels/reapplies byte-for-byte", () => {
    const current = readText(readmePath);
    const preTask60 = removeTask60ReadmeSection(current);
    expect(current).toContain(`${task59ReadmeEnd}\n\n${task60ReadmeStart}\n`);
    expect(task60ReadmeBlock(current)).toBe(approvedTask60Block);
    expect(addTask60ReadmeBlock(preTask60, approvedTask60Block)).toBe(current);
    expect(
      addTask60ReadmeBlock(
        removeTask60ReadmeSection(current),
        task60ReadmeBlock(current),
      ),
    ).toBe(current);
  });

  it("rejects duplicate, missing, reversed, malformed, and misplaced markers", () => {
    const current = readText(readmePath);
    const preTask60 = removeTask60ReadmeSection(current);
    expect(() => removeTask60ReadmeSection(preTask60)).toThrow();
    expect(() =>
      removeTask60ReadmeSection(
        current.replace(
          task60ReadmeStart,
          `${task60ReadmeStart}\n${task60ReadmeStart}`,
        ),
      ),
    ).toThrow();
    expect(() =>
      removeTask60ReadmeSection(current.replace(task60ReadmeEnd, "")),
    ).toThrow();
    expect(() =>
      removeTask60ReadmeSection(
        current
          .replace(task60ReadmeStart, "TASK60_SWAP")
          .replace(task60ReadmeEnd, task60ReadmeStart)
          .replace("TASK60_SWAP", task60ReadmeEnd),
      ),
    ).toThrow();
    expect(() =>
      removeTask60ReadmeSection(
        current
          .replace(approvedTask60Block, "")
          .replace(
            task59ReadmeStart,
            `${approvedTask60Block}\n\n${task59ReadmeStart}`,
          ),
      ),
    ).toThrow();
  });

  it("preserves future Task 61+ content after Task 60 byte-for-byte", () => {
    const future = `${readText(readmePath)}${futureTask61}`;
    const preTask60 = removeTask60ReadmeSection(future);
    expect(future.endsWith(futureTask61)).toBe(true);
    expect(preTask60.endsWith(futureTask61)).toBe(true);
    expect(addTask60ReadmeBlock(preTask60, approvedTask60Block)).toBe(future);
  });
});
