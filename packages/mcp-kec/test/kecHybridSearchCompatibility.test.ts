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
  createKecHybridSearchOrchestrator,
  type KecHybridSearchDependencies,
  type KecHybridSearchOrchestrator,
  type KecHybridSearchResult,
} from "../src/searchHybrid/index.js";
import type {
  KecLexicalSearcher,
  KecRankCandidate,
  KecRankingStrategy,
  KecSearchRequest,
  KecSemanticSearcher,
} from "../src/searchFoundation/index.js";
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
const hybridRoot = join(packageRoot, "src", "searchHybrid");
const semanticRoot = join(packageRoot, "src", "searchSemantic");
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
const legacyFiles = [
  searchKecFile,
  join(packageRoot, "src", "knowledge", "embedding.ts"),
  join(packageRoot, "src", "knowledge", "vectorStore.ts"),
  join(packageRoot, "src", "knowledge", "sqliteVectorStore.ts"),
  join(packageRoot, "src", "searchFoundation", "types.ts"),
  join(packageRoot, "src", "searchFoundation", "semanticSearcher.ts"),
  join(packageRoot, "src", "searchFoundation", "lexicalSearcher.ts"),
  join(packageRoot, "src", "searchFoundation", "rankingStrategy.ts"),
  join(packageRoot, "src", "searchFoundation", "index.ts"),
];
const task47ProductionFiles = [
  join(hybridRoot, "hybridSearch.ts"),
  join(hybridRoot, "index.ts"),
  join(hybridRoot, "mergeCandidates.ts"),
  join(hybridRoot, "types.ts"),
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

function moduleSpecifiers(path: string): string[] {
  return parseSource(path)
    .statements.filter(ts.isImportDeclaration)
    .map((declaration) => declaration.moduleSpecifier)
    .filter(ts.isStringLiteral)
    .map((specifier) => specifier.text);
}

function importsNamespace(path: string, namespace: string): boolean {
  return moduleSpecifiers(path).some((specifier) =>
    specifier.split("/").includes(namespace),
  );
}

function importsNamedFromHybrid(path: string, exportedName: string): boolean {
  return parseSource(path)
    .statements.filter(ts.isImportDeclaration)
    .some((declaration) => {
      if (
        !ts.isStringLiteral(declaration.moduleSpecifier) ||
        !declaration.moduleSpecifier.text.split("/").includes("searchHybrid")
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

function hybridNamespaceConsumers(): string[] {
  return productionSources()
    .filter((path) => !path.startsWith(`${hybridRoot}/`))
    .filter((path) => importsNamespace(path, "searchHybrid"))
    .map((path) => relative(workspaceRoot, path))
    .sort();
}

function hybridNamedImportConsumers(exportedName: string): string[] {
  return productionSources()
    .filter((path) => !path.startsWith(`${hybridRoot}/`))
    .filter((path) => importsNamedFromHybrid(path, exportedName))
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

function expectTask47ProductionUnchanged(): void {
  for (const diffMode of [[], ["--cached"]]) {
    expect(() =>
      execFileSync(
        "git",
        ["diff", ...diffMode, "--exit-code", "--", ...task47ProductionFiles],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  }
}

describe("KEC hybrid search compatibility and dependency boundaries", () => {
  it("reserves exactly the four approved production modules", () => {
    expect(existsSync(hybridRoot)).toBe(true);
    expect(
      sourceFiles(hybridRoot)
        .map((path) => path.slice(hybridRoot.length + 1))
        .sort(),
    ).toEqual([
      "hybridSearch.ts",
      "index.ts",
      "mergeCandidates.ts",
      "types.ts",
    ]);
  });

  it("keeps orchestration free of legacy, network, storage, cache, and timer dependencies", () => {
    const sources = sourceFiles(hybridRoot);
    const forbiddenPatterns = [
      /\bEmbeddingProvider\b/,
      /\bVectorStore\b/,
      /\bsearchKec\b/,
      /\bsearchSemantic\b/,
      /\bSqlite\b/i,
      /\bOpenAI\b/,
      /\bfetch\s*\(/,
      /https?:\/\//,
      /from\s+["']node:(?:fs|path|crypto|http|https)/,
      /\bWeakMap\b/,
      /\bcache\b/i,
      /\bretry\b/i,
      /\bset(?:Timeout|Interval)\b/,
      /\.trim\s*\(/,
      /\.normalize\s*\(/,
      /\blocaleCompare\b/,
      /@modelcontextprotocol/,
    ];

    expect(sources).toHaveLength(4);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");

      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("does not add a package-root export or connect existing runtime modules", () => {
    const hybridTool = readFileSync(hybridToolFile, "utf8");
    const hybridEntryPoint = readFileSync(hybridEntryPointFile, "utf8");
    const hybridIntegration = readFileSync(hybridIntegrationFile, "utf8");

    for (const path of legacyFiles) {
      expect(readFileSync(path, "utf8")).not.toContain("searchHybrid");
    }

    for (const path of sourceFiles(semanticRoot)) {
      expect(readFileSync(path, "utf8")).not.toContain("searchHybrid");
    }

    expect(hybridNamespaceConsumers()).toEqual([
      "packages/mcp-kec/src/searchEntryPoints/searchKecHybrid.ts",
      "packages/mcp-kec/src/searchIntegration/existingKecHybridSearch.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]);
    expect(
      hybridNamedImportConsumers("createKecHybridSearchOrchestrator"),
    ).toEqual([
      "packages/mcp-kec/src/searchIntegration/existingKecHybridSearch.ts",
    ]);
    expect(hybridNamedImportConsumers("KecHybridSearchResult")).toEqual([
      "packages/mcp-kec/src/searchEntryPoints/searchKecHybrid.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]);

    expect(importsNamespace(hybridToolFile, "searchEntryPoints")).toBe(true);
    expect(
      importsNamedFromHybrid(
        hybridToolFile,
        "createKecHybridSearchOrchestrator",
      ),
    ).toBe(false);
    expect(importsNamespace(hybridEntryPointFile, "searchIntegration")).toBe(
      true,
    );
    expect(
      importsNamedFromHybrid(
        hybridEntryPointFile,
        "createKecHybridSearchOrchestrator",
      ),
    ).toBe(false);
    expect(importsNamespace(hybridIntegrationFile, "searchHybrid")).toBe(true);
    expect(
      importsNamedFromHybrid(
        hybridIntegrationFile,
        "createKecHybridSearchOrchestrator",
      ),
    ).toBe(true);
    expect(importsNamespace(packageIndex, "searchHybrid")).toBe(false);

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
        "createExistingKecHybridSearch",
        "createKecHybridSearchOrchestrator",
        "createSearchKecHybridTool",
        "KecHybridSearchDependencies",
        "KecHybridSearchOrchestrator",
        "KecHybridSearchResult",
        "searchKecHybrid",
        "SearchKecHybridInput",
        "SearchKecHybridToolDependencies",
        "SearchKecHybridToolResult",
      ]),
    );

    for (const source of sourceFiles(hybridRoot).map((path) =>
      readFileSync(path, "utf8"),
    )) {
      expect(source).not.toMatch(
        /searchAdapters|searchIntegration|searchEntryPoints|searchKecHybrid/u,
      );
    }

    expect(hybridTool).not.toMatch(
      /createKecHybridSearchOrchestrator|\.sort\s*\(|\.filter\s*\(|\.map\s*\(/u,
    );
    expect(hybridEntryPoint).not.toMatch(/createKecHybridSearchOrchestrator/u);
    expect(hybridIntegration).toMatch(
      /createKecHybridSearchOrchestrator\(\{[\s\S]*semanticSearcher,[\s\S]*lexicalSearcher,[\s\S]*rankingStrategy,[\s\S]*\}\)/u,
    );
  });

  it("keeps Task 46, Task 47, dependencies, and SQLite contracts head-stable", () => {
    expectTask47ProductionUnchanged();

    const rootIndex = readFileSync(packageIndex, "utf8");
    expect(rootIndex).toMatch(
      /const tools: VoltAiTool\[\] = \[\s*placeholderTool,\s*createIndexKecTool\(\),\s*createSearchKecTool\(\),\s*\];/u,
    );
    expect(rootIndex).toMatch(
      /if \(options\?\.hybridSearch\) \{\s*tools\.push\(createSearchKecHybridTool\(options\.hybridSearch\)\);\s*\}/u,
    );
    expect(rootIndex).toMatch(
      /hybridSearch\?: Readonly<\{[\s\S]*rankingOptions: KecWeightedRankingOptions;/u,
    );
    expect(rootIndex).toMatch(/runStdioServer\(createServer\(\)\)/u);
    expect(rootIndex).not.toMatch(
      /semanticWeight|lexicalWeight|process\.env\.[A-Z_]*WEIGHT/u,
    );

    expect(readFileSync(searchKecFile, "utf8")).not.toMatch(
      /searchHybrid|KecHybridSearchResult|semanticScore|lexicalScore/u,
    );

    for (const path of [
      ...sourceFiles(join(packagesRoot, "mcp-agent", "src")),
      ...sourceFiles(join(packagesRoot, "agent-review", "src")),
    ]) {
      expect(readFileSync(path, "utf8")).not.toMatch(
        /searchHybrid|KecHybridSearchResult|semanticScore|lexicalScore|KecWeightedRankingOptions/u,
      );
    }
  });

  it("keeps the legacy search API and MCP schema unchanged", () => {
    expectTypeOf<KecHybridSearchResult>().toEqualTypeOf<
      readonly KecRankCandidate[]
    >();
    expectTypeOf<KecHybridSearchDependencies>().toEqualTypeOf<{
      readonly semanticSearcher: KecSemanticSearcher;
      readonly lexicalSearcher: KecLexicalSearcher;
      readonly rankingStrategy: KecRankingStrategy;
    }>();
    expectTypeOf<KecHybridSearchOrchestrator>().toEqualTypeOf<{
      search(request: KecSearchRequest): Promise<readonly KecRankCandidate[]>;
    }>();
    expectTypeOf<typeof createKecHybridSearchOrchestrator>().toEqualTypeOf<
      (dependencies: KecHybridSearchDependencies) => KecHybridSearchOrchestrator
    >();
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
  });

  it("preserves legacy semantic search output identity", async () => {
    const expected: KecSearchResult[] = [
      {
        clause: "KEC 232.5",
        page: 3,
        text: "Cable sizing requirement.",
        similarity: 0.92,
        sourcePath: "knowledge/kec.pdf",
      },
    ];
    const vectorStore: VectorStore = {
      upsert: async () => {},
      replaceSource: async () => {},
      deleteBySourcePath: async () => {},
      search: async () => expected,
      listChunks: async () => [],
      saveIndexMetadata: async () => {},
      getIndexMetadata: async () => ({
        embeddingProvider: "test",
        embeddingModel: "fixed",
        dimensions: 3,
        indexedAt: "2026-07-25T00:00:00.000Z",
      }),
      close: async () => {},
    };

    const result = await searchKec(
      { query: "cable", topK: 3 },
      {
        embeddingProvider: {
          embed: async () => [1, 0, 0],
          getMetadata: () => ({ provider: "test", model: "fixed" }),
        },
        vectorStore,
      },
    );

    expect(result).toBe(expected);
    expect(result[0]).toBe(expected[0]);

    await expect(
      searchKec(
        { query: "cable", topK: 3 },
        {
          embeddingProvider: {
            embed: async () => [1, 0, 0],
            getMetadata: () => ({ provider: "test", model: "fixed" }),
          },
          vectorStore: {
            ...vectorStore,
            getIndexMetadata: async () => null,
          },
        },
      ),
    ).rejects.toThrow(
      "KEC index embedding metadata mismatch. Please re-run index_kec.",
    );
  });

  it("does not introduce a separate request DTO", () => {
    const sources = sourceFiles(hybridRoot).map((path) =>
      readFileSync(path, "utf8"),
    );

    expect(sources.join("\n")).not.toContain("KecHybridSearchRequest");
  });
});
