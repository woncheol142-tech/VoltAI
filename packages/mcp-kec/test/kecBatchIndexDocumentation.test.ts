import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  addTask58PackageScript,
  addTask58ReadmeSection,
  addTask59PackageScript,
  addTask59ReadmeBlock,
  captureTask58ArtifactBoundary,
  createKecBatchIndexFixture,
  normalizeTask58PackageBaseline,
  normalizeTask58ReadmeBaseline,
  removeTask58PackageScript,
  removeTask58ReadmeSection,
  removeTask59PackageScript,
  removeTask59ReadmeSection,
  task58PackageScriptName,
  task58PackageScriptValue,
  task58ReadmeEnd,
  task58ReadmeStart,
  task59ReadmeBlock,
} from "./helpers/kecBatchIndexFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const packagePath = join(packageRoot, "package.json");
const rootPackagePath = join(workspaceRoot, "package.json");
const lockfilePath = join(workspaceRoot, "pnpm-lock.yaml");
const readmePath = join(workspaceRoot, "README.md");
const task57ReadmeEnd = "<!-- TASK57_OLLAMA_EMBEDDING_SMOKE_END -->";
const command = "pnpm --filter @voltai/mcp-kec index:batch kec/a.pdf kec/b.pdf";
const brokenCommand =
  "pnpm --filter @voltai/mcp-kec index:batch -- kec/a.pdf kec/b.pdf";
const compatibilityFiles = [
  "kecHybridSearchIntegrationBoundaries.test.ts",
  "kecNativeHybridSearchEntryPointBoundaries.test.ts",
  "kecIndexWriteCompatibilityBoundaries.test.ts",
  "kecIndexDiagnosticsDocumentation.test.ts",
  "kecOllamaEmbeddingSmokeDocumentation.test.ts",
] as const;
const canonicalSection = `### Deterministic explicit KEC batch indexing

Run repeated canonical project-relative PDF source paths explicitly:

\`\`\`bash
${command}
\`\`\`

PROJECT_ROOT is required. The command reuses KEC_DB_PATH, KEC_EMBED_PROVIDER, OLLAMA_BASE_URL, OLLAMA_EMBED_MODEL, OLLAMA_EMBED_TIMEOUT_MS, KEC_EMBED_CONCURRENCY, KEC_EMBED_MAX_ATTEMPTS, and KEC_EMBED_RETRY_DELAY_MS. It preserves deterministic sourceId ordering, processes sources sequentially with no source-level concurrency, and delegates only existing per-chunk retry behavior to Task 55.

Each source uses the existing one-source transaction semantics. The batch fails fast: already committed sources remain, the failing source is FAILED, and later sources are NOT_ATTEMPTED. There is no whole-batch atomicity, rollback of earlier sources, or continue-on-error behavior.

SUCCEEDED exits 0. Configuration or batch-level errors exit 1. PARTIAL and source-level FAILED results exit 2. Completed results are one JSON document on stdout; fixed errors use stderr. Raw source paths are not output. sourceId values are deterministic pseudonyms, not anonymous identifiers.

The command performs no directory traversal, globbing, discovery, manifest input, unchanged-file detection, stale-source deletion, content deduplication, resume, checkpoint, or source-level retry. It does not run the Task 57 smoke automatically, fall back to another provider, pull or start a model, or register MCP/search tools. Task 55 owns write compatibility, Task 56 remains the separate diagnostics command, and Task 57 remains the separate Ollama smoke validation command.`;

type PackageJson = Readonly<{
  scripts: Readonly<Record<string, string>>;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  [key: string]: unknown;
}>;

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function task58Section(readme: string): string {
  const start = readme.indexOf(task58ReadmeStart);
  const end = readme.indexOf(task58ReadmeEnd, start);
  if (start < 0 || end <= start) return "";
  return readme.slice(start, end + task58ReadmeEnd.length);
}

function task58SectionBody(readme: string): string {
  const section = task58Section(readme);
  const start = `${task58ReadmeStart}\n`;
  const end = `\n${task58ReadmeEnd}`;
  if (!section.startsWith(start) || !section.endsWith(end)) return "";
  return section.slice(start.length, -end.length);
}

function currentPackageHasTask58Script(): boolean {
  const manifest = JSON.parse(readText(packagePath)) as PackageJson;
  return manifest.scripts[task58PackageScriptName] === task58PackageScriptValue;
}

function currentReadmeHasTask58Section(): boolean {
  const readme = readText(readmePath);
  return (
    readme.split(task58ReadmeStart).length === 2 &&
    readme.split(task58ReadmeEnd).length === 2 &&
    readme.indexOf(task58ReadmeEnd) > readme.indexOf(task58ReadmeStart)
  );
}

