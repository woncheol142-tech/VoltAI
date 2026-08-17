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

const requiredTask84PublicTypes = ["TemporalRole", "TemporalAssertion"];

const currentTask84RejectedPublicConcepts = [
  "TemporalInstant",
  "TemporalDate",
  "TemporalTimestamp",
  "TemporalPoint",
  "TemporalRange",
  "TemporalInterval",
  "TemporalPeriod",
  "TemporalWindow",
  "TemporalBounds",
  "TemporalExtent",
  "PublicationTime",
  "ObservationTime",
  "AcquisitionTime",
  "ExtractionTime",
  "DecisionTime",
  "EffectiveTime",
  "ValidityTime",
  "TemporalCurrent",
  "TemporalLatest",
  "TemporalActive",
  "CurrentTemporalState",
  "TemporalResolution",
  "TemporalResolver",
  "TemporalOrder",
  "TemporalSequence",
  "TemporalComparison",
  "TemporalComparator",
  "TemporalBefore",
  "TemporalAfter",
  "TemporalAssertionId",
  "TemporalAssertionRecord",
  "TemporalProvenance",
  "TemporalEvent",
  "TemporalOccurrence",
  "EventStream",
  "Timeline",
  "TemporalDimension",
  "TemporalBinding",
  "TemporalDescriptor",
  "TemporalContext",
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

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return modules;
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

function isReadonly(field: ts.Symbol): boolean {
  return (field.getDeclarations() ?? []).some(
    (declaration) =>
      ts.canHaveModifiers(declaration) &&
      ts
        .getModifiers(declaration)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
  );
}

function typeAliasDeclaration(
  symbol: ts.Symbol,
): ts.TypeAliasDeclaration | undefined {
  return symbol
    .getDeclarations()
    ?.find((declaration): declaration is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(declaration),
    );
}

describe("temporal-core public and package boundaries", () => {
  it("exposes the required Task84 type subset with frozen generics and current assertion shape", () => {
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

    for (const requiredType of requiredTask84PublicTypes) {
      expect(publicNames).toContain(requiredType);
    }
    for (const rejectedConcept of currentTask84RejectedPublicConcepts) {
      expect(publicNames).not.toContain(rejectedConcept);
    }

    for (const symbol of publicSymbols) {
      expect(symbol.flags & ts.SymbolFlags.Value).toBe(0);

      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;

      expect(target.flags & ts.SymbolFlags.Value).toBe(0);

      if (requiredTask84PublicTypes.includes(symbol.name)) {
        const declaredType = checker.getDeclaredTypeOfSymbol(target);

        expect(declaredType.flags & ts.TypeFlags.Any).toBe(0);
      }
    }

    const symbolsByName = new Map(
      publicSymbols.map((symbol) => {
        const target =
          symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;

        return [symbol.name, target] as const;
      }),
    );
    const roleSymbol = symbolsByName.get("TemporalRole");
    const assertionSymbol = symbolsByName.get("TemporalAssertion");

    expect(roleSymbol).toBeDefined();
    expect(assertionSymbol).toBeDefined();
    if (!roleSymbol || !assertionSymbol) {
      return;
    }

    const roleDeclaration = typeAliasDeclaration(roleSymbol);
    const assertionDeclaration = typeAliasDeclaration(assertionSymbol);

    expect(roleDeclaration).toBeDefined();
    expect(assertionDeclaration).toBeDefined();
    if (!roleDeclaration || !assertionDeclaration) {
      return;
    }

    const roleParameters = roleDeclaration.typeParameters ?? [];
    const assertionParameters = assertionDeclaration.typeParameters ?? [];

    expect(roleParameters).toHaveLength(1);
    expect(assertionParameters).toHaveLength(2);

    for (const parameter of [...roleParameters, ...assertionParameters]) {
      expect(parameter.default).toBeUndefined();
      expect(parameter.constraint).toBeUndefined();
    }

    const assertionFields = checker.getPropertiesOfType(
      checker.getDeclaredTypeOfSymbol(assertionSymbol),
    );

    expect(assertionFields.map((field) => field.name).sort()).toEqual([
      "role",
      "subject",
      "temporalValue",
    ]);
    for (const field of assertionFields) {
      expect(isReadonly(field)).toBe(true);
    }
  });

  it("declares the Task84 package as a standard zero-dependency foundation", () => {
    expect(existsSync(packageManifest)).toBe(true);

    if (!existsSync(packageManifest)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as {
      name?: string;
      private?: boolean;
      type?: string;
      main?: string;
      types?: string;
      exports?: Record<
        string,
        {
          types?: string;
          "voltai-source"?: string;
          default?: string;
        }
      >;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.name).toBe("@voltai/temporal-core");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect(manifest.main).toBe("dist/index.js");
    expect(manifest.types).toBe("dist/index.d.ts");
    expect(manifest.exports?.["."]).toEqual({
      types: "./src/index.ts",
      "voltai-source": "./src/index.ts",
      default: "./dist/index.js",
    });
    expect(manifest.scripts?.build).toBe("tsc -p tsconfig.json");
    expect(manifest.scripts?.test).toBe(
      "vitest run --root ../.. packages/temporal-core/test",
    );
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it("allows production imports to resolve only within temporal-core", () => {
    for (const sourcePath of typescriptFiles(sourceRoot)) {
      for (const moduleName of importedModules(sourcePath)) {
        expect(moduleName.startsWith(".")).toBe(true);
        expect(resolvesWithinPackage(sourcePath, moduleName)).toBe(true);
      }
    }
  });
});
