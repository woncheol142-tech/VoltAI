import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const entryPointRoot = join(sourceRoot, "searchEntryPoints");
const entryPointSource = join(entryPointRoot, "searchKecHybrid.ts");
const entryPointIndex = join(entryPointRoot, "index.ts");
const packageIndex = join(sourceRoot, "index.ts");

const protectedProduction = [
  "packages/mcp-kec/src/tools/searchKec.ts",
  "packages/mcp-kec/src/index.ts",
  "packages/mcp-agent/src/ports/localReviewPorts.ts",
  "packages/agent-review/src/kecCitationSelection.ts",
  "packages/mcp-kec/src/searchFoundation",
  "packages/mcp-kec/src/searchHybrid",
  "packages/mcp-kec/src/searchRanking",
  "packages/mcp-kec/src/searchSemantic",
  "packages/mcp-kec/src/searchLexical",
  "packages/mcp-kec/src/searchAdapters",
  "packages/mcp-kec/src/searchIntegration",
  "packages/mcp-kec/src/knowledge",
  "packages/knowledge-core",
  "packages/knowledge-sqlite",
  "packages/mcp-kec/package.json",
  "package.json",
  "pnpm-lock.yaml",
];

function readSource(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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

  it("does not export the entry point from the package root", () => {
    const source = readSource(packageIndex);

    expect(source).not.toMatch(/searchEntryPoints|searchKecHybrid/);
  });

  it("does not connect the entry point to any existing production consumer", () => {
    const productionFiles = [
      join(sourceRoot, "index.ts"),
      join(sourceRoot, "tools", "searchKec.ts"),
      join(
        workspaceRoot,
        "packages",
        "mcp-agent",
        "src",
        "ports",
        "localReviewPorts.ts",
      ),
      join(
        workspaceRoot,
        "packages",
        "agent-review",
        "src",
        "kecCitationSelection.ts",
      ),
    ];

    for (const path of productionFiles) {
      expect(readSource(path)).not.toMatch(/searchKecHybrid|searchEntryPoints/);
    }
  });

  it("keeps all protected legacy and Task 46-51 production HEAD-stable", () => {
    expect(() =>
      execFileSync(
        "git",
        ["diff", "--exit-code", "HEAD", "--", ...protectedProduction],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("adds no manifest, dependency, lockfile, config, schema, or README change", () => {
    const protectedFiles = [
      "package.json",
      "pnpm-lock.yaml",
      "packages/mcp-kec/package.json",
      "packages/mcp-kec/tsconfig.json",
      "README.md",
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
  });
});
