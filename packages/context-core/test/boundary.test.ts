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

const requiredTask83PublicTypes = [
  "ContextDimension",
  "ContextBinding",
  "ContextDescriptor",
];

const currentTask83RejectedPublicConcepts = [
  "ContextFact",
  "ContextId",
  "ContextIdentity",
  "ContextSnapshot",
  "ContextSnapshotId",
  "ContextSubject",
  "ContextTarget",
  "ContextScope",
  "ContextSet",
  "ContextFrame",
  "ContextModel",
  "ContextConstraint",
  "ContextPredicate",
  "ApplicabilityCondition",
  "ContextOrigin",
  "ContextProvenance",
  "ContextRepository",
  "ContextStore",
  "ContextValue",
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

function publicTypeDeclaration(
  symbol: ts.Symbol,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
  return symbol
    .getDeclarations()
    ?.find(
      (
        declaration,
      ): declaration is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
        ts.isInterfaceDeclaration(declaration) ||
        ts.isTypeAliasDeclaration(declaration),
    );
}

describe("context-core public and package boundaries", () => {
  it("exposes the required Task83 type subset with frozen generic and outer-shape contracts", () => {
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

    for (const requiredType of requiredTask83PublicTypes) {
      expect(publicNames).toContain(requiredType);
    }
    for (const rejectedConcept of currentTask83RejectedPublicConcepts) {
      expect(publicNames).not.toContain(rejectedConcept);
    }

    for (const symbol of publicSymbols) {
      expect(symbol.flags & ts.SymbolFlags.Value).toBe(0);

      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;

      expect(target.flags & ts.SymbolFlags.Value).toBe(0);

      if (requiredTask83PublicTypes.includes(symbol.name)) {
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

    const dimensionDeclaration = publicTypeDeclaration(
      symbolsByName.get("ContextDimension")!,
    );
    const bindingDeclaration = publicTypeDeclaration(
      symbolsByName.get("ContextBinding")!,
    );
    const descriptorDeclaration = publicTypeDeclaration(
      symbolsByName.get("ContextDescriptor")!,
    );

    expect(dimensionDeclaration).toBeDefined();
    expect(bindingDeclaration).toBeDefined();
    expect(descriptorDeclaration).toBeDefined();

    const dimensionParameters = dimensionDeclaration?.typeParameters ?? [];
    const bindingParameters = bindingDeclaration?.typeParameters ?? [];
    const descriptorParameters = descriptorDeclaration?.typeParameters ?? [];

    expect(dimensionParameters).toHaveLength(1);
    expect(bindingParameters).toHaveLength(1);
    expect(descriptorParameters).toHaveLength(1);

    expect(
      dimensionParameters[0]?.default &&
        checker.typeToString(
          checker.getTypeFromTypeNode(dimensionParameters[0].default),
        ),
    ).toBe("unknown");
    expect(
      bindingParameters[0]?.default &&
        checker.typeToString(
          checker.getTypeFromTypeNode(bindingParameters[0].default),
        ),
    ).toBe("unknown");
    expect(
      descriptorParameters[0]?.constraint &&
        checker.typeToString(
          checker.getTypeFromTypeNode(descriptorParameters[0].constraint),
        ),
    ).toBe("ContextBinding<unknown>");
    expect(
      descriptorParameters[0]?.default &&
        checker.typeToString(
          checker.getTypeFromTypeNode(descriptorParameters[0].default),
        ),
    ).toBe("ContextBinding<unknown>");

    const exactShapes = new Map<string, string[]>([
      ["ContextBinding", ["dimension", "value"]],
      ["ContextDescriptor", ["bindings"]],
    ]);

    for (const [typeName, expectedFields] of exactShapes) {
      const symbol = symbolsByName.get(typeName);

      expect(symbol).toBeDefined();
      if (!symbol) {
        continue;
      }

      const fields = checker.getPropertiesOfType(
        checker.getDeclaredTypeOfSymbol(symbol),
      );

      expect(fields.map((field) => field.name).sort()).toEqual(expectedFields);
      for (const field of fields) {
        expect(isReadonly(field)).toBe(true);
      }
    }
  });

  it("declares the Task83 package as a zero-dependency foundation", () => {
    expect(existsSync(packageManifest)).toBe(true);

    if (!existsSync(packageManifest)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.name).toBe("@voltai/context-core");
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it("allows production imports to resolve only within context-core", () => {
    for (const sourcePath of typescriptFiles(sourceRoot)) {
      for (const moduleName of importedModules(sourcePath)) {
        expect(moduleName.startsWith(".")).toBe(true);
        expect(resolvesWithinPackage(sourcePath, moduleName)).toBe(true);
      }
    }
  });
});
