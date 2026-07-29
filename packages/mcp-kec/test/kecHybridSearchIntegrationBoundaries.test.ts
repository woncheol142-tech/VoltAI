import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const integrationRoot = join(sourceRoot, "searchIntegration");
const integrationSource = join(integrationRoot, "existingKecHybridSearch.ts");
const packageIndex = join(sourceRoot, "index.ts");
const legacySearch = join(sourceRoot, "tools", "searchKec.ts");

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

function readIntegrationSource(): string {
  expect(existsSync(integrationSource)).toBe(true);
  expect(statSync(integrationSource).isFile()).toBe(true);
  return readFileSync(integrationSource, "utf8");
}

const protectedProductionPaths = [
  join(sourceRoot, "searchFoundation"),
  join(sourceRoot, "searchHybrid"),
  join(sourceRoot, "searchRanking"),
  join(sourceRoot, "searchSemantic"),
  join(sourceRoot, "searchLexical"),
  join(sourceRoot, "searchAdapters"),
  legacySearch,
  packageIndex,
  join(workspaceRoot, "packages", "knowledge-core"),
  join(workspaceRoot, "packages", "knowledge-sqlite"),
  join(packageRoot, "package.json"),
  join(workspaceRoot, "package.json"),
  join(workspaceRoot, "pnpm-lock.yaml"),
  join(workspaceRoot, "README.md"),
];

