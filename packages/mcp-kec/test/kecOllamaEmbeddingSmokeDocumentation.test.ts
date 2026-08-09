import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  removeTask58PackageScript,
  removeTask58ReadmeSection,
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
const lockfilePath = join(workspaceRoot, "pnpm-lock.yaml");
const providerPath = join(packageRoot, "src", "knowledge", "embedding.ts");
const packageIndexPath = join(packageRoot, "src", "index.ts");
const defaultRuntimePath = join(packageRoot, "src", "index.ts");
const hybridRuntimePath = join(packageRoot, "src", "hybrid.ts");
const cliSourcePath = join(packageRoot, "src", "smokeOllamaEmbedding.ts");
const task56Start = "<!-- TASK 56 KEC INDEX DIAGNOSTICS START -->";
const task56End = "<!-- TASK 56 KEC INDEX DIAGNOSTICS END -->";
const task57Start = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_START -->";
const task57End = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_END -->";
const task58Start = "<!-- TASK58_KEC_BATCH_INDEX_START -->";
const task58End = "<!-- TASK58_KEC_BATCH_INDEX_END -->";
const task58ScriptName = "index:batch";
const task58ScriptValue = "tsx src/indexKecBatch.ts";
const command = "pnpm --filter @voltai/mcp-kec smoke:ollama";
const scriptValue = "tsx src/smokeOllamaEmbedding.ts";

