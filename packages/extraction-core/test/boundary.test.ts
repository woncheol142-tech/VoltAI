import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const sourceRoot = join(packageRoot, "src");
const entrypoint = join(sourceRoot, "index.ts");
const packageManifest = join(packageRoot, "package.json");

const requiredTask82PublicTypes = [
  "AnchorLocatorSpace",
  "ExtractionAnchor",
  "ExtractionContractId",
  "ExtractionLineage",
];

const rejectedTask82PublicConcepts = [
  "StableAnchor",
  "ExtractionRun",
  "ExtractionEvent",
  "SourceAcquisition",
  "AcquiredBlobRef",
  "ExtractionInput",
  "ExtractorId",
  "ExtractionContractVersion",
  "ExtractionContract",
  "DerivedArtifact",
  "DerivedArtifactIdentity",
  "DerivedArtifactHash",
  "AnchorIdentity",
  "AnchorKind",
  "SourceLocation",
  "EvidenceAnchor",
  "SourceRevisionExtractionContext",
  "AnchorCorrespondence",
  "AnchorRebinding",
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
  "sequence",
  "order",
  "supersedes",
];

const forbiddenAuthorityAndPromotionFields = [
  "authority",
  "truth",
  "applicability",
  "recommendation",
  "precedence",
  "rank",
  "trusted",
  "approved",
  "validated",
  "confidence",
  "promotion",
];

const forbiddenContextFields = [
  "project",
  "site",
  "user",
  "discipline",
  "scope",
];

const forbiddenQueryAndPersistenceConcepts = [
  "repository",
  "store",
  "query",
  "lookup",
  "resolver",
  "sqlite",
  "persistence",
  "port",
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

function identifierWords(path: string): string[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const words: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      words.push(
        ...node.text
          .replace(/SQLite/g, " sqlite ")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
          .split(/[^A-Za-z0-9]+/)
          .filter(Boolean)
          .map((word) => word.toLowerCase()),
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return words;
}

function isReadonly(field: ts.Symbol): boolean {
  return (field.getDeclarations() ?? []).some(
    (declaration) =>
      ts.canHaveModifiers(declaration) &&
      ts
        .getModifiers(declaration)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
  );
}

function resolvesWithinPackage(
  sourcePath: string,
  moduleName: string,
): boolean {
  const resolved = resolve(dirname(sourcePath), moduleName);
  const pathFromPackage = relative(packageRoot, resolved);

  return (
    pathFromPackage === "" ||
    (!pathFromPackage.startsWith("..") && !isAbsolute(pathFromPackage))
  );
}

describe("extraction-core public and package boundaries", () => {
  it("exposes the required Task82 type subset with exact readonly outer shapes", () => {
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
    const publicNames = publicSymbols.map((symbol) => symbol.name);

    for (const requiredType of requiredTask82PublicTypes) {
      expect(publicNames).toContain(requiredType);
    }
    for (const rejectedConcept of rejectedTask82PublicConcepts) {
      expect(publicNames).not.toContain(rejectedConcept);
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
        ...forbiddenAuthorityAndPromotionFields,
        ...forbiddenContextFields,
      ]) {
        expect(publicFields).not.toContain(forbiddenField);
      }
    }

    const exactShapes = new Map<string, string[]>([
      ["ExtractionLineage", ["contract", "input"]],
      ["ExtractionAnchor", ["lineage", "locator", "locatorSpace"]],
    ]);

    for (const [typeName, expectedFields] of exactShapes) {
      const symbol = publicSymbols.find(
        (candidate) => candidate.name === typeName,
      );

      expect(symbol).toBeDefined();
      if (!symbol) {
        continue;
      }

      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const fields = checker.getPropertiesOfType(
        checker.getDeclaredTypeOfSymbol(target),
      );

      expect(fields.map((field) => field.name).sort()).toEqual(expectedFields);
      for (const field of fields) {
        expect(isReadonly(field)).toBe(true);
      }
    }
  });

  it("declares source-core as its sole production package dependency", () => {
    expect(existsSync(packageManifest)).toBe(true);

    if (!existsSync(packageManifest)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies).toEqual({
      "@voltai/source-core": "workspace:*",
    });
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it("allows only internal relative imports and the source-core package boundary", () => {
    for (const sourcePath of typescriptFiles(sourceRoot)) {
      for (const moduleName of importedModules(sourcePath)) {
        if (moduleName.startsWith(".")) {
          expect(resolvesWithinPackage(sourcePath, moduleName)).toBe(true);
        } else {
          expect(moduleName).toBe("@voltai/source-core");
        }
      }
    }
  });

  it("contains no query or persistence concepts", () => {
    const productionWords =
      typescriptFiles(sourceRoot).flatMap(identifierWords);

    for (const forbiddenConcept of forbiddenQueryAndPersistenceConcepts) {
      expect(productionWords).not.toContain(forbiddenConcept);
    }
  });
});
