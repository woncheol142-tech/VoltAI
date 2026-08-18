import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const entrypoint = join(packageRoot, "src", "index.ts");
const fixture = join(
  testDirectory,
  "fixtures",
  "evidenceRequirementContracts.ts",
);

const requiredTask87Types = ["Evidence", "Requirement"] as const;
const protectedPredecessorTypes = [
  "EvidenceAuthority",
  "KnowledgeAuthorityClass",
  "RequirementApplicability",
  "RequirementConflict",
  "ApplicabilityStatus",
  "ConflictStatus",
  "Inference",
  "Decision",
  "DecisionRecord",
  "DecisionBasis",
] as const;

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
};

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

  if (!diagnostic.file || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );

  return `${relative(repositoryRoot, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`;
}

function compileDiagnostics(rootNames: string[]): string[] {
  const program = ts.createProgram({ rootNames, options: compilerOptions });

  return [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ].map(formatDiagnostic);
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

function isReadonlyProperty(symbol: ts.Symbol): boolean {
  return (
    symbol
      .getDeclarations()
      ?.some(
        (declaration) =>
          ts.canHaveModifiers(declaration) &&
          (ts
            .getModifiers(declaration)
            ?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
            ) ??
            false),
      ) ?? false
  );
}

function sourcePublicSymbols(): {
  checker: ts.TypeChecker;
  publicSymbols: ts.Symbol[];
} {
  const program = ts.createProgram({
    rootNames: [entrypoint],
    options: compilerOptions,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entrypoint);

  expect(sourceFile).toBeDefined();
  if (!sourceFile) {
    return { checker, publicSymbols: [] };
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

  expect(moduleSymbol).toBeDefined();

  return {
    checker,
    publicSymbols: moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [],
  };
}

describe("Task87 evidence and requirement public contracts", () => {
  it("exposes the required type subset with frozen generics and exact shapes", () => {
    expect(existsSync(entrypoint)).toBe(true);
    expect(compileDiagnostics([entrypoint])).toEqual([]);

    const { checker, publicSymbols } = sourcePublicSymbols();
    const publicNames = publicSymbols.map((symbol) => symbol.name);

    expect(publicNames).toEqual(
      expect.arrayContaining([...protectedPredecessorTypes]),
    );

    const missingTask87Types = requiredTask87Types.filter(
      (typeName) => !publicNames.includes(typeName),
    );

    expect(
      missingTask87Types,
      "knowledge-core is missing the Task87 public type exports",
    ).toEqual([]);

    const symbolsByName = new Map(
      publicSymbols.map((symbol) => [symbol.name, symbol] as const),
    );
    const exactShapes = new Map<string, readonly string[]>([
      ["Evidence", ["content", "origin"]],
      ["Requirement", ["id", "statement"]],
    ]);

    for (const [typeName, expectedFields] of exactShapes) {
      const publicSymbol = symbolsByName.get(typeName);

      expect(publicSymbol).toBeDefined();
      if (!publicSymbol) {
        continue;
      }

      expect(publicSymbol.flags & ts.SymbolFlags.Value).toBe(0);

      const target =
        publicSymbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(publicSymbol)
          : publicSymbol;

      expect(target.flags & ts.SymbolFlags.Value).toBe(0);

      const declaration = typeAliasDeclaration(target);

      expect(declaration).toBeDefined();
      if (!declaration) {
        continue;
      }

      const parameters = declaration.typeParameters ?? [];

      expect(parameters).toHaveLength(2);
      for (const parameter of parameters) {
        expect(parameter.default).toBeUndefined();
        expect(parameter.constraint?.getText()).toBe("NonNullable<unknown>");
      }

      const fields = checker.getPropertiesOfType(
        checker.getDeclaredTypeOfSymbol(target),
      );

      expect(fields.map((field) => field.name).sort()).toEqual(
        [...expectedFields].sort(),
      );
      for (const field of fields) {
        expect(isReadonlyProperty(field)).toBe(true);
      }
    }
  });

  it("automatically compiles the Task87 source contract fixture", () => {
    const { publicSymbols } = sourcePublicSymbols();
    const publicNames = publicSymbols.map((symbol) => symbol.name);
    const missingTask87Types = requiredTask87Types.filter(
      (typeName) => !publicNames.includes(typeName),
    );
    const diagnostics = compileDiagnostics([fixture]);

    if (missingTask87Types.length > 0) {
      for (const missingType of missingTask87Types) {
        expect(
          diagnostics.some((diagnostic) =>
            diagnostic.includes(`has no exported member '${missingType}'`),
          ),
        ).toBe(true);
      }
      return;
    }

    expect(diagnostics, diagnostics.join("\n")).toEqual([]);
  });
});
