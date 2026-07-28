import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { createSearchKecTool } from "../packages/mcp-kec/src/tools/searchKec.js";

const workspaceRoot = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(join(workspaceRoot, relativePath), "utf8");
}

function parseSource(relativePath: string): ts.SourceFile {
  const source = readSource(relativePath);
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  expect(sourceFile.parseDiagnostics).toEqual([]);
  return sourceFile;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}

function exportedFunction(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration {
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      isExported(statement),
  );

  if (!declaration) {
    throw new Error(`Missing exported function: ${name}`);
  }

  return declaration;
}

function exportedTypeAlias(
  sourceFile: ts.SourceFile,
  name: string,
): ts.TypeAliasDeclaration {
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === name &&
      isExported(statement),
  );

  if (!declaration) {
    throw new Error(`Missing exported type alias: ${name}`);
  }

  return declaration;
}

function compactText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, "");
}

function callsInputValidator(declaration: ts.FunctionDeclaration): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "assertSearchKecInput" &&
      node.arguments.length === 1 &&
      ts.isIdentifier(node.arguments[0]) &&
      node.arguments[0].text === "input"
    ) {
      found = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(declaration);
  return found;
}

describe("typed MCP boundary contracts", () => {
  it("keeps production tool factories typed up to the MCP serialization boundary", () => {
    expect(
      readSource("packages/mcp-project-files/src/tools/readPdf.ts"),
    ).toContain("createReadPdfTool(): VoltAiTool<ReadPdfResult>");
    expect(
      readSource("packages/mcp-project-files/src/tools/readExcel.ts"),
    ).toContain("createReadExcelTool(): VoltAiTool<ReadExcelResult>");
    expect(
      readSource("packages/mcp-project-files/src/tools/listProjectFiles.ts"),
    ).toContain("createListProjectFilesTool(): VoltAiTool<ProjectFile[]>");
    expect(readSource("packages/mcp-kec/src/tools/indexKec.ts")).toContain(
      "createIndexKecTool(deps: IndexKecToolDependencies = {}): VoltAiTool<IndexKecResult>",
    );

    const searchKecSource = parseSource(
      "packages/mcp-kec/src/tools/searchKec.ts",
    );
    const searchInput = exportedTypeAlias(searchKecSource, "SearchKecInput");
    const searchDependencies = exportedTypeAlias(
      searchKecSource,
      "SearchKecDependencies",
    );
    const search = exportedFunction(searchKecSource, "searchKec");
    const toolFactory = exportedFunction(
      searchKecSource,
      "createSearchKecTool",
    );

    expect(compactText(searchInput.type, searchKecSource)).toBe(
      "{question?:string;query?:string;topK?:number;}",
    );
    expect(compactText(searchDependencies.type, searchKecSource)).toBe(
      "{embeddingProvider:EmbeddingProvider;vectorStore:VectorStore;}",
    );
    expect(
      search.parameters.map((parameter) =>
        compactText(parameter.name, searchKecSource),
      ),
    ).toEqual(["input", "deps"]);
    expect(
      search.parameters.map((parameter) =>
        compactText(parameter.type!, searchKecSource),
      ),
    ).toEqual(["unknown", "SearchKecDependencies"]);
    expect(compactText(search.type!, searchKecSource)).toBe(
      "Promise<KecSearchResult[]>",
    );
    expect(callsInputValidator(search)).toBe(true);
    expect(
      toolFactory.parameters.map((parameter) =>
        compactText(parameter.name, searchKecSource),
      ),
    ).toEqual(["deps"]);
    expect(compactText(toolFactory.parameters[0]!.type!, searchKecSource)).toBe(
      "SearchKecToolDependencies",
    );
    expect(
      compactText(toolFactory.parameters[0]!.initializer!, searchKecSource),
    ).toBe("{}");
    expect(compactText(toolFactory.type!, searchKecSource)).toBe(
      "VoltAiTool<SearchKecToolResult>",
    );

    const searchImports = searchKecSource.statements
      .filter(ts.isImportDeclaration)
      .map((declaration) => declaration.moduleSpecifier)
      .filter(ts.isStringLiteral)
      .map((specifier) => specifier.text);
    expect(searchImports).toContain("../searchSemantic/semanticSearchCore.js");
    expect(
      searchImports.some((specifier) => specifier.includes("searchHybrid")),
    ).toBe(false);
    expect(
      searchImports.some((specifier) => specifier.includes("searchRanking")),
    ).toBe(false);

    const packageIndex = parseSource("packages/mcp-kec/src/index.ts");
    const searchExport = packageIndex.statements.find(
      (statement): statement is ts.ExportDeclaration =>
        ts.isExportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "./tools/searchKec.js",
    );
    expect(searchExport).toBeDefined();
    expect(
      searchExport?.exportClause &&
        ts.isNamedExports(searchExport.exportClause) &&
        searchExport.exportClause.elements.some(
          (element) => element.name.text === "searchKec",
        ),
    ).toBe(true);
    expect(
      packageIndex.statements
        .filter(ts.isExportDeclaration)
        .map((declaration) => declaration.moduleSpecifier)
        .filter(ts.isStringLiteral)
        .some((specifier) => specifier.text.includes("searchSemantic")),
    ).toBe(false);

    const searchTool = createSearchKecTool();
    expect(searchTool.name).toBe("search_kec");
    expect(Object.keys(searchTool.inputSchema)).toEqual(["query", "topK"]);
    expect(searchTool.inputSchema.query.safeParse("cable").success).toBe(true);
    expect(searchTool.inputSchema.query.safeParse("").success).toBe(false);
    expect(searchTool.inputSchema.topK.safeParse(undefined).success).toBe(true);
    expect(searchTool.inputSchema.topK.safeParse(1).success).toBe(true);
    expect(searchTool.inputSchema.topK.safeParse(0).success).toBe(false);

    expect(
      readSource("packages/mcp-agent/src/tools/reviewProjectTool.ts"),
    ).toContain(
      "createReviewProjectTool(options: ReviewProjectToolOptions = {}): VoltAiTool<string>",
    );
  });

  it("keeps placeholder tools as string passthrough handlers", () => {
    for (const relativePath of [
      "packages/mcp-cad/src/tools/placeholder.ts",
      "packages/mcp-estimate/src/tools/placeholder.ts",
      "packages/mcp-kec/src/tools/placeholder.ts",
      "packages/mcp-material/src/tools/placeholder.ts",
    ]) {
      expect(readSource(relativePath)).toContain(
        "placeholderTool: VoltAiTool<string>",
      );
    }
  });
});
