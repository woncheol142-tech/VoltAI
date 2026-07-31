import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
const command = "pnpm --filter @voltai/mcp-kec inspect:index";

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

function preservesBaselineOutsideSection(
  readme: string,
  baseline: string,
): boolean {
  const start = readme.indexOf(sectionStart);
  const markerEnd = readme.indexOf(sectionEnd);
  if (start < 0 || markerEnd < start) return false;

  const end = markerEnd + sectionEnd.length;
  for (let before = 0; before <= 2; before += 1) {
    for (let after = 0; after <= 2; after += 1) {
      const removalStart = start - before;
      const removalEnd = end + after;
      if (removalStart < 0 || removalEnd > readme.length) continue;
      const removedPrefix = readme.slice(removalStart, start);
      const removedSuffix = readme.slice(end, removalEnd);
      if (!/^\n*$/u.test(removedPrefix) || !/^\n*$/u.test(removedSuffix)) {
        continue;
      }
      if (
        `${readme.slice(0, removalStart)}${readme.slice(removalEnd)}` ===
        baseline
      ) {
        return true;
      }
    }
  }

  return false;
}

describe("KEC index diagnostics package script contract", () => {
  it("adds exactly the approved source command to the package manifest", () => {
    const current = readPackage(packageJsonPath);
    const baseline = JSON.parse(
      readHeadFile("packages/mcp-kec/package.json"),
    ) as PackageJson;

    expect(current).toEqual({
      ...baseline,
      scripts: {
        ...baseline.scripts,
        "inspect:index": "tsx src/inspectIndex.ts",
      },
    });
    expect(current.scripts["inspect:index"]).toBe("tsx src/inspectIndex.ts");
  });

  it("preserves existing scripts and adds no lifecycle hook, dependency, or embedded configuration", () => {
    const current = readPackage(packageJsonPath);
    const baseline = JSON.parse(
      readHeadFile("packages/mcp-kec/package.json"),
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
    ]) {
      expect(current.scripts).not.toHaveProperty(lifecycle);
    }
    expect(current.dependencies).toEqual(baseline.dependencies);
    expect(current.devDependencies).toEqual(baseline.devDependencies);
    expect(current.scripts["inspect:index"] ?? "").not.toMatch(
      /KEC_DB_PATH|PROJECT_ROOT|OLLAMA|--|&&|\|/u,
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
  });
});

describe("KEC index diagnostics README contract", () => {
  it("adds one clearly delimited Task 56 section and preserves all baseline bytes", () => {
    const readme = readText(readmePath);
    const baseline = readHeadFile("README.md");

    expect(readme.match(new RegExp(sectionStart, "gu")) ?? []).toHaveLength(1);
    expect(readme.match(new RegExp(sectionEnd, "gu")) ?? []).toHaveLength(1);
    expect(preservesBaselineOutsideSection(readme, baseline)).toBe(true);
    expect(taskSection(readme).match(/^#{1,6}\s+/gmu) ?? []).toHaveLength(1);
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
