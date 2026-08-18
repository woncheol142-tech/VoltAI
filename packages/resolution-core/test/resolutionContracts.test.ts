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
const packageTsconfig = join(packageRoot, "tsconfig.json");
const fixture = join(testDirectory, "fixtures", "resolutionContracts.ts");

const requiredTask88PublicTypes = [
  "ResolutionQuestion",
  "ResolutionJudgement",
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

type ModuleReference = {
  moduleName: string;
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
      modules.push({ moduleName: node.moduleSpecifier.text });
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push({ moduleName: node.moduleSpecifier.text });
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      modules.push({ moduleName: node.argument.literal.text });
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      modules.push({ moduleName: node.arguments[0].text });
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

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ??
        false)
    : false;
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

function allDiagnostics(program: ts.Program): ts.Diagnostic[] {
  return [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
}

describe("resolution-core Task88 contract", () => {
  it("exposes the GPT-frozen public types with exact semantic structure", () => {
    expect(existsSync(entrypoint)).toBe(true);

    if (!existsSync(entrypoint)) {
      return;
    }

    const program = ts.createProgram({
      rootNames: [entrypoint],
      options: compilerOptions,
    });
    const diagnostics = allDiagnostics(program).map(formatDiagnostic);

    expect(diagnostics, diagnostics.join("\n")).toEqual([]);

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
    const missingRequiredTypes = requiredTask88PublicTypes.filter(
      (typeName) => !publicNames.includes(typeName),
    );

    expect(missingRequiredTypes).toEqual([]);

    const symbolsByName = new Map(
      publicSymbols.map((symbol) => {
        const target =
          symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;

        return [symbol.name, target] as const;
      }),
    );
    const questionSymbol = symbolsByName.get("ResolutionQuestion");
    const judgementSymbol = symbolsByName.get("ResolutionJudgement");

    expect(questionSymbol).toBeDefined();
    expect(judgementSymbol).toBeDefined();
    if (!questionSymbol || !judgementSymbol) {
      return;
    }

    for (const symbol of [questionSymbol, judgementSymbol]) {
      expect(symbol.flags & ts.SymbolFlags.Value).toBe(0);
      expect(symbol.flags & ts.SymbolFlags.TypeAlias).not.toBe(0);
      expect(
        checker.getDeclaredTypeOfSymbol(symbol).flags & ts.TypeFlags.Any,
      ).toBe(0);
    }

    const questionDeclaration = typeAliasDeclaration(questionSymbol);
    const judgementDeclaration = typeAliasDeclaration(judgementSymbol);

    expect(questionDeclaration).toBeDefined();
    expect(judgementDeclaration).toBeDefined();
    if (!questionDeclaration || !judgementDeclaration) {
      return;
    }

    const questionParameters = questionDeclaration.typeParameters ?? [];
    const judgementParameters = judgementDeclaration.typeParameters ?? [];

    expect(questionParameters).toHaveLength(1);
    expect(judgementParameters).toHaveLength(3);
    expect(questionParameters[0]?.name.text).toBe("TOutcome");
    expect(judgementParameters.map((parameter) => parameter.name.text)).toEqual(
      ["TSubject", "TContext", "TOutcome"],
    );

    for (const parameter of [...questionParameters, ...judgementParameters]) {
      expect(parameter.default).toBeUndefined();
      expect(parameter.constraint).toBeUndefined();
    }

    expect(ts.isIntersectionTypeNode(questionDeclaration.type)).toBe(true);
    if (!ts.isIntersectionTypeNode(questionDeclaration.type)) {
      return;
    }

    expect(questionDeclaration.type.types).toHaveLength(2);
    expect(questionDeclaration.type.types[0]?.kind).toBe(
      ts.SyntaxKind.StringKeyword,
    );

    const brandType = questionDeclaration.type.types[1];

    expect(brandType && ts.isTypeLiteralNode(brandType)).toBe(true);
    if (!brandType || !ts.isTypeLiteralNode(brandType)) {
      return;
    }

    expect(brandType.members).toHaveLength(1);
    const brandProperty = brandType.members[0];

    expect(brandProperty && ts.isPropertySignature(brandProperty)).toBe(true);
    if (!brandProperty || !ts.isPropertySignature(brandProperty)) {
      return;
    }

    expect(hasModifier(brandProperty, ts.SyntaxKind.ReadonlyKeyword)).toBe(
      true,
    );
    expect(brandProperty.questionToken).toBeUndefined();
    expect(brandProperty.type?.getText()).toBe("TOutcome");
    expect(ts.isComputedPropertyName(brandProperty.name)).toBe(true);
    if (!ts.isComputedPropertyName(brandProperty.name)) {
      return;
    }

    const brandSymbol = checker.getSymbolAtLocation(
      brandProperty.name.expression,
    );
    const brandDeclaration = brandSymbol?.valueDeclaration;

    expect(brandSymbol).toBeDefined();
    expect(brandDeclaration && ts.isVariableDeclaration(brandDeclaration)).toBe(
      true,
    );
    expect(
      checker.getTypeAtLocation(brandProperty.name.expression).flags &
        ts.TypeFlags.UniqueESSymbol,
    ).not.toBe(0);
    if (!brandDeclaration || !ts.isVariableDeclaration(brandDeclaration)) {
      return;
    }

    const brandDeclarationList = brandDeclaration.parent;
    const brandStatement = brandDeclarationList.parent;

    expect(ts.isVariableDeclarationList(brandDeclarationList)).toBe(true);
    expect(brandDeclarationList.flags & ts.NodeFlags.Const).not.toBe(0);
    expect(ts.isVariableStatement(brandStatement)).toBe(true);
    expect(hasModifier(brandStatement, ts.SyntaxKind.DeclareKeyword)).toBe(
      true,
    );
    expect(hasModifier(brandStatement, ts.SyntaxKind.ExportKeyword)).toBe(
      false,
    );
    expect(brandDeclaration.initializer).toBeUndefined();

    expect(ts.isTypeLiteralNode(judgementDeclaration.type)).toBe(true);
    if (!ts.isTypeLiteralNode(judgementDeclaration.type)) {
      return;
    }

    const judgementMembers = judgementDeclaration.type.members;
    const expectedFieldTypes = new Map([
      ["subject", "TSubject"],
      ["context", "TContext"],
      ["question", "ResolutionQuestion<TOutcome>"],
      ["outcome", "TOutcome"],
    ]);

    expect(
      judgementMembers
        .filter(ts.isPropertySignature)
        .map((member) => member.name.getText())
        .sort(),
    ).toEqual(["context", "outcome", "question", "subject"]);
    expect(judgementMembers).toHaveLength(4);

    for (const member of judgementMembers) {
      expect(ts.isPropertySignature(member)).toBe(true);
      if (!ts.isPropertySignature(member)) {
        continue;
      }

      const fieldName = member.name.getText();

      expect(hasModifier(member, ts.SyntaxKind.ReadonlyKeyword)).toBe(true);
      expect(member.questionToken).toBeUndefined();
      expect(member.type?.getText()).toBe(expectedFieldTypes.get(fieldName));
    }
  });

  it("matches the zero-dependency foundation package scaffold", () => {
    expect(existsSync(packageManifest)).toBe(true);
    expect(existsSync(packageTsconfig)).toBe(true);

    if (!existsSync(packageManifest) || !existsSync(packageTsconfig)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as {
      name?: string;
      version?: string;
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
    const tsconfig = JSON.parse(readFileSync(packageTsconfig, "utf8")) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
      include?: string[];
    };

    expect(manifest.name).toBe("@voltai/resolution-core");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect(manifest.main).toBe("dist/index.js");
    expect(manifest.types).toBe("dist/index.d.ts");
    expect(manifest.exports?.["."]).toEqual({
      types: "./src/index.ts",
      "voltai-source": "./src/index.ts",
      default: "./dist/index.js",
    });
    expect(manifest.scripts).toEqual({
      build: "tsc -p tsconfig.json",
      test: "vitest run --root ../.. packages/resolution-core/test",
    });
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([]);

    expect(tsconfig).toEqual({
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        rootDir: "src",
        outDir: "dist",
      },
      include: ["src/**/*.ts"],
    });
  });

  it("keeps production source references inside resolution-core", () => {
    expect(existsSync(sourceRoot)).toBe(true);

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

    expect(externalReferences).toEqual([]);
  });

  it("loads the source-bound fixture as a compiler root", () => {
    expect(existsSync(fixture)).toBe(true);

    if (!existsSync(fixture)) {
      return;
    }

    const program = ts.createProgram({
      rootNames: [fixture],
      options: compilerOptions,
    });

    expect(
      program.getRootFileNames().map((fileName) => resolve(fileName)),
    ).toContain(resolve(fixture));
    expect(program.getSourceFile(fixture)).toBeDefined();
    expect(program.getSourceFile(entrypoint)).toBeDefined();

    const entrypointSource = program.getSourceFile(entrypoint);

    if (!entrypointSource) {
      return;
    }

    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(entrypointSource);

    expect(moduleSymbol).toBeDefined();
    if (!moduleSymbol) {
      return;
    }

    const publicNames = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.name);
    const missingRequiredTypes = requiredTask88PublicTypes.filter(
      (typeName) => !publicNames.includes(typeName),
    );
    const diagnostics = allDiagnostics(program);
    const formattedDiagnostics = diagnostics.map(formatDiagnostic);

    if (missingRequiredTypes.length > 0) {
      expect(missingRequiredTypes).toEqual([...requiredTask88PublicTypes]);
      expect(
        diagnostics.map((diagnostic) => diagnostic.code),
        formattedDiagnostics.join("\n"),
      ).toEqual([2305, 2305]);

      for (const typeName of requiredTask88PublicTypes) {
        expect(
          formattedDiagnostics.some(
            (diagnostic) =>
              diagnostic.includes("has no exported member") &&
              diagnostic.includes(`'${typeName}'`),
          ),
        ).toBe(true);
      }

      return;
    }

    expect(formattedDiagnostics, formattedDiagnostics.join("\n")).toEqual([]);
  });

  it("contributes no runtime values", async () => {
    const resolutionCore = await import("../src/index.js");

    expect(Object.keys(resolutionCore)).toEqual([]);
  });
});
