import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const packagesRoot = join(workspaceRoot, "packages");
const packageSourceRoot = join(packageRoot, "src");
const sourceRoot = join(packageRoot, "src", "searchLexical");
const packageIndex = join(packageRoot, "src", "index.ts");
const adapterRoot = join(packageRoot, "src", "searchAdapters");
const adapterTypes = join(adapterRoot, "types.ts");
const adapterIndex = join(adapterRoot, "index.ts");
const lexicalAdapter = join(adapterRoot, "existingLexicalSearchAdapter.ts");
const integrationSource = join(
  packageSourceRoot,
  "searchIntegration",
  "existingKecHybridSearch.ts",
);
const entryPointSource = join(
  packageSourceRoot,
  "searchEntryPoints",
  "searchKecHybrid.ts",
);
const hybridToolSource = join(packageSourceRoot, "tools", "searchKecHybrid.ts");
const legacySearch = join(packageSourceRoot, "tools", "searchKec.ts");

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

function productionSources(): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => sourceFiles(join(packagesRoot, entry.name, "src")));
}

function lexicalRuntimeConsumers(): string[] {
  return productionSources()
    .filter((path) => !path.startsWith(`${sourceRoot}/`))
    .filter((path) => importsNamespace(path, "searchLexical"))
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

function expectTask50aProductionUnchanged(): void {
  for (const diffMode of [[], ["--cached"]]) {
    expect(() =>
      execFileSync(
        "git",
        ["diff", ...diffMode, "--exit-code", "--", ...task50aRuntimeFiles],
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

    expectTask50aProductionUnchanged();
    expect(lexicalRuntimeConsumers()).toEqual([
      "packages/mcp-kec/src/searchAdapters/types.ts",
      "packages/mcp-kec/src/searchIntegration/existingKecHybridSearch.ts",
    ]);

    expect(importsNamespace(lexicalAdapter, "searchLexical")).toBe(false);
    expect(importsNamespace(integrationSource, "searchAdapters")).toBe(true);
    expect(importsNamespace(integrationSource, "searchLexical")).toBe(true);
    expect(importsNamespace(entryPointSource, "searchIntegration")).toBe(true);
    expect(importsNamespace(entryPointSource, "searchLexical")).toBe(false);
    expect(importsNamespace(hybridToolSource, "searchEntryPoints")).toBe(true);
    expect(importsNamespace(hybridToolSource, "searchLexical")).toBe(false);
    expect(importsNamespace(packageIndex, "searchLexical")).toBe(false);

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
        "createExistingLexicalSearcher",
        "createExistingSemanticSearcher",
        "createSearchKecHybridTool",
        "KecHybridSearchResult",
        "KecLexicalSearchResult",
        "KecWeightedRankingOptions",
        "searchKecHybrid",
        "searchKecLexically",
        "SearchKecHybridInput",
        "SearchKecHybridToolDependencies",
        "SearchKecHybridToolResult",
      ]),
    );

    expect(rootIndex).toMatch(
      /const tools: VoltAiTool\[\] = \[\s*placeholderTool,\s*createIndexKecTool\(\),\s*createSearchKecTool\(\),\s*\];/u,
    );
    expect(rootIndex).toMatch(
      /if \(options\?\.hybridSearch\) \{\s*tools\.push\(createSearchKecHybridTool\(options\.hybridSearch\)\);\s*\}/u,
    );
    expect(
      rootIndex.match(
        /tools\.push\(createSearchKecHybridTool\(options\.hybridSearch\)\)/gu,
      ),
    ).toHaveLength(1);
    expect(rootIndex).toMatch(
      /hybridSearch\?: Readonly<\{[\s\S]*rankingOptions: KecWeightedRankingOptions;/u,
    );
    expect(rootIndex).toMatch(/runStdioServer\(createServer\(\)\)/u);
    expect(rootIndex).not.toMatch(
      /semanticWeight|lexicalWeight|process\.env\.[A-Z_]*WEIGHT/u,
    );

    const legacySource = readFileSync(legacySearch, "utf8");
    expect(legacySource).toMatch(/name: "search_kec"/u);
    expect(legacySource).toMatch(/query: z\.string\(\)\.min\(1\)/u);
    expect(legacySource).toMatch(
      /topK: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/u,
    );
    expect(legacySource).toMatch(/topK: candidate\.topK \?\? 5/u);
    expect(legacySource).toMatch(/return \{ results \};/u);
    expect(legacySource).not.toMatch(
      /searchLexical|searchAdapters|searchIntegration|searchEntryPoints|searchKecHybrid|lexicalScore|semanticScore|signals/u,
    );

    const isolatedAgentSources = [
      ...sourceFiles(join(packagesRoot, "mcp-agent", "src")),
      ...sourceFiles(join(packagesRoot, "agent-review", "src")),
    ];
    for (const sourcePath of isolatedAgentSources) {
      const source = readFileSync(sourcePath, "utf8");
      expect(source).not.toMatch(
        /searchLexical|searchAdapters|searchIntegration|searchEntryPoints|searchKecHybrid|lexicalScore|semanticScore|signals/u,
      );
    }

    for (const runtimeFile of task50aRuntimeFiles) {
      const source = readFileSync(runtimeFile, "utf8");
      expect(source).not.toMatch(
        /searchAdapters|searchIntegration|searchEntryPoints|searchKecHybrid/u,
      );
    }
  });
});
