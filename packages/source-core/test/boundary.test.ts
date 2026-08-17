import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const sourceRoot = join(packageRoot, "src");
const entrypoint = join(sourceRoot, "index.ts");
const packageManifest = join(packageRoot, "package.json");

const requiredTask81PublicTypes = [
  "ExternalSourceLocator",
  "SourceBlobHash",
  "SourceIdentity",
  "SourceRevision",
  "SourceRevisionKey",
];

const forbiddenPublicTypes = [
  "SourceAcquisition",
  "SourceIdentityBinding",
  "SourceIdentityCodec",
  "SourceRevisionKeyCodec",
];

const forbiddenTemporalFields = [
  "latest",
  "current",
  "previous",
  "next",
  "effective",
  "validFrom",
  "validTo",
  "createdAt",
  "updatedAt",
];

const forbiddenAuthorityFields = [
  "authority",
  "applicability",
  "recommendation",
  "precedence",
  "rank",
];

function typescriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return typescriptFiles(path);
    }

    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

function importedModules(path: string): string[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const modules: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      modules.push(node.argument.literal.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return modules;
}

describe("source-core public and package boundaries", () => {
  it("exposes the five required Task81 public types and their minimal fields", () => {
    expect(existsSync(entrypoint)).toBe(true);

    if (!existsSync(entrypoint)) {
      return;
    }

    const program = ts.createProgram({
      rootNames: [entrypoint],
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(entrypoint);

    expect(sourceFile).toBeDefined();
    if (!sourceFile) {
      return;
    }

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

    expect(moduleSymbol).toBeDefined();
    if (!moduleSymbol) {
      return;
    }

    const publicSymbols = checker.getExportsOfModule(moduleSymbol);
    const publicNames = publicSymbols.map((symbol) => symbol.name).sort();

    for (const requiredType of requiredTask81PublicTypes) {
      expect(publicNames).toContain(requiredType);
    }
    for (const forbiddenType of forbiddenPublicTypes) {
      expect(publicNames).not.toContain(forbiddenType);
    }

    for (const symbol of publicSymbols) {
      expect(symbol.flags & ts.SymbolFlags.Value).toBe(0);

      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const publicType = checker.getDeclaredTypeOfSymbol(target);
      const publicFields = checker
        .getPropertiesOfType(publicType)
        .map((field) => field.name);

      for (const forbiddenField of [
        ...forbiddenTemporalFields,
        ...forbiddenAuthorityFields,
      ]) {
        expect(publicFields).not.toContain(forbiddenField);
      }

      if (symbol.name === "SourceRevision") {
        expect(publicFields.sort()).toEqual(["revisionKey", "sourceIdentity"]);
      }
    }
  });

  it("remains a zero-dependency foundation without forbidden imports", () => {
    if (existsSync(packageManifest)) {
      const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const runtimeDependencies = {
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };

      expect(Object.keys(runtimeDependencies)).toEqual([]);
    }

    const forbiddenImports = [
      "@voltai/knowledge-core",
      "@voltai/decision-sqlite",
      "@modelcontextprotocol/sdk",
      "node:sqlite",
    ];
    const modules = typescriptFiles(sourceRoot).flatMap(importedModules);

    for (const moduleName of modules) {
      expect(forbiddenImports).not.toContain(moduleName);
      expect(moduleName.startsWith("@voltai/mcp-")).toBe(false);
    }
  });

  it("keeps the Task81 test scope free of legacy model migration", () => {
    const legacyMigrationMarkers = [
      ["Knowledge", "Document"].join(""),
      ["Knowledge", "Chunk"].join(""),
      ["Knowledge", "Citation"].join(""),
      ["document", "Id"].join(""),
      ["source", "Path"].join(""),
    ];
    const testSources = typescriptFiles(testDirectory).map((path) =>
      readFileSync(path, "utf8"),
    );

    for (const source of testSources) {
      for (const marker of legacyMigrationMarkers) {
        expect(source).not.toContain(marker);
      }
    }
  });
});
