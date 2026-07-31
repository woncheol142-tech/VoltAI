import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type {
  KecSearchResult,
  VectorStore,
} from "../src/knowledge/vectorStore.js";
import {
  createSearchKecTool,
  searchKec,
  type SearchKecDependencies,
  type SearchKecInput,
} from "../src/tools/searchKec.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const packagesRoot = join(workspaceRoot, "packages");
const packageSourceRoot = join(packageRoot, "src");
const rankingRoot = join(packageRoot, "src", "searchRanking");
const packageIndex = join(packageRoot, "src", "index.ts");
const searchKecFile = join(packageRoot, "src", "tools", "searchKec.ts");
const hybridToolFile = join(packageSourceRoot, "tools", "searchKecHybrid.ts");
const hybridEntryPointFile = join(
  packageSourceRoot,
  "searchEntryPoints",
  "searchKecHybrid.ts",
);
const hybridIntegrationFile = join(
  packageSourceRoot,
  "searchIntegration",
  "existingKecHybridSearch.ts",
);
const legacyRuntimeFiles = [
  searchKecFile,
  join(packageRoot, "src", "knowledge", "embedding.ts"),
  join(packageRoot, "src", "knowledge", "vectorStore.ts"),
  join(packageRoot, "src", "knowledge", "sqliteVectorStore.ts"),
  join(packageRoot, "src", "searchFoundation", "types.ts"),
  join(packageRoot, "src", "searchFoundation", "semanticSearcher.ts"),
  join(packageRoot, "src", "searchFoundation", "lexicalSearcher.ts"),
  join(packageRoot, "src", "searchFoundation", "rankingStrategy.ts"),
  join(packageRoot, "src", "searchFoundation", "index.ts"),
  join(packageRoot, "src", "searchHybrid", "types.ts"),
  join(packageRoot, "src", "searchHybrid", "mergeCandidates.ts"),
  join(packageRoot, "src", "searchHybrid", "hybridSearch.ts"),
  join(packageRoot, "src", "searchHybrid", "index.ts"),
];
const task48ProductionFiles = [
  join(rankingRoot, "types.ts"),
  join(rankingRoot, "validateWeightedRanking.ts"),
  join(rankingRoot, "weightedRanking.ts"),
  join(rankingRoot, "index.ts"),
];

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

function parseSource(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function importsNamedFromRanking(path: string, exportedName: string): boolean {
  return parseSource(path)
    .statements.filter(ts.isImportDeclaration)
    .some((declaration) => {
      if (
        !ts.isStringLiteral(declaration.moduleSpecifier) ||
        !declaration.moduleSpecifier.text.split("/").includes("searchRanking")
      ) {
        return false;
      }

      const bindings = declaration.importClause?.namedBindings;

      return (
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(
          (element) =>
            (element.propertyName?.text ?? element.name.text) === exportedName,
        )
      );
    });
}

function productionSources(): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => sourceFiles(join(packagesRoot, entry.name, "src")));
}

function rankingImportConsumers(exportedName: string): string[] {
  return productionSources()
    .filter((path) => !path.startsWith(`${rankingRoot}/`))
    .filter((path) => importsNamedFromRanking(path, exportedName))
    .map((path) => relative(workspaceRoot, path))
    .sort();
}

function packageRootExportNames(): string[] {
  const names: string[] = [];

  for (const statement of parseSource(packageIndex).statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      names.push(
        ...statement.exportClause.elements.map((element) => element.name.text),
      );
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const exported = modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );

    if (
      exported &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text);
    }
  }

  return names.sort();
}