function runPackageCommand(
  arguments_: readonly string[],
  paths: Readonly<{ projectRoot: string; databasePath: string }>,
): Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const result = spawnSync(
    "pnpm",
    ["--filter", "@voltai/mcp-kec", "index:batch", ...arguments_],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PROJECT_ROOT: paths.projectRoot,
        KEC_DB_PATH: paths.databasePath,
        KEC_EMBED_PROVIDER: "invalid",
      },
      timeout: 10_000,
    },
  );
  expect(result.error).toBeUndefined();
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("Task 58 package-local command RED contract", () => {
  it("is intentionally RED until the exact index:batch script exists", () => {
    expect(currentPackageHasTask58Script()).toBe(true);
  });

  it("reconstructs the committed manifest after removing exactly the future script", () => {
    const committed = readText(packagePath);
    const preTask59 = removeTask59PackageScript(committed);
    const baseline = normalizeTask58PackageBaseline(preTask59);
    const task58Future = addTask58PackageScript(baseline);
    const reconstructed = addTask59PackageScript(task58Future);
    const parsed = JSON.parse(reconstructed) as PackageJson;

    expect(task58Future).toBe(preTask59);
    expect(reconstructed).toBe(committed);
    expect(parsed.scripts[task58PackageScriptName]).toBe(
      task58PackageScriptValue,
    );
    expect(removeTask58PackageScript(task58Future)).toBe(baseline);
    expect(parsed.dependencies).toEqual(
      (JSON.parse(baseline) as PackageJson).dependencies,
    );
    expect(parsed.devDependencies).toEqual(
      (JSON.parse(baseline) as PackageJson).devDependencies,
    );
  });

  it("accepts only the exact script line and rejects malformed or duplicate deltas", () => {
    const baseline = normalizeTask58PackageBaseline(
      removeTask59PackageScript(readText(packagePath)),
    );
    const future = addTask58PackageScript(baseline);

    expect(() => removeTask58PackageScript(baseline)).toThrow();
    expect(() =>
      removeTask58PackageScript(
        future.replace(task58PackageScriptValue, "tsx src/wrong.ts"),
      ),
    ).toThrow();
    expect(
      removeTask58PackageScript(
        future.replace(
          '    "test":',
          '    "fake:task58": "tsx fake.ts",\n    "test":',
        ),
      ),
    ).not.toBe(baseline);
    expect(
      removeTask58PackageScript(
        future.replace(
          '  "dependencies":',
          '  "task58Unexpected": true,\n  "dependencies":',
        ),
      ),
    ).not.toBe(baseline);
    expect(() =>
      removeTask58PackageScript(
        future.replace(
          '    "test":',
          `    "${task58PackageScriptName}": "${task58PackageScriptValue}",\n    "test":`,
        ),
      ),
    ).toThrow();
  });

  it("protects all existing scripts, lifecycle hooks, dependencies, root package, and lockfile", () => {
    const committed = readText(packagePath);
    const preTask59 = removeTask59PackageScript(committed);
    const baselineText = normalizeTask58PackageBaseline(preTask59);
    const baseline = JSON.parse(baselineText) as PackageJson;
    const current = JSON.parse(committed) as PackageJson;

    for (const [name, value] of Object.entries(baseline.scripts)) {
      expect(current.scripts[name]).toBe(value);
    }
    for (const lifecycle of [
      "preindex:batch",
      "postindex:batch",
      "preinstall",
      "postinstall",
      "prepare",
    ]) {
      expect(current.scripts).not.toHaveProperty(lifecycle);
    }
    expect(current.dependencies).toEqual(baseline.dependencies);
    expect(current.devDependencies).toEqual(baseline.devDependencies);
    expect(addTask59PackageScript(addTask58PackageScript(baselineText))).toBe(
      committed,
    );
    expect(readText(rootPackagePath)).not.toContain(task58PackageScriptValue);
    expect(readText(lockfilePath)).not.toContain(task58PackageScriptValue);
  });
});

