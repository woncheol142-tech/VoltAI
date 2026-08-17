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
const repositoryRoot = resolve(packageRoot, "../..");
const sourceRoot = join(packageRoot, "src");
const entrypoint = join(sourceRoot, "index.ts");
const packageManifest = join(packageRoot, "package.json");
const fixture = join(testDirectory, "fixtures", "validationContracts.ts");

const requiredTask85PublicTypes = [
  "ValidationCriterion",
  "ValidationObservation",
  "ValidationProfile",
];

const currentRejectedValidationConcepts = [
  "ValidationProfileKey",
  "ValidationProfileId",
  "ValidationProfileRevision",
  "ProfileCompleteness",
  "CompleteValidationProfile",
  "ValidationOutcome",
  "ValidationStatus",
  "ValidationSeverity",
  "ValidationDiagnostic",
  "ValidationIssue",
  "ValidationEvidence",
  "ValidationRecord",
  "ValidationRun",
  "ValidationEvent",
  "ValidationExecution",
  "ValidationExecutionStatus",
  "NotRun",
  "MissingObservation",
  "Unobserved",
  "ValidatorId",
  "ValidatorVersion",
  "ValidationObservationId",
  "ValidationProvenance",
  "ValidationContext",
  "ValidationApplicability",
  "ValidationAuthority",
  "ValidationPolicy",
  "ValidationRepository",
  "ValidationStore",
  "ValidationQueryPort",
  "TruthStatus",
  "VerifiedTruth",
  "FactStatus",
  "CorrectKnowledge",
  "ValidatedApplicable",
  "CurrentValidation",
  "LatestValidation",
];

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
};

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

function typeAliasDeclaration(
  symbol: ts.Symbol,
): ts.TypeAliasDeclaration | undefined {
  return symbol
    .getDeclarations()
    ?.find((declaration): declaration is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(declaration),
    );
}

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

describe("validation-core public and package boundaries", () => {
  it("exposes the required Task85 type subset with frozen generics and exact shapes", () => {
    expect(existsSync(entrypoint)).toBe(true);

    if (!existsSync(entrypoint)) {
      return;
    }

    expect(compileDiagnostics([entrypoint])).toEqual([]);

    const program = ts.createProgram({
      rootNames: [entrypoint],
      options: compilerOptions,
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

    for (const requiredType of requiredTask85PublicTypes) {
      expect(publicNames).toContain(requiredType);
    }
    for (const rejectedConcept of currentRejectedValidationConcepts) {
      expect(publicNames).not.toContain(rejectedConcept);
    }

    const symbolsByName = new Map(
      publicSymbols.map((symbol) => {
        expect(symbol.flags & ts.SymbolFlags.Value).toBe(0);

        const target =
          symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;

        expect(target.flags & ts.SymbolFlags.Value).toBe(0);

        if (requiredTask85PublicTypes.includes(symbol.name)) {
          const declaredType = checker.getDeclaredTypeOfSymbol(target);

          expect(declaredType.flags & ts.TypeFlags.Any).toBe(0);
        }

        return [symbol.name, target] as const;
      }),
    );
    const criterionSymbol = symbolsByName.get("ValidationCriterion");
    const observationSymbol = symbolsByName.get("ValidationObservation");
    const profileSymbol = symbolsByName.get("ValidationProfile");

    expect(criterionSymbol).toBeDefined();
    expect(observationSymbol).toBeDefined();
    expect(profileSymbol).toBeDefined();
    if (!criterionSymbol || !observationSymbol || !profileSymbol) {
      return;
    }

    const criterionDeclaration = typeAliasDeclaration(criterionSymbol);
    const observationDeclaration = typeAliasDeclaration(observationSymbol);
    const profileDeclaration = typeAliasDeclaration(profileSymbol);

    expect(criterionDeclaration).toBeDefined();
    expect(observationDeclaration).toBeDefined();
    expect(profileDeclaration).toBeDefined();
    if (
      !criterionDeclaration ||
      !observationDeclaration ||
      !profileDeclaration
    ) {
      return;
    }

    const criterionParameters = criterionDeclaration.typeParameters ?? [];
    const observationParameters = observationDeclaration.typeParameters ?? [];
    const profileParameters = profileDeclaration.typeParameters ?? [];

    expect(criterionParameters).toHaveLength(1);
    expect(observationParameters).toHaveLength(2);
    expect(profileParameters).toHaveLength(1);

    for (const parameter of [
      ...criterionParameters,
      ...observationParameters,
    ]) {
      expect(parameter.default).toBeUndefined();
      expect(parameter.constraint).toBeUndefined();
    }

    const profileParameter = profileParameters[0];

    expect(profileParameter?.default).toBeUndefined();
    expect(profileParameter?.constraint).toBeDefined();
    if (profileParameter?.constraint) {
      const constraintType = checker.getTypeFromTypeNode(
        profileParameter.constraint,
      );

      expect(
        checker.typeToString(
          constraintType,
          profileParameter,
          ts.TypeFormatFlags.NoTruncation,
        ),
      ).toBe("ValidationCriterion<unknown>");
      expect(
        checker.isTypeAssignableTo(checker.getStringType(), constraintType),
      ).toBe(false);
    }

    const exactShapes = new Map<string, string[]>([
      ["ValidationObservation", ["criterion", "outcome", "subject"]],
      ["ValidationProfile", ["criteria"]],
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
    }
  });

  it("declares validation-core as a standard zero-dependency foundation", () => {
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

    expect(manifest.name).toBe("@voltai/validation-core");
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
      "vitest run --root ../.. packages/validation-core/test",
    );
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it("allows validation-core production imports to resolve only internally", () => {
    for (const sourcePath of typescriptFiles(sourceRoot)) {
      for (const moduleName of importedModules(sourcePath)) {
        expect(moduleName.startsWith(".")).toBe(true);
        expect(resolvesWithinPackage(sourcePath, moduleName)).toBe(true);
      }
    }
  });

  it("automatically compiles the validation contract fixture", () => {
    const diagnostics = compileDiagnostics([fixture]);

    expect(diagnostics, diagnostics.join("\n")).toEqual([]);
  });
});
