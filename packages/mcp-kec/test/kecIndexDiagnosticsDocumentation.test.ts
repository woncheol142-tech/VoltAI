import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  normalizeTask59PackageBaseline,
  removeTask59PackageScript,
  task60PackageLayers,
  task60ReadmeLayers,
  task59PackageScriptName,
  task59PackageScriptValue,
  task59ReadmeEnd,
  task59ReadmeStart,
  task60PackageScriptName,
  task60PackageScriptValue,
} from "./helpers/kecBatchIndexFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const packageJsonPath = join(packageRoot, "package.json");
const rootPackageJsonPath = join(workspaceRoot, "package.json");
const readmePath = join(workspaceRoot, "README.md");
const environmentExamplePath = join(workspaceRoot, ".env.example");
const dockerfilePath = join(workspaceRoot, "Dockerfile");
const dockerComposePath = join(workspaceRoot, "docker-compose.yml");
const cliSourcePath = join(packageRoot, "src", "inspectIndex.ts");
const sectionStart = "<!-- TASK 56 KEC INDEX DIAGNOSTICS START -->";
const sectionEnd = "<!-- TASK 56 KEC INDEX DIAGNOSTICS END -->";
const task57SectionStart = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_START -->";
const task57SectionEnd = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_END -->";
const task58SectionStart = "<!-- TASK58_KEC_BATCH_INDEX_START -->";
const task58SectionEnd = "<!-- TASK58_KEC_BATCH_INDEX_END -->";
const task58ScriptName = "index:batch";
const task58ScriptValue = "tsx --conditions=voltai-source src/indexKecBatch.ts";
const command = "pnpm --filter @voltai/mcp-kec inspect:index";
const approvedTask56ReadmeBlockSha256 =
  "f2d81f2a7dc0f619a994addbf7fbabb37d5bf711192005cf05d243a9da160c35";

type PackageJson = Readonly<{
  scripts: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  [key: string]: unknown;
}>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readHeadFile(relativePath: string): string {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function readPackage(path: string): PackageJson {
  return JSON.parse(readText(path)) as PackageJson;
}

function taskSection(readme: string): string {
  const start = readme.indexOf(sectionStart);
  const end = readme.indexOf(sectionEnd);
  if (start < 0 || end < start) return "";
  return readme.slice(start, end + sectionEnd.length);
}

function rawInclusiveBlock(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const startCount = source.split(startMarker).length - 1;
  const endCount = source.split(endMarker).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error("README block requires exactly one start and end marker");
  }

  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start >= end) {
    throw new Error("README block start marker must precede end marker");
  }
  return source.slice(start, end + endMarker.length);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function matchesCommittedReadme(readme: string): boolean {
  let task56Block: string;
  try {
    task60ReadmeLayers(readme);
    task56Block = rawInclusiveBlock(readme, sectionStart, sectionEnd);
  } catch {
    return false;
  }
  if (
    readme.split(task57SectionStart).length !== 2 ||
    readme.split(task57SectionEnd).length !== 2
  ) {
    return false;
  }

  const task56Start = readme.indexOf(sectionStart);
  const task56End = readme.indexOf(sectionEnd, task56Start);
  const task57Start = readme.indexOf(task57SectionStart);
  const task57End = readme.indexOf(task57SectionEnd, task57Start);

  return (
    task56Start >= 0 &&
    task56End > task56Start &&
    task57Start > task56End &&
    task57End > task57Start &&
    sha256Text(task56Block) === approvedTask56ReadmeBlockSha256 &&
    readme.split(task58SectionStart).length === 2 &&
    readme.split(task58SectionEnd).length === 2 &&
    readme.indexOf(task58SectionStart) > task57End
  );
}

