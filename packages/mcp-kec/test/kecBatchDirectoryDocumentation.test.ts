import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  packageRoot,
  task58ReadmeEnd,
  task59PackageScriptName,
  task59PackageScriptValue,
  task59ReadmeEnd,
  task59ReadmeStart,
  workspaceRoot,
} from "./helpers/kecBatchDirectoryFixture.js";
import {
  addTask59PackageScript,
  addTask59ReadmeBlock,
  addTask60PackageScript,
  addTask60ReadmeBlock,
  removeTask59PackageScript,
  removeTask59ReadmeSection,
  removeTask60PackageScript,
  removeTask60ReadmeSection,
  task59ReadmeBlock,
  task60ReadmeBlock,
} from "./helpers/kecBatchIndexFixture.js";

const packagePath = join(packageRoot, "package.json");
const readmePath = join(workspaceRoot, "README.md");
const rootPackagePath = join(workspaceRoot, "package.json");
const lockfilePath = join(workspaceRoot, "pnpm-lock.yaml");

type PackageJson = Readonly<{
  scripts: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  [key: string]: unknown;
}>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function packageHasTask59Script(): boolean {
  const manifest = JSON.parse(readText(packagePath)) as PackageJson;
  return manifest.scripts[task59PackageScriptName] === task59PackageScriptValue;
}

function readmeSection(readme: string): string {
  const start = readme.indexOf(task59ReadmeStart);
  const end = readme.indexOf(task59ReadmeEnd, start);
  if (start < 0 || end <= start) return "";
  return readme.slice(start, end + task59ReadmeEnd.length);
}

function hasOneOrderedSection(readme: string): boolean {
  return (
    readme.split(task59ReadmeStart).length === 2 &&
    readme.split(task59ReadmeEnd).length === 2 &&
    readme.indexOf(task59ReadmeEnd) > readme.indexOf(task59ReadmeStart)
  );
}

describe("Task 59 package script RED contract", () => {
  it("is RED until the exact package-local index:directory script exists", () => {
    expect(packageHasTask59Script()).toBe(true);
  });

  it("allows only the exact Task 59 script delta in the package manifest", () => {
    if (!packageHasTask59Script()) return;
    const current = readText(packagePath);
    const preTask60 = removeTask60PackageScript(current);
    const baseline = removeTask59PackageScript(preTask60);
    const reconstructed = addTask59PackageScript(baseline);
    const parsed = JSON.parse(current) as PackageJson;
    const baselineParsed = JSON.parse(baseline) as PackageJson;

    expect(reconstructed).toBe(preTask60);
    expect(addTask60PackageScript(reconstructed)).toBe(current);
    expect(removeTask59PackageScript(reconstructed)).toBe(baseline);
    expect(parsed.scripts[task59PackageScriptName]).toBe(
      task59PackageScriptValue,
    );
    expect(parsed.dependencies).toEqual(baselineParsed.dependencies);
    expect(parsed.devDependencies).toEqual(baselineParsed.devDependencies);
    expect(() =>
      removeTask59PackageScript(
        preTask60.replace(task59PackageScriptValue, "tsx src/wrong.ts"),
      ),
    ).toThrow();
    expect(() =>
      removeTask59PackageScript(
        preTask60.replace(
          `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`,
          `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`,
        ),
      ),
    ).toThrow();

    const future = preTask60.replace(
      '    "test":',
      '    "future:task60": "tsx src/task60.ts",\n    "test":',
    );
    expect(addTask59PackageScript(removeTask59PackageScript(future))).toBe(
      future,
    );
    expect(readText(rootPackagePath)).not.toContain(task59PackageScriptValue);
    expect(readText(lockfilePath)).not.toContain(task59PackageScriptValue);
  });

  it("preserves Task 59 byte ordering through a hypothetical exact Task 60 script layer", () => {
    const current = readText(packagePath);
    const preTask60 = removeTask60PackageScript(current);
    const task59Baseline = removeTask59PackageScript(preTask60);
    const task59Reapplied = addTask59PackageScript(task59Baseline);
    const reconstructed = addTask60PackageScript(task59Reapplied);

    expect(task59Reapplied).toBe(preTask60);
    expect(reconstructed).toBe(current);
  });

  it("adds no lifecycle hook, dependency, package-root export, or MCP command", () => {
    if (!packageHasTask59Script()) return;
    const manifest = JSON.parse(readText(packagePath)) as PackageJson;
    for (const hook of [
      "preindex:directory",
      "postindex:directory",
      "preinstall",
      "postinstall",
      "prepare",
    ]) {
      expect(manifest.scripts).not.toHaveProperty(hook);
    }
  });
});