describe("KEC hybrid search integration architecture boundaries", () => {
  it("reserves exactly the approved three-file production namespace", () => {
    expect(existsSync(integrationRoot)).toBe(true);
    expect(
      sourceFiles(integrationRoot)
        .map((path) => path.slice(integrationRoot.length + 1))
        .sort(),
    ).toEqual(["existingKecHybridSearch.ts", "index.ts", "types.ts"]);
  });

  it("uses every approved existing composition authority", () => {
    const source = readIntegrationSource();

    expect(source).toMatch(/\bcreateExistingSemanticSearcher\b/);
    expect(source).toMatch(/\bcreateExistingLexicalSearcher\b/);
    expect(source).toMatch(/\bsearchKecLexically\b/);
    expect(source).toMatch(/\bcreateKecWeightedRankingStrategy\b/);
    expect(source).toMatch(/\bcreateKecHybridSearchOrchestrator\b/);
    expect(source).toMatch(/\bkecKnowledgeCodecs\b/);
  });

  it("binds only the approved generic store methods", () => {
    const source = readIntegrationSource();

    expect(source.match(/\.getIndexMetadata\s*\(/g)).toHaveLength(1);
    expect(source.match(/\.search\s*\(/g)).toHaveLength(1);
    expect(
      source.match(
        /dependencies\.vectorStore\.listChunks(?:<[\s\S]*?>)?\s*\(/g,
      ),
    ).toHaveLength(1);
    expect(source).not.toMatch(
      /\.(?:upsert|replaceSource|deleteBySourcePath|saveIndexMetadata|close)\s*\(/,
    );
  });

  it("does not duplicate semantic, lexical, merge, or ranking implementation", () => {
    const source = readIntegrationSource();

    expect(source).not.toMatch(
      /executeKecSemanticSearch|tokenizeKecLexicalText|scoreKecLexicalChunk|mergeCandidates|validateWeightedRankCandidate/,
    );
    expect(source).not.toMatch(
      /\.sort\s*\(|\.reverse\s*\(|localeCompare|comparator|weightedScore/,
    );
    expect(source).not.toMatch(/\bPromise\.(?:all|allSettled|race|any)\b/);
  });

  it("adds no integration-level validation, limit policy, or projection", () => {
    const source = readIntegrationSource();

    expect(source).not.toMatch(
      /Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf)|Reflect\.|Proxy|structuredClone/,
    );
    expect(source).not.toMatch(
      /Number\.(?:isFinite|isInteger|isSafeInteger)|Math\.(?:min|max|round|floor|ceil)/,
    );
    expect(source).not.toMatch(
      /\blimit\s*(?:===|!==|<=|>=|<|>)|defaultLimit|MAX_LIMIT/,
    );
    expect(source).not.toMatch(
      /\.(?:trim|trimStart|trimEnd|normalize|toLowerCase|toUpperCase)\s*\(/,
    );
  });

  it("adds no error wrapper, retry, fallback, logging, cache, or telemetry", () => {
    const source = readIntegrationSource();

    expect(source).not.toMatch(
      /\bcatch\b|\bthrow\b|new\s+Error|AggregateError|retry|fallback|console|logger|telemetry/i,
    );
    expect(source).not.toMatch(
      /\bWeakMap\b|\bWeakSet\b|new\s+(?:Map|Set)\b|cache|registry|singleton/i,
    );
    expect(source).not.toMatch(/setTimeout|setInterval/);
  });

  it("adds no filesystem, network, SQL, FTS, process, or dynamic-code authority", () => {
    const source = sourceFiles(integrationRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /node:(?:fs|path|child_process|net|http|https|vm|worker_threads)|\bfetch\s*\(|XMLHttpRequest|WebSocket/,
    );
    expect(source).not.toMatch(
      /\b(?:eval|Function)\s*\(|new\s+Function|process\.env/,
    );
    expect(source).not.toMatch(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|MATCH|NEAR|SQLite|FTS)\b/i,
    );
  });

  it("adds no random, timestamp, hash, or environment-dependent ordering", () => {
    const source = readIntegrationSource();

    expect(source).not.toMatch(
      /Date(?:\.now)?|performance\.now|Math\.random|randomUUID|createHash|node:crypto/,
    );
    expect(source).not.toMatch(
      /Intl\.|localeCompare|process\.(?:env|platform)/,
    );
  });

  it("does not clone, freeze, assign, or dynamically write dependencies and results", () => {
    const source = readIntegrationSource();

    expect(source).not.toMatch(
      /Object\.(?:assign|freeze|seal|preventExtensions)|structuredClone/,
    );
    expect(source).not.toMatch(/\.\.\./);
    expect(source).not.toMatch(/\[[^\]]+\]\s*=/);
  });

  it("does not own provider or store construction and lifecycle", () => {
    const source = readIntegrationSource();

    expect(source).not.toMatch(
      /SqliteKnowledgeStore|SqliteVectorStore|createEmbeddingProviderFromEnv|LocalPlaceholderEmbeddingProvider|OllamaEmbeddingProvider/,
    );
    expect(source).not.toMatch(/\bnew\s+[A-Z]/);
    expect(source).not.toMatch(/\bclose\b|\bdispose\b|\bcleanup\b|\bconnect\b/);
  });

  it("keeps the integration internal to its namespace", () => {
    const packageSource = readFileSync(packageIndex, "utf8");

    expect(packageSource).not.toMatch(
      /searchIntegration|createExistingKecHybridSearch|ExistingKecHybridSearchDependencies/,
    );
  });

  it("does not connect or modify the legacy MCP search path", () => {
    const source = readIntegrationSource();
    const legacySource = readFileSync(legacySearch, "utf8");
    const packageSource = readFileSync(packageIndex, "utf8");

    expect(source).not.toMatch(
      /\bsearchKec\b|createSearchKecTool|search_kec|@modelcontextprotocol|VoltAiTool/,
    );
    expect(legacySource).not.toMatch(
      /searchIntegration|createExistingKecHybridSearch/,
    );
    expect(packageSource).not.toMatch(
      /searchIntegration|createExistingKecHybridSearch/,
    );
  });

  it("keeps every existing production and workspace boundary HEAD-stable", () => {
    expect(() =>
      execFileSync(
        "git",
        ["diff", "--exit-code", "HEAD", "--", ...protectedProductionPaths],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
    expect(() =>
      execFileSync(
        "git",
        [
          "diff",
          "--cached",
          "--exit-code",
          "HEAD",
          "--",
          ...protectedProductionPaths,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("contains no generated, binary, schema, config, or dependency artifact", () => {
    const files = sourceFiles(integrationRoot);

    expect(files).toHaveLength(3);
    expect(
      files.every((path) => extname(path) === ".ts" && statSync(path).isFile()),
    ).toBe(true);
    expect(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ).not.toContain("searchIntegration");
  });
});