function expectTask48ProductionUnchanged(): void {
  for (const diffMode of [[], ["--cached"]]) {
    expect(() =>
      execFileSync(
        "git",
        ["diff", ...diffMode, "--exit-code", "--", ...task48ProductionFiles],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  }
}

describe("KEC weighted ranking compatibility and dependency boundaries", () => {
  it("reserves exactly the four approved production modules", () => {
    expect(existsSync(rankingRoot)).toBe(true);
    expect(
      sourceFiles(rankingRoot)
        .map((path) => path.slice(rankingRoot.length + 1))
        .sort(),
    ).toEqual([
      "index.ts",
      "types.ts",
      "validateWeightedRanking.ts",
      "weightedRanking.ts",
    ]);
  });

  it("allows only Task 46 type imports and internal ranking modules", () => {
    const sources = sourceFiles(rankingRoot);

    expect(sources).toHaveLength(4);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1]!,
      );

      for (const specifier of specifiers) {
        if (specifier.startsWith("./")) {
          continue;
        }

        expect(specifier).toBe("../searchFoundation/index.js");
        expect(source).toMatch(/import\s+type/);
      }
    }
  });

  it("keeps ranking free of providers, orchestration, infrastructure, and side effects", () => {
    const sources = sourceFiles(rankingRoot);
    const forbiddenPatterns = [
      /\bsearchKec\b/,
      /\bsearchHybrid\b/,
      /\bEmbeddingProvider\b/,
      /\bVectorStore\b/,
      /\bSqlite\b/i,
      /\bOpenAI\b/,
      /\bfetch\s*\(/,
      /https?:\/\//,
      /from\s+["']node:(?:fs|path|crypto|http|https)/,
      /@modelcontextprotocol/,
      /\bWeakMap\b/,
      /\bcache\b/i,
      /\bretry\b/i,
      /\bset(?:Timeout|Interval)\b/,
      /\bRRF\b/i,
      /\bReciprocalRankFusion\b/i,
      /\brerank/i,
      /\bRankingPolicy\b/,
      /\.trim\s*\(/,
      /\.normalize\s*\(/,
      /\blocaleCompare\b/,
      /console\./,
    ];

    expect(sources).toHaveLength(4);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");

      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("does not expose weightedScore or add a package-root export", () => {
    const rootIndex = readFileSync(packageIndex, "utf8");
    const hybridTool = readFileSync(hybridToolFile, "utf8");
    const hybridEntryPoint = readFileSync(hybridEntryPointFile, "utf8");
    const hybridIntegration = readFileSync(hybridIntegrationFile, "utf8");

    for (const path of legacyRuntimeFiles) {
      expect(readFileSync(path, "utf8")).not.toContain("searchRanking");
    }

    const publicSources = [
      join(rankingRoot, "types.ts"),
      join(rankingRoot, "index.ts"),
    ]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(publicSources).not.toContain("weightedScore");
    expect(publicSources).not.toContain("KecWeightedRankCandidate");
    expect(publicSources).not.toContain("KecWeightedRankingRequest");

    expect(rankingImportConsumers("KecWeightedRankingOptions")).toEqual([
      "packages/mcp-kec/src/index.ts",
      "packages/mcp-kec/src/searchEntryPoints/searchKecHybrid.ts",
      "packages/mcp-kec/src/searchIntegration/existingKecHybridSearch.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]);
    expect(rankingImportConsumers("createKecWeightedRankingStrategy")).toEqual([
      "packages/mcp-kec/src/searchIntegration/existingKecHybridSearch.ts",
    ]);

    const rootExports = packageRootExportNames();
    expect(rootExports).toEqual([
      "EmbeddingProvider",
      "KecKnowledgeMetadata",
      "KecSearchResult",
      "SqliteVectorStore",
      "VectorStore",
      "createEmbeddingProviderFromEnv",
      "createServer",
      "kecChunkToKnowledgeChunk",
      "kecEmbeddedChunkToKnowledgeEmbeddedChunk",
      "kecIndexMetadataToKnowledgeIndexMetadata",
      "kecKnowledgeCodecs",
      "kecSearchResultToKnowledgeSearchResult",
      "knowledgeChunkToKecChunk",
      "knowledgeEmbeddedChunkToKecEmbeddedChunk",
      "knowledgeIndexMetadataToKecIndexMetadata",
      "knowledgeSearchResultToKecSearchResult",
      "main",
      "searchKec",
    ]);
    expect(rootExports).not.toEqual(
      expect.arrayContaining([
        "createKecWeightedRankingStrategy",
        "createSearchKecHybridTool",
        "KecHybridSearchResult",
        "KecWeightedRankingOptions",
        "searchKecHybrid",
        "SearchKecHybridInput",
        "SearchKecHybridToolDependencies",
        "SearchKecHybridToolResult",
      ]),
    );

    expect(rootIndex).toMatch(
      /hybridSearch\?: Readonly<\{[\s\S]*rankingOptions: KecWeightedRankingOptions;/u,
    );
    expect(rootIndex).toMatch(
      /if \(options\?\.hybridSearch\) \{\s*tools\.push\(createSearchKecHybridTool\(options\.hybridSearch\)\);\s*\}/u,
    );
    expect(rootIndex).toMatch(/runStdioServer\(createServer\(\)\)/u);

    expect(hybridTool).toMatch(
      /inputSchema: \{\s*query: z\.string\(\)\.min\(1\)\.max\(4096\),\s*limit: z\.number\(\)\.int\(\)\.min\(0\)\.max\(100\),\s*\}/u,
    );
    expect(hybridTool).toMatch(
      /searchKecHybrid\([\s\S]*dependencies\.rankingOptions,[\s\S]*\)/u,
    );
    expect(hybridEntryPoint).toMatch(
      /createExistingKecHybridSearch\(\s*dependencies,\s*rankingOptions,?\s*\)\.search\(\s*request,?\s*\)/u,
    );
    expect(hybridIntegration).toMatch(
      /createKecWeightedRankingStrategy\(rankingOptions\)/u,
    );

    for (const source of [
      rootIndex,
      hybridTool,
      hybridEntryPoint,
      hybridIntegration,
    ]) {
      expect(source).not.toMatch(
        /semanticWeight|lexicalWeight|process\.env\.[A-Z_]*WEIGHT/u,
      );
    }
    expect(hybridTool).not.toMatch(
      /createKecWeightedRankingStrategy|validateWeightedRanking|weightedScore|normalizedScore|combinedScore|scoreMode|threshold|similarity/u,
    );
  });

  it("preserves legacy contracts without coupling Task 48 to its runtime", async () => {
    expectTypeOf<SearchKecInput>().toEqualTypeOf<{
      question?: string;
      query?: string;
      topK?: number;
    }>();
    expectTypeOf<SearchKecDependencies>().toEqualTypeOf<{
      embeddingProvider: EmbeddingProvider;
      vectorStore: VectorStore;
    }>();
    expectTypeOf<KecSearchResult>().toEqualTypeOf<{
      clause: string | null;
      page: number;
      text: string;
      similarity: number;
      sourcePath: string;
    }>();
    expectTypeOf<typeof searchKec>().toEqualTypeOf<
      (
        input: unknown,
        dependencies: SearchKecDependencies,
      ) => Promise<KecSearchResult[]>
    >();

    const tool = createSearchKecTool();
    expect(tool.name).toBe("search_kec");
    expect(Object.keys(tool.inputSchema)).toEqual(["query", "topK"]);
    expect(tool.inputSchema.query.safeParse("cable").success).toBe(true);
    expect(tool.inputSchema.query.safeParse("").success).toBe(false);
    expect(tool.inputSchema.topK.safeParse(undefined).success).toBe(true);
    expect(tool.inputSchema.topK.safeParse(1).success).toBe(true);
    expect(tool.inputSchema.topK.safeParse(0).success).toBe(false);
    expect(tool.inputSchema.topK.safeParse(1.5).success).toBe(false);

    expectTask48ProductionUnchanged();

    for (const path of legacyRuntimeFiles) {
      expect(readFileSync(path, "utf8")).not.toMatch(
        /KecWeightedRankingOptions|createKecWeightedRankingStrategy|semanticWeight|lexicalWeight|weightedScore/u,
      );
    }

    expect(readFileSync(searchKecFile, "utf8")).not.toMatch(
      /semanticScore|lexicalScore/u,
    );

    for (const path of [
      ...sourceFiles(join(packagesRoot, "mcp-agent", "src")),
      ...sourceFiles(join(packagesRoot, "agent-review", "src")),
    ]) {
      expect(readFileSync(path, "utf8")).not.toMatch(
        /KecWeightedRankingOptions|createKecWeightedRankingStrategy|semanticWeight|lexicalWeight|weightedScore|semanticScore|lexicalScore/u,
      );
    }

    const expectedResults: KecSearchResult[] = [
      {
        clause: "KEC 232.5",
        page: 3,
        text: "Cable sizing requirement.",
        similarity: 0.92,
        sourcePath: "knowledge/kec.pdf",
      },
    ];
    const dependencies: SearchKecDependencies = {
      embeddingProvider: {
        embed: async () => [1, 0, 0],
        getMetadata: () => ({ provider: "test", model: "fixed" }),
      },
      vectorStore: {
        upsert: async () => {},
        replaceSource: async () => {},
        deleteBySourcePath: async () => {},
        search: async () => expectedResults,
        listChunks: async () => [],
        saveIndexMetadata: async () => {},
        getIndexMetadata: async () => ({
          embeddingProvider: "test",
          embeddingModel: "fixed",
          dimensions: 3,
          indexedAt: "2026-07-28T00:00:00.000Z",
        }),
        close: async () => {},
      },
    };

    const results = await searchKec({ query: "cable", topK: 3 }, dependencies);
    expect(results).toBe(expectedResults);
    expect(results[0]).toBe(expectedResults[0]);

    await expect(
      searchKec(
        { query: "cable", topK: 3 },
        {
          ...dependencies,
          vectorStore: {
            ...dependencies.vectorStore,
            getIndexMetadata: async () => null,
          },
        },
      ),
    ).rejects.toThrow(
      "KEC index embedding metadata mismatch. Please re-run index_kec.",
    );
  });
});