describe("KEC index diagnostics package script contract", () => {
  it("preserves the exact committed package manifest", () => {
    const currentText = readText(packageJsonPath);
    const { preTask58 } = task60PackageLayers(currentText);

    const current = JSON.parse(currentText) as PackageJson;
    const baseline = JSON.parse(preTask58) as PackageJson;
    expect(current.dependencies).toEqual(baseline.dependencies);
    expect(current.devDependencies).toEqual(baseline.devDependencies);
    expect(current.scripts[task58ScriptName]).toBe(task58ScriptValue);
    expect(current.scripts[task59PackageScriptName]).toBe(
      task59PackageScriptValue,
    );
    expect(current.scripts[task60PackageScriptName]).toBe(
      task60PackageScriptValue,
    );
    expect(() =>
      removeTask59PackageScript(
        currentText.replace(task59PackageScriptValue, "tsx wrong.ts"),
      ),
    ).toThrow();
    expect(() =>
      normalizeTask59PackageBaseline(
        currentText.replace(
          `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`,
          `    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n    "${task59PackageScriptName}": "${task59PackageScriptValue}",\n`,
        ),
      ),
    ).toThrow();
    expect(current.scripts["inspect:index"]).toBe(
      "tsx --conditions=voltai-source src/inspectIndex.ts",
    );
    expect(current.scripts["smoke:ollama"]).toBe(
      "tsx --conditions=voltai-source src/smokeOllamaEmbedding.ts",
    );
    expect(current.scripts[task58ScriptName]).toBe(task58ScriptValue);
  });

  it("preserves existing scripts and adds no lifecycle hook, dependency, or embedded configuration", () => {
    const current = readPackage(packageJsonPath);
    const baseline = JSON.parse(
      task60PackageLayers(readText(packageJsonPath)).preTask58,
    ) as PackageJson;

    for (const [name, value] of Object.entries(baseline.scripts)) {
      expect(current.scripts[name]).toBe(value);
    }
    for (const lifecycle of [
      "preinstall",
      "postinstall",
      "prepare",
      "prestart",
      "poststart",
      "preinspect:index",
      "postinspect:index",
      "presmoke:ollama",
      "postsmoke:ollama",
    ]) {
      expect(current.scripts).not.toHaveProperty(lifecycle);
    }
    expect(current.dependencies).toEqual(baseline.dependencies);
    expect(current.devDependencies).toEqual(baseline.devDependencies);
    const inspectScript = current.scripts["inspect:index"] ?? "";
    expect(inspectScript).toBe(
      "tsx --conditions=voltai-source src/inspectIndex.ts",
    );
    expect(
      inspectScript.replace(" --conditions=voltai-source", ""),
    ).not.toMatch(/KEC_DB_PATH|PROJECT_ROOT|OLLAMA|--|&&|\|/u);
    expect(current.scripts["smoke:ollama"]).toBe(
      "tsx --conditions=voltai-source src/smokeOllamaEmbedding.ts",
    );
  });

  it("adds no root command and leaves Docker and environment templates byte-identical", () => {
    expect(readText(rootPackageJsonPath)).toBe(readHeadFile("package.json"));
    expect(readText(environmentExamplePath)).toBe(readHeadFile(".env.example"));
    expect(readText(dockerfilePath)).toBe(readHeadFile("Dockerfile"));
    expect(readText(dockerComposePath)).toBe(
      readHeadFile("docker-compose.yml"),
    );
    expect(readPackage(rootPackageJsonPath).scripts).not.toHaveProperty(
      "inspect:index",
    );
    expect(readPackage(rootPackageJsonPath).scripts).not.toHaveProperty(
      "smoke:ollama",
    );
  });
});

