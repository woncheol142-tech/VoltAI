import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const packagesRoot = join(workspaceRoot, "packages");
const sourceRoot = join(packageRoot, "src");
const entryPointRoot = join(sourceRoot, "searchEntryPoints");
const entryPointSource = join(entryPointRoot, "searchKecHybrid.ts");
const entryPointIndex = join(entryPointRoot, "index.ts");
const packageIndex = join(sourceRoot, "index.ts");
const knowledgeRoot = join(sourceRoot, "knowledge");
const projectPathSource = join(knowledgeRoot, "projectPath.ts");
const hybridToolSource = join(sourceRoot, "tools", "searchKecHybrid.ts");
const packageManifest = join(packageRoot, "package.json");
const workspaceReadme = join(workspaceRoot, "README.md");

type PackageManifest = Readonly<Record<string, unknown>> &
  Readonly<{
    scripts: Readonly<Record<string, string>>;
  }>;

const protectedProduction = [
  "packages/mcp-kec/src/tools/searchKec.ts",
  "packages/mcp-kec/src/searchEntryPoints/searchKecHybrid.ts",
  "packages/mcp-kec/src/searchEntryPoints/index.ts",
  "packages/mcp-agent/src/ports/localReviewPorts.ts",
  "packages/agent-review/src/kecCitationSelection.ts",
  "packages/mcp-kec/src/searchFoundation",
  "packages/mcp-kec/src/searchHybrid",
  "packages/mcp-kec/src/searchRanking",
  "packages/mcp-kec/src/searchSemantic",
  "packages/mcp-kec/src/searchLexical",
  "packages/mcp-kec/src/searchAdapters",
  "packages/mcp-kec/src/searchIntegration",
  "packages/mcp-kec/src/knowledge/chunk.ts",
  "packages/mcp-kec/src/knowledge/embedding.ts",
  "packages/mcp-kec/src/knowledge/kecKnowledgeAdapter.ts",
  "packages/mcp-kec/src/knowledge/pdfPages.ts",
  "packages/mcp-kec/src/knowledge/sqliteVectorStore.ts",
  "packages/mcp-kec/src/knowledge/vectorStore.ts",
  "packages/knowledge-core",
  "packages/knowledge-sqlite",
  "package.json",
  "pnpm-lock.yaml",
];