describe("Task 58 README RED and reconstruction contract", () => {
  it("is intentionally RED until one ordered Task 58 marker pair exists", () => {
    expect(currentReadmeHasTask58Section()).toBe(true);
  });

  it("places the exact future section after Task 57 and reconstructs HEAD byte-for-byte", () => {
    const committed = readText(readmePath);
    const task59Block = task59ReadmeBlock(committed);
    const preTask59 = removeTask59ReadmeSection(committed);
    const baseline = normalizeTask58ReadmeBaseline(preTask59);
    const task58Future = addTask58ReadmeSection(
      baseline,
      task58SectionBody(preTask59),
    );
    const reconstructed = addTask59ReadmeBlock(task58Future, task59Block);

    expect(task58Future).toBe(preTask59);
    expect(reconstructed).toBe(committed);
    expect(task58Future.split(task58ReadmeStart)).toHaveLength(2);
    expect(task58Future.split(task58ReadmeEnd)).toHaveLength(2);
    expect(task58Future.indexOf(task58ReadmeStart)).toBeGreaterThan(
      task58Future.indexOf(task57ReadmeEnd),
    );
    expect(removeTask58ReadmeSection(task58Future)).toBe(baseline);
  });

  it("rejects missing, duplicate, reversed, nested, and unrelated README mutations", () => {
    const baseline = normalizeTask58ReadmeBaseline(
      removeTask59ReadmeSection(readText(readmePath)),
    );
    const future = addTask58ReadmeSection(baseline, canonicalSection);

    expect(() => removeTask58ReadmeSection(baseline)).toThrow();
    expect(() =>
      removeTask58ReadmeSection(future.replace(task58ReadmeStart, "")),
    ).toThrow();
    expect(() =>
      removeTask58ReadmeSection(
        future.replace(
          task58ReadmeStart,
          `${task58ReadmeStart}\n${task58ReadmeStart}`,
        ),
      ),
    ).toThrow();
    expect(() =>
      removeTask58ReadmeSection(
        future
          .replace(task58ReadmeStart, "TASK58_MARKER_SWAP")
          .replace(task58ReadmeEnd, task58ReadmeStart)
          .replace("TASK58_MARKER_SWAP", task58ReadmeEnd),
      ),
    ).toThrow();
    expect(
      removeTask58ReadmeSection(
        future.replace(
          "VoltAI is released under the MIT License.",
          "VoltAI unrelated mutation.",
        ),
      ),
    ).not.toBe(baseline);
  });

  it("leaves every committed Task 51-57 README byte unchanged", () => {
    const committed = readText(readmePath);
    const task59Block = task59ReadmeBlock(committed);
    const preTask59 = removeTask59ReadmeSection(committed);
    const baseline = normalizeTask58ReadmeBaseline(preTask59);
    const task58Future = addTask58ReadmeSection(
      baseline,
      task58SectionBody(preTask59),
    );
    expect(task58Future).toBe(preTask59);
    expect(addTask59ReadmeBlock(task58Future, task59Block)).toBe(committed);
    expect(removeTask58ReadmeSection(task58Future)).toBe(baseline);
  });
});