describe("KEC index diagnostics README contract", () => {
  it("preserves the exact committed raw Task 56 README block", () => {
    const readme = readText(readmePath);

    expect(readme.match(new RegExp(sectionStart, "gu")) ?? []).toHaveLength(1);
    expect(readme.match(new RegExp(sectionEnd, "gu")) ?? []).toHaveLength(1);
    expect(
      sha256Text(rawInclusiveBlock(readme, sectionStart, sectionEnd)),
    ).toBe(approvedTask56ReadmeBlockSha256);
    expect(matchesCommittedReadme(readme)).toBe(true);
    expect(matchesCommittedReadme(readme.replace(task59ReadmeStart, ""))).toBe(
      false,
    );
    expect(
      matchesCommittedReadme(
        readme.replace(
          task59ReadmeStart,
          `${task59ReadmeStart}\n${task59ReadmeStart}`,
        ),
      ),
    ).toBe(false);
    expect(
      matchesCommittedReadme(
        readme
          .replace(task59ReadmeStart, "TASK_59_MARKER_SWAP")
          .replace(task59ReadmeEnd, task59ReadmeStart)
          .replace("TASK_59_MARKER_SWAP", task59ReadmeEnd),
      ),
    ).toBe(false);
    expect(matchesCommittedReadme(readme.replace(sectionStart, ""))).toBe(
      false,
    );
    expect(
      matchesCommittedReadme(
        readme.replace(sectionStart, `${sectionStart}\n${sectionStart}`),
      ),
    ).toBe(false);
    expect(
      matchesCommittedReadme(
        readme
          .replace(sectionStart, "TASK_56_MARKER_SWAP")
          .replace(sectionEnd, sectionStart)
          .replace("TASK_56_MARKER_SWAP", sectionEnd),
      ),
    ).toBe(false);
    expect(taskSection(readme).match(/^#{1,6}\s+/gmu) ?? []).toHaveLength(1);
  });

  it.each([
    [
      "a duplicate start marker",
      `${sectionStart}\n${sectionStart}\nbody\n${sectionEnd}`,
    ],
    [
      "a duplicate end marker",
      `${sectionStart}\nbody\n${sectionEnd}\n${sectionEnd}`,
    ],
    ["a missing start marker", `body\n${sectionEnd}`],
    ["a missing end marker", `${sectionStart}\nbody`],
    ["reversed marker ordering", `${sectionEnd}\nbody\n${sectionStart}`],
  ])("Task62 raw Task 56 extractor rejects %s", (_caseName, malformed) => {
    expect(() =>
      rawInclusiveBlock(malformed, sectionStart, sectionEnd),
    ).toThrow();
  });

  it("Task62 rejects additive and replacement Task 56 drift", () => {
    const readme = readText(readmePath);
    const sentinel =
      "Task62 synthetic material drift preserves every existing Task 56 semantic term.";
    const mutated = readme.replace(sectionEnd, `${sentinel}\n${sectionEnd}`);
    const replaced = readme.replace(
      "Read-only KEC index diagnostics",
      "Read-only KEC index diagnostic status",
    );

    expect(mutated).not.toBe(readme);
    expect(mutated.replace(`${sentinel}\n`, "")).toBe(readme);
    expect(taskSection(mutated)).toContain(sentinel);
    expect(matchesCommittedReadme(mutated)).toBe(false);
    expect(replaced).not.toBe(readme);
    expect(matchesCommittedReadme(replaced)).toBe(false);
  });

  it("documents the exact short-lived read-only command and path precedence", () => {
    const section = taskSection(readText(readmePath));

    expect(section).toMatch(/read-only KEC index diagnostics/iu);
    expect(
      section.match(/pnpm --filter @voltai\/mcp-kec inspect:index/gu),
    ).toHaveLength(1);
    expect(section).toMatch(/short-lived/iu);
    expect(section).toMatch(/not an MCP server|does not start an MCP server/iu);
    expect(section).toMatch(/does not (?:perform )?index(?:ing)? or search/iu);
    expect(section).toMatch(/does not contact (?:an? )?embedding provider/iu);
    expect(section).toMatch(/KEC_DB_PATH[\s\S]*precedence/iu);
    expect(section).toMatch(
      /relative KEC_DB_PATH[\s\S]*current working directory/iu,
    );
    expect(section).toContain("PROJECT_ROOT/.voltai/kec.sqlite");
    expect(section).toMatch(/no new environment variables/iu);
    expect(section).not.toMatch(
      /pnpm\s+(?:run\s+)?inspect:index|npm\s+run|npx\s+|dev:inspect|start:inspect/iu,
    );
  });

  it("documents every status and distinguishes inspection success from failure", () => {
    const section = taskSection(readText(readmePath));

    for (const status of [
      "MISSING_DATABASE",
      "UNINITIALIZED_DATABASE",
      "EMPTY_INDEX",
      "READY",
      "INCONSISTENT",
    ]) {
      expect(section).toContain(status);
    }
    expect(section).toMatch(
      /INCONSISTENT[\s\S]*exit(?:s)? successfully|exit code 0/iu,
    );
    expect(section).toMatch(/failure[\s\S]*exit code 1/iu);
    expect(section).toMatch(/missing[\s\S]*creates? nothing|does not create/iu);
  });

  it("documents redaction, collection-level provenance, and operational limitations", () => {
    const section = taskSection(readText(readmePath));

    expect(section).toMatch(/source paths?[\s\S]*hashed sourceId/iu);
    expect(section).toMatch(
      /provider\/model metadata[\s\S]*collection-level/iu,
    );
    expect(section).toMatch(/cannot prove[\s\S]*per-chunk[\s\S]*provenance/iu);
    expect(section).toMatch(/not[\s\S]*retrieval-quality evidence/iu);
    expect(section).toMatch(/does not[\s\S]*Ollama health/iu);
    expect(section).toMatch(
      /does not[\s\S]*(?:repair|migrate)[\s\S]*(?:rebuild|reindex)/iu,
    );
    expect(section).toMatch(/does not[\s\S]*source files?[\s\S]*still exist/iu);
    expect(section).not.toMatch(/\/Users\/|[A-Za-z]:\\/u);
    expect(section).not.toMatch(/\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*=\S+/u);
  });
});

describe("KEC index diagnostics compatibility boundaries", () => {
  it("is RED until the approved CLI source exists", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
  });

  it("keeps package-root exports and both MCP runtime entrypoints byte-identical", () => {
    for (const relativePath of [
      "packages/mcp-kec/src/index.ts",
      "packages/mcp-kec/src/hybrid.ts",
      "packages/mcp-kec/src/tools/indexKec.ts",
      "packages/mcp-kec/src/tools/searchKec.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]) {
      expect(readText(join(workspaceRoot, relativePath))).toBe(
        readHeadFile(relativePath),
      );
    }

    const packageIndex = readText(join(packageRoot, "src", "index.ts"));
    expect(packageIndex).not.toMatch(/inspectKecIndex|runInspectIndexCli/iu);
  });

  it("keeps the future command isolated from MCP, providers, writable stores, and repair", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
    const source = readText(cliSourcePath);

    expect(source).not.toMatch(
      /runStdioServer|createVoltAiMcpServer|EmbeddingProvider|SqliteKnowledgeStore|SqliteVectorStore|indexKec|searchKec|\bfetch\s*\(|console\.|logger/iu,
    );
    expect(source).not.toMatch(
      /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|VACUUM|REINDEX|ATTACH|DETACH)\b/iu,
    );
    expect(source).not.toMatch(
      /process\.env\.(?!KEC_DB_PATH\b|PROJECT_ROOT\b)/u,
    );
  });

  it("mentions the approved command only inside the Task 56 section", () => {
    const readme = readText(readmePath);
    const section = taskSection(readme);

    expect(section).toContain(command);
    expect(readme.replace(section, "")).not.toContain(command);
  });
});