function readSource(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readHeadFile(relativePath: string): string {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function expectCurrentTask54PackageAndReadmeBaseline(): void {
  const currentPackage = JSON.parse(
    readFileSync(packageManifest, "utf8"),
  ) as PackageManifest;
  const headPackage = JSON.parse(
    readHeadFile("packages/mcp-kec/package.json"),
  ) as PackageManifest;
  const { scripts: currentScripts, ...currentPackageFields } = currentPackage;
  const { scripts: headScripts, ...headPackageFields } = headPackage;

  expect(currentPackageFields).toEqual(headPackageFields);
  expect(currentScripts).toEqual({
    ...headScripts,
    "dev:hybrid": "tsx src/hybrid.ts",
    "start:hybrid": "node dist/hybrid.js",
  });
  expect(currentScripts.dev).toBe("tsx src/index.ts");
  expect(currentScripts.start).toBe("node dist/index.js");
  expect(JSON.stringify(currentPackage)).not.toContain("KEC_HYBRID_ENABLED");

  const currentReadme = readFileSync(workspaceReadme, "utf8");
  const headReadme = readHeadFile("README.md");
  const startMarker = "### Default KEC runtime";
  const endMarker = "Remaining scaffold packages can also run:";
  const sectionStart = currentReadme.indexOf(startMarker);
  const sectionEnd = currentReadme.indexOf(endMarker, sectionStart);

  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);
  expect(currentReadme.indexOf(startMarker, sectionStart + 1)).toBe(-1);

  const task54Section = currentReadme.slice(sectionStart, sectionEnd);
  expect(currentReadme).toBe(headReadme);
  expect(task54Section).toContain(
    "The default KEC runtime remains legacy-only.",
  );
  expect(task54Section).toContain("pnpm --filter @voltai/mcp-kec dev");
  expect(task54Section).toContain("kec_placeholder");
  expect(task54Section).toContain("index_kec");
  expect(task54Section).toContain("search_kec");
  expect(task54Section).toContain("pnpm --filter @voltai/mcp-kec dev:hybrid");
  expect(task54Section).toContain("pnpm --filter @voltai/mcp-kec start:hybrid");
  expect(task54Section).toContain("search_kec_hybrid");
  expect(task54Section).toMatch(/hybrid runtime is opt-in/iu);
  expect(task54Section).toMatch(
    /No Recall, MRR, NDCG, ranking threshold, or production-quality claim/u,
  );
  expect(task54Section).not.toContain("KEC_HYBRID_ENABLED");
}

function parseEntryPoint(): ts.SourceFile {
  return ts.createSourceFile(
    entryPointSource,
    readSource(entryPointSource),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function listTypeScriptSources(root: string): string[] {
  if (!existsSync(root)) return [];

  const sources: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      sources.push(...listTypeScriptSources(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.push(path);
    }
  }

  return sources;
}

function importsNativeHybridEntryPoint(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return source.statements
    .filter(ts.isImportDeclaration)
    .some(
      (declaration) =>
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text
          .split("/")
          .includes("searchEntryPoints"),
    );
}

function importsProjectPath(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return source.statements
    .filter(ts.isImportDeclaration)
    .some(
      (declaration) =>
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === "../knowledge/projectPath.js",
    );
}

function packageRootExportNames(): string[] {
  const source = ts.createSourceFile(
    packageIndex,
    readSource(packageIndex),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];

  for (const statement of source.statements) {
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
    const isExported = modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );

    if (
      isExported &&
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

function searchKecHybridDeclaration(
  source: ts.SourceFile,
): ts.FunctionDeclaration | undefined {
  return source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "searchKecHybrid",
  );
}

describe("native KEC hybrid search entry-point architecture boundaries", () => {
  it("reserves exactly the approved two-file production namespace", () => {
    expect(existsSync(entryPointRoot)).toBe(true);
    expect(statSync(entryPointRoot).isDirectory()).toBe(true);
    expect(readdirSync(entryPointRoot).sort()).toEqual([
      "index.ts",
      "searchKecHybrid.ts",
    ]);
    expect(existsSync(join(entryPointRoot, "types.ts"))).toBe(false);
  });

  it("exports only searchKecHybrid from the namespace index", () => {
    const source = ts.createSourceFile(
      entryPointIndex,
      readSource(entryPointIndex),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const exports = source.statements.filter(ts.isExportDeclaration);

    expect(exports).toHaveLength(1);
    expect(exports[0]!.exportClause).toBeDefined();
    expect(
      exports[0]!.exportClause &&
        ts.isNamedExports(exports[0]!.exportClause) &&
        exports[0]!.exportClause.elements.map((element) => element.name.text),
    ).toEqual(["searchKecHybrid"]);
    expect(
      exports[0]!.moduleSpecifier &&
        ts.isStringLiteral(exports[0]!.moduleSpecifier) &&
        exports[0]!.moduleSpecifier.text,
    ).toBe("./searchKecHybrid.js");
  });

  it("defines one exported non-async function with the exact parameter order", () => {
    const source = parseEntryPoint();
    const declaration = searchKecHybridDeclaration(source);

    expect(declaration).toBeDefined();
    expect(
      declaration?.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
    ).toBe(true);
    expect(
      declaration?.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ),
    ).toBe(false);
    expect(
      declaration?.parameters.map((parameter) =>
        parameter.name.getText(source),
      ),
    ).toEqual(["request", "dependencies", "rankingOptions"]);
    expect(
      declaration?.parameters.every(
        (parameter) =>
          parameter.questionToken === undefined &&
          parameter.initializer === undefined,
      ),
    ).toBe(true);
  });

  it("contains only a direct Task 51 factory call and orchestrator invocation", () => {
    const source = parseEntryPoint();
    const declaration = searchKecHybridDeclaration(source);
    const statements = declaration?.body?.statements ?? [];

    expect(statements).toHaveLength(1);
    expect(ts.isReturnStatement(statements[0])).toBe(true);

    const returned =
      statements[0] && ts.isReturnStatement(statements[0])
        ? statements[0].expression
        : undefined;
    expect(returned && ts.isCallExpression(returned)).toBe(true);

    const searchAccess =
      returned && ts.isCallExpression(returned)
        ? returned.expression
        : undefined;
    expect(searchAccess && ts.isPropertyAccessExpression(searchAccess)).toBe(
      true,
    );
    expect(
      searchAccess &&
        ts.isPropertyAccessExpression(searchAccess) &&
        searchAccess.name.text,
    ).toBe("search");
    expect(
      returned &&
        ts.isCallExpression(returned) &&
        returned.arguments.map((argument) => argument.getText(source)),
    ).toEqual(["request"]);

    const factoryCall =
      searchAccess && ts.isPropertyAccessExpression(searchAccess)
        ? searchAccess.expression
        : undefined;
    expect(factoryCall && ts.isCallExpression(factoryCall)).toBe(true);
    expect(
      factoryCall &&
        ts.isCallExpression(factoryCall) &&
        factoryCall.expression.getText(source),
    ).toBe("createExistingKecHybridSearch");
    expect(
      factoryCall &&
        ts.isCallExpression(factoryCall) &&
        factoryCall.arguments.map((argument) => argument.getText(source)),
    ).toEqual(["dependencies", "rankingOptions"]);
  });

  it("imports only existing type authorities and the Task 51 factory", () => {
    const source = parseEntryPoint();
    const specifiers = source.statements
      .filter(ts.isImportDeclaration)
      .map((declaration) => declaration.moduleSpecifier)
      .filter(ts.isStringLiteral)
      .map((specifier) => specifier.text)
      .sort();

    expect(specifiers).toEqual([
      "../searchFoundation/index.js",
      "../searchHybrid/index.js",
      "../searchIntegration/index.js",
      "../searchRanking/index.js",
    ]);
  });

  it("contains no validation, projection, ordering, wrapping, or lifecycle logic", () => {
    const source = readSource(entryPointSource);

    expect(source).not.toMatch(
      /\b(?:async|await|catch|finally|try|throw|new\s+Error|Promise\.(?:resolve|reject|all|allSettled|race|any))\b/,
    );
    expect(source).not.toMatch(
      /\.(?:map|filter|sort|reverse|slice|flatMap|reduce)\s*\(/,
    );
    expect(source).not.toMatch(
      /\bObject\.(?:freeze|assign|seal|preventExtensions)\b|structuredClone|JSON\.(?:parse|stringify)/,
    );
    expect(source).not.toMatch(
      /\bMath\.(?:min|max)\b|normalize\s*\(|trim\s*\(|toLowerCase\s*\(|localeCompare/,
    );
    expect(source).not.toMatch(
      /\b(?:close|dispose|cleanup|retry|fallback|cache|singleton|registry)\b/,
    );
    expect(source).not.toMatch(/\.\.\.|\[[^\]]+\]\s*=/);
  });

  it("contains no filesystem, network, process, SQL, logging, or code execution authority", () => {
    const source = readSource(entryPointSource);

    expect(source).not.toMatch(
      /node:(?:fs|path|child_process|net|http|https|vm|worker_threads)|\bfetch\s*\(|process\.env/,
    );
    expect(source).not.toMatch(
      /\b(?:eval|Function)\s*\(|\bSQL\b|\bSELECT\b|\bMATCH\b|console\.|logger/,
    );
  });

  it("keeps native hybrid APIs out of the package root without removing legacy exports", () => {
    const exports = packageRootExportNames();

    expect(exports).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(exports).not.toEqual(
      expect.arrayContaining([
        "KecHybridSearchResult",
        "KecWeightedRankingOptions",
        "SearchKecHybridInput",
        "SearchKecHybridToolDependencies",
        "SearchKecHybridToolResult",
        "createSearchKecHybridTool",
        "searchKecHybrid",
      ]),
    );
  });

  it("allows exactly the approved additive tool to consume the entry point", () => {
    const consumers = readdirSync(packagesRoot)
      .flatMap((packageName) =>
        listTypeScriptSources(join(packagesRoot, packageName, "src")),
      )
      .filter(importsNativeHybridEntryPoint)
      .map((path) => relative(workspaceRoot, path))
      .sort();

    expect(consumers).toEqual([
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]);
  });

  it("keeps Task 52 implementation and protected Task 46-51 production HEAD-stable", () => {
    expect(() =>
      execFileSync(
        "git",
        ["diff", "--exit-code", "HEAD", "--", ...protectedProduction],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();

    expect(readdirSync(knowledgeRoot).sort()).toEqual([
      "chunk.ts",
      "embedding.ts",
      "indexCompatibility.ts",
      "kecKnowledgeAdapter.ts",
      "pdfPages.ts",
      "projectPath.ts",
      "sqliteVectorStore.ts",
      "vectorStore.ts",
    ]);

    const sourceText = readSource(projectPathSource);
    const source = ts.createSourceFile(
      projectPathSource,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((declaration) => {
        const bindings = declaration.importClause?.namedBindings;

        return {
          module:
            ts.isStringLiteral(declaration.moduleSpecifier) &&
            declaration.moduleSpecifier.text,
          names:
            bindings && ts.isNamedImports(bindings)
              ? bindings.elements.map((element) => element.name.text)
              : [],
        };
      });
    const functions = source.statements
      .filter(ts.isFunctionDeclaration)
      .map((declaration) => ({
        name: declaration.name?.text,
        exported:
          declaration.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          ) ?? false,
        parameters: declaration.parameters.map((parameter) =>
          parameter.getText(source).replace(/\s+/gu, " "),
        ),
        returnType: declaration.type?.getText(source),
      }));
    const strings: string[] = [];
    const calls: string[] = [];
    const conditions: string[] = [];
    const throws: string[] = [];

    function visit(node: ts.Node): void {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        strings.push(node.text);
      }
      if (ts.isCallExpression(node)) {
        calls.push(node.expression.getText(source).replace(/\s+/gu, ""));
      }
      if (ts.isIfStatement(node)) {
        conditions.push(node.expression.getText(source).replace(/\s+/gu, ""));
      }
      if (ts.isThrowStatement(node)) {
        throws.push(
          node.expression?.getText(source).replace(/\s+/gu, "") ?? "",
        );
      }

      ts.forEachChild(node, visit);
    }

    visit(source);

    expect(imports).toEqual([
      { module: "node:fs", names: ["realpathSync", "statSync"] },
      {
        module: "node:path",
        names: ["extname", "isAbsolute", "resolve", "sep"],
      },
    ]);
    expect(functions).toEqual([
      {
        name: "assertProjectRoot",
        exported: true,
        parameters: ["projectRoot: string | undefined"],
        returnType: "string",
      },
      {
        name: "isWithinProjectRoot",
        exported: false,
        parameters: ["projectRoot: string", "absolutePath: string"],
        returnType: "boolean",
      },
      {
        name: "resolveKecPdfPath",
        exported: true,
        parameters: ["projectRoot: string", "relativePath: string"],
        returnType: "string",
      },
    ]);
    expect(strings).toEqual([
      "node:fs",
      "node:path",
      "PROJECT_ROOT is required",
      "PROJECT_ROOT must be an existing directory",
      "PROJECT_ROOT must be an existing directory",
      "relativePath must be relative",
      "..",
      "relativePath must stay within PROJECT_ROOT",
      ".pdf",
      "Only .pdf files are supported",
      "relativePath must stay within PROJECT_ROOT",
      "PDF file does not exist",
      "PDF file does not exist",
      "PDF file does not exist",
      "relativePath must stay within PROJECT_ROOT",
    ]);
    expect(calls).toEqual([
      "statSync",
      "stats.isDirectory",
      "realpathSync",
      "projectRoot.endsWith",
      "absolutePath.startsWith",
      "isAbsolute",
      "relativePath.split",
      "pathParts.includes",
      "extname(relativePath).toLowerCase",
      "extname",
      "resolve",
      "isWithinProjectRoot",
      "statSync",
      "stats.isFile",
      "realpathSync",
      "isWithinProjectRoot",
    ]);
    expect(conditions).toEqual([
      "!projectRoot",
      "!stats.isDirectory()",
      "isAbsolute(relativePath)",
      'pathParts.includes("..")',
      'extname(relativePath).toLowerCase()!==".pdf"',
      "!isWithinProjectRoot(projectRoot,absolutePath)",
      "!stats.isFile()",
      'errorinstanceofError&&error.message==="PDFfiledoesnotexist"',
      "!isWithinProjectRoot(projectRoot,realPath)",
    ]);
    expect(throws).toEqual([
      'newError("PROJECT_ROOTisrequired")',
      'newError("PROJECT_ROOTmustbeanexistingdirectory")',
      'newError("PROJECT_ROOTmustbeanexistingdirectory")',
      'newError("relativePathmustberelative")',
      'newError("relativePathmuststaywithinPROJECT_ROOT")',
      'newError("Only.pdffilesaresupported")',
      'newError("relativePathmuststaywithinPROJECT_ROOT")',
      'newError("PDFfiledoesnotexist")',
      "error",
      'newError("PDFfiledoesnotexist")',
      'newError("relativePathmuststaywithinPROJECT_ROOT")',
    ]);
    expect(sourceText).not.toMatch(
      /process\.(?:cwd|env)|console\.|\bfetch\s*\(|node:(?:child_process|http|https|net|vm|worker_threads)|\b(?:eval|Function)\s*\(/u,
    );

    const projectPathConsumers = listTypeScriptSources(sourceRoot)
      .filter(importsProjectPath)
      .map((path) => relative(workspaceRoot, path))
      .sort();
    expect(projectPathConsumers).toEqual([
      "packages/mcp-kec/src/tools/indexKec.ts",
      "packages/mcp-kec/src/tools/searchKec.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]);

    const hybridTool = readSource(hybridToolSource);
    expect(hybridTool).toMatch(
      /process\.env\.KEC_DB_PATH\s*\?\?\s*join\(\s*assertProjectRoot\(process\.env\.PROJECT_ROOT\),\s*"\.voltai",\s*"kec\.sqlite",?\s*\)/u,
    );
    expect(hybridTool).not.toMatch(/process\.cwd\s*\(/u);
  });

  it("adds no manifest, dependency, lockfile, config, schema, or README change", () => {
    const protectedFiles = [
      "package.json",
      "pnpm-lock.yaml",
      "packages/mcp-kec/tsconfig.json",
      "NEXT_STEPS.md",
      "CHANGELOG.md",
      "packages/knowledge-sqlite/src/schema.ts",
    ];

    expect(() =>
      execFileSync(
        "git",
        ["diff", "--exit-code", "HEAD", "--", ...protectedFiles],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();

    expectCurrentTask54PackageAndReadmeBaseline();
  });
});