describe("Task 59 README marker and operator contract", () => {
  it("is RED until exactly one ordered Task 59 marker pair exists", () => {
    expect(hasOneOrderedSection(readText(readmePath))).toBe(true);
  });

  it("places the sole Task 59 section immediately after Task 58 and changes nothing else", () => {
    const readme = readText(readmePath);
    if (!hasOneOrderedSection(readme)) return;
    const task60Block = task60ReadmeBlock(readme);
    const preTask60 = removeTask60ReadmeSection(readme);
    const section = task59ReadmeBlock(preTask60);
    const baseline = removeTask59ReadmeSection(preTask60);
    expect(readme).toContain(`${task58ReadmeEnd}\n\n${task59ReadmeStart}\n`);
    expect(addTask59ReadmeBlock(baseline, section)).toBe(preTask60);
    expect(
      addTask60ReadmeBlock(
        addTask59ReadmeBlock(baseline, section),
        task60Block,
      ),
    ).toBe(readme);
    expect(() =>
      removeTask59ReadmeSection(preTask60.replace(task59ReadmeStart, "")),
    ).toThrow();
    expect(() =>
      removeTask59ReadmeSection(preTask60.replace(task59ReadmeEnd, "")),
    ).toThrow();
    expect(() =>
      removeTask59ReadmeSection(
        preTask60.replace(
          task59ReadmeStart,
          `${task59ReadmeStart}\n${task59ReadmeStart}`,
        ),
      ),
    ).toThrow();
    expect(() =>
      removeTask59ReadmeSection(
        preTask60
          .replace(task59ReadmeStart, "TASK59_MARKER_SWAP")
          .replace(task59ReadmeEnd, task59ReadmeStart)
          .replace("TASK59_MARKER_SWAP", task59ReadmeEnd),
      ),
    ).toThrow();
    expect(() =>
      removeTask59ReadmeSection(
        `${baseline}\n<!-- TASK60_START -->\nFuture content.\n<!-- TASK60_END -->\n\n${section}\n`,
      ),
    ).toThrow();

    const future = `${preTask60}\n<!-- TASK60_START -->\nFuture content.\n<!-- TASK60_END -->\n`;
    expect(
      addTask59ReadmeBlock(
        removeTask59ReadmeSection(future),
        task59ReadmeBlock(future),
      ),
    ).toBe(future);
  });

  it("preserves Task 59 README bytes through a hypothetical Task 60 marker layer", () => {
    const current = readText(readmePath);
    const task60Block = task60ReadmeBlock(current);
    const preTask60 = removeTask60ReadmeSection(current);
    const task59Block = task59ReadmeBlock(preTask60);
    const task59Baseline = removeTask59ReadmeSection(preTask60);
    const task59Reapplied = addTask59ReadmeBlock(task59Baseline, task59Block);
    const reconstructed = addTask60ReadmeBlock(task59Reapplied, task60Block);

    expect(task59Reapplied).toBe(preTask60);
    expect(reconstructed).toBe(current);
  });

  it("documents one explicit project-relative directory and bounded non-recursive discovery", () => {
    const readme = readText(readmePath);
    if (!hasOneOrderedSection(readme)) return;
    const section = readmeSection(readme);
    expect(section).toMatch(
      /pnpm --filter @voltai\/mcp-kec index:directory\s+[^\s<]+/u,
    );
    expect(section).toMatch(/exactly one|one explicit|single/iu);
    expect(section).toMatch(/project-relative|relative directory/iu);
    expect(section).toMatch(/non-recursive|does not recurse|no recursive/iu);
    expect(section).toMatch(/direct (?:children|child files)/iu);
    expect(section).toMatch(/lowercase\s+`?\.pdf`?|ends? in lowercase/iu);
  });

  it("documents symlink rejection, ignored entries, NO_SOURCES, and no numeric cap", () => {
    const readme = readText(readmePath);
    if (!hasOneOrderedSection(readme)) return;
    const section = readmeSection(readme);
    expect(section).toMatch(
      /symlinks?[^.\n]*(?:reject|not followed)|reject[^.\n]*symlinks?/iu,
    );
    expect(section).toMatch(/non-PDF[^.\n]*(?:ignored|ignore)/iu);
    expect(section).toMatch(/zero|empty|NO_SOURCES/iu);
    expect(section).toMatch(
      /no (?:numeric|arbitrary) (?:source )?(?:limit|cap)|does not add[^.\n]*(?:limit|cap)/iu,
    );
    expect(section).not.toMatch(
      /(?:limit|maximum|max)\s*(?:of\s*)?100|100-source/iu,
    );
  });

  it("states Task 58 reuse and every Task 59 non-goal without new authority claims", () => {
    const readme = readText(readmePath);
    if (!hasOneOrderedSection(readme)) return;
    const section = readmeSection(readme);
    expect(section).toMatch(/Task 58[^.\n]*(?:reuse|existing|semantics)/iu);
    for (const contract of [
      /no (?:stale-source )?(?:delete|deletion|prune)|no pruning/iu,
      /no (?:unchanged-file detection|incremental)/iu,
      /no (?:resume|checkpoint)/iu,
      /no MCP|does not register[^.\n]*MCP/iu,
    ]) {
      expect(section).toMatch(contract);
    }
    expect(section).not.toMatch(
      /automatically prune|unchanged files? (?:are|will be) skipped|resume from a checkpoint|registers? an MCP tool/iu,
    );
  });
});
