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
const validationEntrypoint = join(
  repositoryRoot,
  "packages",
  "validation-core",
  "src",
  "index.ts",
);
const packageManifest = join(packageRoot, "package.json");
const fixture = join(testDirectory, "fixtures", "promotionContracts.ts");
const vitestConfig = join(repositoryRoot, "vitest.config.ts");

const requiredTask85PublicTypes = [
  "PromotionGate",
  "PromotionGateCriterionDependency",
  "PromotionGateAssessment",
];

const currentRejectedPromotionConcepts = [
  "PromotionGateRequirement",
  "PromotionGateDependency",
  "PromotionGateId",
  "PromotionGateDefinition",
  "PromotionGateRevision",
  "PromotionGateVersion",
  "GateCompleteness",
  "CompleteGateDefinition",
  "PromotionGateProfileDependency",
  "PromotionGateProfileRequirement",
  "PromotionCandidate",
  "PromotionRecord",
  "PromotionEvent",
  "PromotionState",
  "PromotionTransition",
  "PromotionWorkflow",
  "Promoted",
  "PromotedAt",
  "PromotedBy",
  "PromotionTier",
  "KnowledgeTier",
  "PromotionEligibility",
  "EligibilityStatus",
  "PromotionStatus",
  "NotRun",
  "MissingObservation",
  "Unobserved",
  "ValidationExecutionStatus",
  "PromotionApplicability",
  "ValidatedApplicable",
  "ApplicablePromotion",
  "PromotionAuthority",
  "PromotionPolicy",
  "PromotionProfile",
  "ExportPolicy",
  "PublishPolicy",
  "PublishingPolicy",
  "DeliveryPolicy",
  "VisibilityPolicy",
  "VisibilityState",
  "ObsidianExportStatus",
  "TrustedKnowledge",
  "AuthoritativePromotion",
  "CertifiedAuthority",
  "TruthStatus",
  "VerifiedTruth",
  "CorrectKnowledge",
  "FactStatus",
  "PromotionRepository",
  "PromotionStore",
  "CurrentPromotionGate",
  "LatestPromotionGate",
  "ActiveGate",
  "WinningGate",
];

const compilerOptions: ts.CompilerOptions = {
  baseUrl: repositoryRoot,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  paths: {
    "@voltai/validation-core": ["packages/validation-core/src/index.ts"],
  },
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
};