describe("Task 58 operator documentation product contract", () => {
  it("forwards the corrected positional command without treating a literal double dash as syntax", () => {
    const fixture = createKecBatchIndexFixture();
    try {
      const paths = {
        projectRoot: fixture.projectRoot,
        databasePath: fixture.databasePath,
      } as const;
      const before = captureTask58ArtifactBoundary(fixture.projectRoot);
      const corrected = runPackageCommand(["kec/a.pdf", "kec/b.pdf"], paths);
      expect(corrected.status).toBe(1);
      expect(corrected.stdout).toContain(
        '> tsx src/indexKecBatch.ts "kec/a.pdf" "kec/b.pdf"',
      );
      expect(corrected.stdout).not.toContain('> tsx src/indexKecBatch.ts "--"');
      expect(corrected.stderr).toContain(
        "KEC_BATCH_INDEX: INVALID_CONFIGURATION",
      );
      expect(corrected.stderr).not.toContain(
        "KEC_BATCH_INDEX: INVALID_ARGUMENT",
      );

      const broken = runPackageCommand(["--", "kec/a.pdf", "kec/b.pdf"], paths);
      expect(broken.status).toBe(1);
      expect(broken.stdout).toContain(
        '> tsx src/indexKecBatch.ts "--" "kec/a.pdf" "kec/b.pdf"',
      );
      expect(broken.stderr).toContain("KEC_BATCH_INDEX: INVALID_ARGUMENT");
      expect(broken.stderr).not.toContain(
        "KEC_BATCH_INDEX: INVALID_CONFIGURATION",
      );
      expect(captureTask58ArtifactBoundary(fixture.projectRoot)).toBe(before);
    } finally {
      fixture.cleanup();
    }
  });

  it("documents the exact command, explicit sources, project-relative PDFs, and PROJECT_ROOT", () => {
    if (!currentReadmeHasTask58Section()) return;
    const section = task58Section(readText(readmePath));

    expect(
      section.match(
        /pnpm --filter @voltai\/mcp-kec index:batch kec\/a\.pdf kec\/b\.pdf/gu,
      ),
    ).toHaveLength(1);
    expect(section).not.toContain(brokenCommand);
    expect(section).toMatch(/repeated|multiple|one or more/iu);
    expect(section).toMatch(/canonical project-relative PDF/iu);
    expect(section).toContain("PROJECT_ROOT");
    for (const key of [
      "KEC_DB_PATH",
      "KEC_EMBED_PROVIDER",
      "OLLAMA_BASE_URL",
      "OLLAMA_EMBED_MODEL",
      "OLLAMA_EMBED_TIMEOUT_MS",
      "KEC_EMBED_CONCURRENCY",
      "KEC_EMBED_MAX_ATTEMPTS",
      "KEC_EMBED_RETRY_DELAY_MS",
    ]) {
      expect(section).toContain(key);
    }
  });

  it("documents deterministic sequential fail-fast and one-source transaction semantics", () => {
    if (!currentReadmeHasTask58Section()) return;
    const section = task58Section(readText(readmePath));

    expect(section).toMatch(/deterministic[\s\S]*sourceId[\s\S]*order/iu);
    expect(section).toMatch(/sequential/iu);
    expect(section).toMatch(
      /no source-(?:level )?concurrency|no source concurrency/iu,
    );
    expect(section).toMatch(/existing per-chunk retr(?:y|ies)/iu);
    expect(section).toMatch(/one-source transaction/iu);
    expect(section).toMatch(/fail(?:s)? fast/iu);
    expect(section).toMatch(/prior|already committed sources?[\s\S]*remain/iu);
    expect(section).toContain("NOT_ATTEMPTED");
  });

  it("documents all statuses, exit codes, stdout JSON, and fixed stderr errors", () => {
    if (!currentReadmeHasTask58Section()) return;
    const section = task58Section(readText(readmePath));

    for (const status of ["SUCCEEDED", "PARTIAL", "FAILED"]) {
      expect(section).toContain(status);
    }
    expect(section).toMatch(/SUCCEEDED[\s\S]*(?:exit|code)[\s\S]*0/iu);
    expect(section).toMatch(
      /(?:configuration|batch-level)[\s\S]*(?:exit|code)[\s\S]*1/iu,
    );
    expect(section).toMatch(
      /PARTIAL[\s\S]*FAILED[\s\S]*(?:exit|code)[\s\S]*2/iu,
    );
    expect(section).toMatch(/JSON[\s\S]*stdout/iu);
    expect(section).toMatch(/fixed[\s\S]*(?:errors?|messages?)[\s\S]*stderr/iu);
  });

  it("documents path redaction and the sourceId pseudonymity limitation", () => {
    if (!currentReadmeHasTask58Section()) return;
    const section = task58Section(readText(readmePath));

    expect(section).toMatch(
      /raw (?:source )?paths?[\s\S]*(?:not|never)[\s\S]*(?:output|print)/iu,
    );
    expect(section).toMatch(/sourceId[\s\S]*(?:pseudonym|not anonymous)/iu);
    expect(section).not.toMatch(/\/Users\/|[A-Za-z]:\\/u);
  });

  it("documents Task 55, 56, and 57 ownership without automatic smoke behavior", () => {
    if (!currentReadmeHasTask58Section()) return;
    const section = task58Section(readText(readmePath));

    expect(section).toMatch(/Task 55[\s\S]*write compatibility/iu);
    expect(section).toMatch(/Task 56[\s\S]*(?:separate|diagnostics)/iu);
    expect(section).toMatch(/Task 57[\s\S]*(?:separate|smoke)/iu);
    expect(section).toMatch(
      /does not[\s\S]*(?:automatically )?(?:run|invoke)[\s\S]*smoke/iu,
    );
  });

  it("documents every approved non-goal without overclaiming atomicity", () => {
    if (!currentReadmeHasTask58Section()) return;
    const section = task58Section(readText(readmePath));

    for (const phrase of [
      /no whole-batch atomicity/iu,
      /no (?:rollback of earlier sources|source rollback)/iu,
      /no continue-on-error/iu,
      /no directory[\s\S]*(?:glob|discovery)/iu,
      /no[\s\S]*manifest/iu,
      /no unchanged-(?:file )?detection/iu,
      /no stale-source deletion/iu,
      /no content deduplication/iu,
      /no[\s\S]*(?:resume|checkpoint)/iu,
      /no source-level retr(?:y|ies)/iu,
      /no (?:provider )?fallback/iu,
      /no[\s\S]*(?:model pull|pull[\s\S]*model)/iu,
      /no[\s\S]*(?:MCP|search)[\s\S]*(?:registration|tool)/iu,
    ]) {
      expect(section).toMatch(phrase);
    }
    expect(section).not.toMatch(
      /all-or-nothing|unchanged files? (?:are|will be) skipped|semantic quality|automatic (?:server|model) start/iu,
    );
  });
});

describe("Task 58 forward-compatible baseline remediation contract", () => {
  it.each(compatibilityFiles)(
    "%s permits only the exact Task 58 package and README delta",
    (fileName) => {
      const source = readText(join(packageRoot, "test", fileName));
      expect(source).toContain(task58ReadmeStart);
      expect(source).toContain(task58ReadmeEnd);
      expect(source).toContain(task58PackageScriptName);
      expect(source).toContain(task58PackageScriptValue);
    },
  );
});