type PackageJson = Readonly<Record<string, unknown>> &
  Readonly<{
    scripts: Readonly<Record<string, string>>;
    dependencies?: Readonly<Record<string, string>>;
    devDependencies?: Readonly<Record<string, string>>;
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

function task57Section(readme: string): string {
  const start = readme.indexOf(task57Start);
  const markerEnd = readme.indexOf(task57End, start);
  if (start < 0 || markerEnd <= start) return "";
  return readme.slice(start, markerEnd + task57End.length);
}

function matchesCommittedReadme(readme: string, baseline: string): boolean {
  let normalizedReadme: string;
  try {
    normalizedReadme =
      readme === baseline ? readme : removeTask58ReadmeSection(readme);
  } catch {
    return false;
  }
  if (
    readme.split(task56Start).length !== 2 ||
    readme.split(task56End).length !== 2 ||
    readme.split(task57Start).length !== 2 ||
    readme.split(task57End).length !== 2
  ) {
    return false;
  }

  const task56MarkerStart = readme.indexOf(task56Start);
  const task56MarkerEnd = readme.indexOf(task56End, task56MarkerStart);
  const task57MarkerStart = readme.indexOf(task57Start);
  const task57MarkerEnd = readme.indexOf(task57End, task57MarkerStart);

  return (
    task56MarkerStart >= 0 &&
    task56MarkerEnd > task56MarkerStart &&
    task57MarkerStart > task56MarkerEnd &&
    task57MarkerEnd > task57MarkerStart &&
    normalizedReadme === baseline &&
    (readme === baseline ||
      (readme.split(task58Start).length === 2 &&
        readme.split(task58End).length === 2 &&
        readme.indexOf(task58Start) > task57MarkerEnd))
  );
}

describe("Ollama embedding smoke package command contract", () => {
  it("preserves the exact committed package-local smoke command", () => {
    const currentText = readText(packageJsonPath);
    const baselineText = readHeadFile("packages/mcp-kec/package.json");
    const normalizedText =
      currentText === baselineText
        ? currentText
        : removeTask58PackageScript(currentText);
    expect(normalizedText).toBe(baselineText);

    const current = JSON.parse(currentText) as PackageJson;
    const baseline = JSON.parse(baselineText) as PackageJson;
    expect(JSON.parse(normalizedText)).toEqual(baseline);
    if (currentText !== baselineText) {
      expect(current.scripts[task58ScriptName]).toBe(task58ScriptValue);
    }
    expect(current.scripts["smoke:ollama"]).toBe(scriptValue);
    expect(current.scripts["inspect:index"]).toBe("tsx src/inspectIndex.ts");
    expect(current.scripts["dev:hybrid"]).toBe("tsx src/hybrid.ts");
    expect(current.scripts["start:hybrid"]).toBe("node dist/hybrid.js");
  });

  it("adds no lifecycle hook, dependency, root command, or lockfile change", () => {
    const current = readPackage(packageJsonPath);
    const baseline = JSON.parse(
      readHeadFile("packages/mcp-kec/package.json"),
    ) as PackageJson;

    for (const lifecycle of [
      "presmoke:ollama",
      "postsmoke:ollama",
      "preinstall",
      "postinstall",
      "prepare",
    ]) {
      expect(current.scripts).not.toHaveProperty(lifecycle);
    }
    expect(current.dependencies).toEqual(baseline.dependencies);
    expect(current.devDependencies).toEqual(baseline.devDependencies);
    expect(readText(rootPackageJsonPath)).toBe(readHeadFile("package.json"));
    expect(readPackage(rootPackageJsonPath).scripts).not.toHaveProperty(
      "smoke:ollama",
    );
    expect(readText(lockfilePath)).toBe(readHeadFile("pnpm-lock.yaml"));
    expect(current.scripts["smoke:ollama"] ?? "").not.toMatch(
      /&&|\||\$|KEC_|OLLAMA_|PROJECT_ROOT|KEC_DB_PATH/u,
    );
    if (
      readText(packageJsonPath) !==
      readHeadFile("packages/mcp-kec/package.json")
    ) {
      expect(current.scripts[task58ScriptName]).toBe(task58ScriptValue);
    }
  });

  it("rejects fake scripts, changed diagnostics, dependencies, and lifecycle hooks structurally", () => {
    const baseline = JSON.parse(
      readHeadFile("packages/mcp-kec/package.json"),
    ) as PackageJson;
    const expected = baseline;

    expect({
      ...expected,
      scripts: { ...expected.scripts, fake: "tsx fake.ts" },
    }).not.toEqual(expected);
    expect({
      ...expected,
      scripts: { ...expected.scripts, "smoke:ollama": "tsx wrong.ts" },
    }).not.toEqual(expected);
    expect({
      ...expected,
      scripts: { ...expected.scripts, "inspect:index": "tsx changed.ts" },
    }).not.toEqual(expected);
    expect({
      ...expected,
      dependencies: { ...expected.dependencies, added: "1.0.0" },
    }).not.toEqual(expected);
    expect({
      ...expected,
      devDependencies: { ...expected.devDependencies, added: "1.0.0" },
    }).not.toEqual(expected);
    expect({
      ...expected,
      scripts: { ...expected.scripts, "presmoke:ollama": "echo no" },
    }).not.toEqual(expected);
  });
});

describe("Ollama embedding smoke README baseline contract", () => {
  it("preserves the exact committed ordered Task 57 section", () => {
    const readme = readText(readmePath);
    const baseline = readHeadFile("README.md");

    expect(readme.split(task57Start)).toHaveLength(2);
    expect(readme.split(task57End)).toHaveLength(2);
    expect(readme.indexOf(task57End)).toBeGreaterThan(
      readme.indexOf(task57Start),
    );
    expect(matchesCommittedReadme(readme, baseline)).toBe(true);
    expect(readme.split(task56Start)).toHaveLength(2);
    expect(readme.split(task56End)).toHaveLength(2);
    expect(readme.indexOf(task56End)).toBeGreaterThan(
      readme.indexOf(task56Start),
    );
  });

  it("rejects unrelated edits, malformed markers, nesting, and Task 56 changes", () => {
    const baseline = readHeadFile("README.md");

    expect(matchesCommittedReadme(baseline, baseline)).toBe(true);
    expect(matchesCommittedReadme(`${baseline}unrelated`, baseline)).toBe(
      false,
    );
    expect(
      matchesCommittedReadme(baseline.replace(task57Start, ""), baseline),
    ).toBe(false);
    expect(
      matchesCommittedReadme(baseline.replace(task57End, ""), baseline),
    ).toBe(false);
    expect(
      matchesCommittedReadme(
        baseline
          .replace(task57Start, "TASK_57_MARKER_SWAP")
          .replace(task57End, task57Start)
          .replace("TASK_57_MARKER_SWAP", task57End),
        baseline,
      ),
    ).toBe(false);
    expect(
      matchesCommittedReadme(
        baseline.replace(task57Start, `${task57Start}\n${task57Start}`),
        baseline,
      ),
    ).toBe(false);
    expect(
      matchesCommittedReadme(
        baseline.replace(task57End, `${task57End}\n${task57End}`),
        baseline,
      ),
    ).toBe(false);
    expect(
      matchesCommittedReadme(
        baseline.replace("Read-only KEC index diagnostics", "changed"),
        baseline,
      ),
    ).toBe(false);
  });
});

describe("Ollama embedding smoke README product contract", () => {
  it("documents the exact short-lived command and fixed request behavior", () => {
    const section = task57Section(readText(readmePath));

    expect(section).toMatch(/#{1,6}\s+Ollama embedding smoke validation/iu);
    expect(
      section.match(/pnpm --filter @voltai\/mcp-kec smoke:ollama/gu),
    ).toHaveLength(1);
    expect(section).toMatch(/short-lived/iu);
    expect(section).toMatch(/not an MCP server|does not start an MCP server/iu);
    expect(section).toMatch(/at most one request|one request at most/iu);
    expect(section).toMatch(/no retr(?:y|ies)|does not retry/iu);
    expect(section).toContain("/api/embeddings");
    expect(section).toContain("volt-ai-ollama-embedding-smoke-v1");
    expect(section).toMatch(/fixed[\s\S]*non-PII/iu);
  });

  it("documents only the existing four settings, defaults, and strict failure policy", () => {
    const section = task57Section(readText(readmePath));

    for (const name of [
      "KEC_EMBED_PROVIDER",
      "OLLAMA_BASE_URL",
      "OLLAMA_EMBED_MODEL",
      "OLLAMA_EMBED_TIMEOUT_MS",
    ]) {
      expect(section).toContain(name);
    }
    expect(section).toContain("KEC_EMBED_PROVIDER=ollama");
    expect(section).toContain("http://localhost:11434");
    expect(section).toContain("nomic-embed-text");
    expect(section).toMatch(/30000\s*(?:ms|milliseconds)/iu);
    expect(section).toMatch(
      /invalid configured values?[\s\S]*(?:fail|reject)[\s\S]*(?:not|instead of)[\s\S]*(?:default|fallback)/iu,
    );
    expect(section).not.toMatch(/new environment variable/iu);
    expect(section).not.toMatch(/PROJECT_ROOT|KEC_DB_PATH/iu);
  });

  it("documents the exact redacted success and failure output contract", () => {
    const section = task57Section(readText(readmePath));

    for (const field of [
      "schemaVersion",
      "READY",
      "provider",
      "ollama",
      "observedDimension",
    ]) {
      expect(section).toContain(field);
    }
    for (const failure of [
      "INVALID_CONFIGURATION",
      "ENDPOINT_UNAVAILABLE",
      "REQUEST_TIMEOUT",
      "REQUEST_REJECTED",
      "INVALID_RESPONSE",
      "INTERNAL_ERROR",
    ]) {
      expect(section).toContain(failure);
    }
    expect(section).toMatch(/success[\s\S]*exit(?:s)?[\s\S]*(?:code\s*)?0/iu);
    expect(section).toMatch(/failures?[\s\S]*exit(?:s)?[\s\S]*(?:code\s*)?1/iu);
    expect(section).toMatch(
      /does not print[\s\S]*(?:endpoint|model|vector|response body|error details)/iu,
    );
  });

  it("documents scope exclusions and the Task 55/56 responsibility boundary", () => {
    const section = task57Section(readText(readmePath));

    expect(section).toMatch(/does not[\s\S]*SQLite/iu);
    expect(section).toMatch(/does not[\s\S]*index(?:ing)?/iu);
    expect(section).toMatch(/does not[\s\S]*search/iu);
    expect(section).toMatch(/does not[\s\S]*project files?/iu);
    expect(section).toMatch(/does not[\s\S]*MCP/iu);
    expect(section).toMatch(/does not[\s\S]*(?:pull|install)[\s\S]*model/iu);
    expect(section).toMatch(/does not[\s\S]*(?:repair|reindex)/iu);
    expect(section).toMatch(/Task 55[\s\S]*index write compatibility/iu);
    expect(section).toMatch(/Task 56[\s\S]*existing index diagnostics/iu);
  });

  it("states every external-assumption and evidence limitation", () => {
    const section = task57Section(readText(readmePath));

    expect(section).toMatch(
      /server-side[\s\S]*(?:model loading|cache|pull)[\s\S]*(?:outside|not guaranteed)/iu,
    );
    expect(section).toMatch(
      /\/api\/embeddings[\s\S]*(?:version|configuration|installed)/iu,
    );
    expect(section).toMatch(/READY[\s\S]*usable vector response/iu);
    expect(section).toMatch(/no[\s\S]*retrieval-quality guarantee/iu);
    expect(section).toMatch(/no[\s\S]*index-compatibility guarantee/iu);
    expect(section).not.toMatch(/dimension is stable|never triggers? pull/iu);
    expect(section).not.toMatch(/\/Users\/|[A-Za-z]:\\/u);
  });

  it("mentions the supported command only inside the Task 57 section", () => {
    const readme = readText(readmePath);
    const section = task57Section(readme);

    expect(section).toContain(command);
    expect(readme.replace(section, "")).not.toContain(command);
  });
});

describe("Ollama embedding smoke public compatibility boundary", () => {
  it("reserves only the approved CLI without package-root or runtime registration", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
    const packageIndex = readText(packageIndexPath);
    const defaultRuntime = readText(defaultRuntimePath);
    const hybridRuntime = readText(hybridRuntimePath);

    expect(packageIndex).not.toMatch(
      /smokeOllamaEmbedding|runOllamaEmbeddingSmokeCli/iu,
    );
    expect(defaultRuntime).not.toContain("smoke:ollama");
    expect(hybridRuntime).not.toContain("smoke:ollama");
  });

  it("leaves provider, environment, Docker, root package, and lockfile byte-identical", () => {
    for (const [path, relativePath] of [
      [providerPath, "packages/mcp-kec/src/knowledge/embedding.ts"],
      [environmentExamplePath, ".env.example"],
      [dockerfilePath, "Dockerfile"],
      [dockerComposePath, "docker-compose.yml"],
      [rootPackageJsonPath, "package.json"],
      [lockfilePath, "pnpm-lock.yaml"],
    ] as const) {
      expect(readText(path)).toBe(readHeadFile(relativePath));
    }
  });
});