type ModuleReference = {
  moduleName: string;
  typeOnly: boolean;
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

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const importClause = node.importClause;

  if (!importClause) {
    return false;
  }
  if (importClause.isTypeOnly) {
    return true;
  }
  if (importClause.name || !importClause.namedBindings) {
    return false;
  }
  if (ts.isNamespaceImport(importClause.namedBindings)) {
    return false;
  }

  return (
    importClause.namedBindings.elements.length > 0 &&
    importClause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function importedModules(path: string): ModuleReference[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const modules: ModuleReference[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push({
        moduleName: node.moduleSpecifier.text,
        typeOnly: importDeclarationIsTypeOnly(node),
      });
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push({
        moduleName: node.moduleSpecifier.text,
        typeOnly: node.isTypeOnly,
      });
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      modules.push({
        moduleName: node.argument.literal.text,
        typeOnly: true,
      });
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      modules.push({
        moduleName: node.arguments[0].text,
        typeOnly: false,
      });
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

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("promotion-core public and package boundaries", () => {
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
    expect(program.getSourceFile(validationEntrypoint)).toBeDefined();
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
    for (const rejectedConcept of currentRejectedPromotionConcepts) {
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
    const gateSymbol = symbolsByName.get("PromotionGate");
    const dependencySymbol = symbolsByName.get(
      "PromotionGateCriterionDependency",
    );
    const assessmentSymbol = symbolsByName.get("PromotionGateAssessment");

    expect(gateSymbol).toBeDefined();
    expect(dependencySymbol).toBeDefined();
    expect(assessmentSymbol).toBeDefined();
    if (!gateSymbol || !dependencySymbol || !assessmentSymbol) {
      return;
    }

    const gateDeclaration = typeAliasDeclaration(gateSymbol);
    const dependencyDeclaration = typeAliasDeclaration(dependencySymbol);
    const assessmentDeclaration = typeAliasDeclaration(assessmentSymbol);

    expect(gateDeclaration).toBeDefined();
    expect(dependencyDeclaration).toBeDefined();
    expect(assessmentDeclaration).toBeDefined();
    if (!gateDeclaration || !dependencyDeclaration || !assessmentDeclaration) {
      return;
    }

    const gateParameters = gateDeclaration.typeParameters ?? [];
    const dependencyParameters = dependencyDeclaration.typeParameters ?? [];
    const assessmentParameters = assessmentDeclaration.typeParameters ?? [];

    expect(gateParameters).toHaveLength(1);
    expect(dependencyParameters).toHaveLength(2);
    expect(assessmentParameters).toHaveLength(2);

    for (const parameter of [
      ...gateParameters,
      ...dependencyParameters,
      ...assessmentParameters,
    ]) {
      expect(parameter.default).toBeUndefined();
      expect(parameter.constraint).toBeUndefined();
    }

    const exactShapes = new Map<string, string[]>([
      ["PromotionGateCriterionDependency", ["criterion", "gate"]],
      ["PromotionGateAssessment", ["assessment", "gate", "subject"]],
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

    const dependencyType = checker.getDeclaredTypeOfSymbol(dependencySymbol);
    const criterionField = checker.getPropertyOfType(
      dependencyType,
      "criterion",
    );

    expect(criterionField).toBeDefined();
    if (criterionField) {
      const criterionType = checker.getTypeOfSymbolAtLocation(
        criterionField,
        dependencyDeclaration,
      );

      expect(criterionType.flags & ts.TypeFlags.Any).toBe(0);
      expect(
        checker.typeToString(
          criterionType,
          dependencyDeclaration,
          ts.TypeFormatFlags.NoTruncation,
        ),
      ).toBe("ValidationCriterion<TOutcome>");
    }
  });

  it("declares promotion-core with exactly the validation-core dependency", () => {
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

    expect(manifest.name).toBe("@voltai/promotion-core");
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
      "vitest run --root ../.. packages/promotion-core/test",
    );
    expect(manifest.dependencies).toEqual({
      "@voltai/validation-core": "workspace:*",
    });
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);
  });

  it("allows only an internal import or the type-only validation-core import", () => {
    if (!existsSync(sourceRoot)) {
      return;
    }

    const externalReferences: ModuleReference[] = [];

    for (const sourcePath of typescriptFiles(sourceRoot)) {
      for (const reference of importedModules(sourcePath)) {
        if (reference.moduleName.startsWith(".")) {
          expect(resolvesWithinPackage(sourcePath, reference.moduleName)).toBe(
            true,
          );
        } else {
          externalReferences.push(reference);
        }
      }
    }

    expect(externalReferences).toEqual([
      { moduleName: "@voltai/validation-core", typeOnly: true },
    ]);
  });

  it("automatically compiles the promotion fixture with source mapping", () => {
    const diagnostics = compileDiagnostics([fixture]);

    expect(diagnostics, diagnostics.join("\n")).toEqual([]);
  });

  it("requires only the current validation-core Vitest source alias", () => {
    const source = readFileSync(vitestConfig, "utf8");

    expect({
      promotionPackageAliasOccurrences: occurrences(
        source,
        '"@voltai/promotion-core"',
      ),
      promotionSourcePathOccurrences: occurrences(
        source,
        '"./packages/promotion-core/src/index.ts"',
      ),
      validationPackageAliasOccurrences: occurrences(
        source,
        '"@voltai/validation-core"',
      ),
      validationSourcePathOccurrences: occurrences(
        source,
        '"./packages/validation-core/src/index.ts"',
      ),
    }).toEqual({
      promotionPackageAliasOccurrences: 0,
      promotionSourcePathOccurrences: 0,
      validationPackageAliasOccurrences: 1,
      validationSourcePathOccurrences: 1,
    });
  });
});
