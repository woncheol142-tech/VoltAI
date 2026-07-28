import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src", "searchLexical");
const packageIndex = join(packageRoot, "src", "index.ts");
const adapterRoot = join(packageRoot, "src", "searchAdapters");
const adapterTypes = join(adapterRoot, "types.ts");
const adapterIndex = join(adapterRoot, "index.ts");
const semanticAdapter = join(adapterRoot, "existingSemanticSearchAdapter.ts");

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

const task50aRuntimeFiles = [
  join(sourceRoot, "types.ts"),
  join(sourceRoot, "tokenizeKecLexicalText.ts"),
  join(sourceRoot, "scoreKecLexicalChunk.ts"),
  join(sourceRoot, "searchKecLexically.ts"),
  join(sourceRoot, "index.ts"),
];

const immutableProtectedPaths = [
  ...task50aRuntimeFiles,
  join(packageRoot, "src", "searchFoundation"),
  join(packageRoot, "src", "searchHybrid"),
  join(packageRoot, "src", "searchRanking"),
  join(packageRoot, "src", "searchSemantic"),
  semanticAdapter,
  join(packageRoot, "src", "tools", "searchKec.ts"),
  join(workspaceRoot, "packages", "knowledge-core"),
  join(workspaceRoot, "packages", "knowledge-sqlite", "src", "schema.ts"),
  packageIndex,
  join(workspaceRoot, "package.json"),
  join(workspaceRoot, "pnpm-lock.yaml"),
];

function expectProtectedPathsUnchanged(): void {
  for (const diffMode of [[], ["--cached"]]) {
    expect(() =>
      execFileSync(
        "git",
        ["diff", ...diffMode, "--exit-code", "--", ...immutableProtectedPaths],
        {
          cwd: workspaceRoot,
          stdio: "pipe",
        },
      ),
    ).not.toThrow();
  }
}

describe("KEC lexical runtime compatibility and authority boundaries", () => {
  it("contains exactly the five approved namespace files", () => {
    expect(
      sourceFiles(sourceRoot)
        .map((path) => path.slice(sourceRoot.length + 1))
        .sort(),
    ).toEqual([
      "index.ts",
      "scoreKecLexicalChunk.ts",
      "searchKecLexically.ts",
      "tokenizeKecLexicalText.ts",
      "types.ts",
    ]);
  });

  it("keeps forbidden runtime authorities outside searchLexical", () => {
    const sources = sourceFiles(sourceRoot).map((path) =>
      readFileSync(path, "utf8"),
    );
    const forbidden = [
      /from\s+["']node:(?:fs|path|net|http|https|child_process|worker_threads)["']/u,
      /\bfetch\s*\(/u,
      /\beval\s*\(/u,
      /\bnew\s+Function\b/u,
      /\bSqlite/u,
      /\bEmbeddingProvider\b/u,
      /\bexecuteKecSemanticSearch\b/u,
      /searchAdapters/u,
      /searchHybrid/u,
      /searchRanking/u,
      /mcp-core/u,
      /\bWeakMap\b/u,
      /\blocaleCompare\s*\(/u,
      /\bIntl\.(?:Collator|Segmenter)\b/u,
    ];

    expect(sources).toHaveLength(5);
    for (const source of sources) {
      for (const pattern of forbidden) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("contains no SQL, FTS, vector, network, process, or cache implementation", () => {
    const source = sourceFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const pattern of [
      /\bSELECT\b/iu,
      /\bMATCH\b/iu,
      /\bbm25\b/iu,
      /\bfts5?\b/iu,
      /\bcosine\b/iu,
      /\bsimilarity\b/iu,
      /\bsetTimeout\b/u,
      /\bglobalThis\b/u,
    ]) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("uses an injected zero-argument chunk reader and does not expose package-root API", () => {
    const types = readFileSync(join(sourceRoot, "types.ts"), "utf8");
    const search = readFileSync(
      join(sourceRoot, "searchKecLexically.ts"),
      "utf8",
    );
    const rootIndex = readFileSync(packageIndex, "utf8");

    expect(types).toMatch(/\blistChunks\s*:/u);
    expect(search).not.toMatch(/["']kec["']/u);
    expect(search).not.toMatch(/\bkecKnowledgeCodecs\b/u);
    expect(rootIndex).not.toContain("./searchLexical");
  });

  it("includes the defensive score guard and approved deterministic boundaries", () => {
    const source = sourceFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).toContain("INVALID_KEC_LEXICAL_SCORE:");
    expect(source).toMatch(/\bNumber\.isFinite\s*\(/u);
    expect(source).toMatch(/\b4_?096\b/u);
    expect(source).toMatch(/\b64\b/u);
    expect(source).toMatch(/\b100\b/u);
    expect(source).not.toMatch(/\bObject\.assign\s*\(/u);
  });

  it("preserves immutable boundaries and the approved adapter extension", () => {
    const adapterFiles = readdirSync(adapterRoot).sort();
    const types = readFileSync(adapterTypes, "utf8");
    const index = readFileSync(adapterIndex, "utf8");
    const rootIndex = readFileSync(packageIndex, "utf8");

    expect(adapterFiles).toEqual([
      "existingLexicalSearchAdapter.ts",
      "existingSemanticSearchAdapter.ts",
      "index.ts",
      "types.ts",
    ]);
    expect(types).toMatch(
      /export type ExistingSemanticSearchAdapterDependencies\s*=\s*KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>;/u,
    );
    expect(types).toMatch(
      /export type ExistingLexicalSearchAdapterDependencies\s*=\s*Readonly<\{/u,
    );
    expect(index).toMatch(
      /export \{ createExistingSemanticSearcher \} from "\.\/existingSemanticSearchAdapter\.js";/u,
    );
    expect(index).toMatch(
      /export \{ createExistingLexicalSearcher \} from "\.\/existingLexicalSearchAdapter\.js";/u,
    );
    expect(index).toMatch(
      /export type \{[\s\S]*ExistingLexicalSearchAdapterDependencies,[\s\S]*ExistingSemanticSearchAdapterDependencies,[\s\S]*\} from "\.\/types\.js";/u,
    );
    expect(rootIndex).not.toMatch(
      /searchAdapters|createExistingLexicalSearcher|createExistingSemanticSearcher/u,
    );
    expectProtectedPathsUnchanged();
  });
});
