import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const packagesRoot = join(root, "packages");
const sourceCapablePackages = [
  ["@voltai/mcp-core", "mcp-core"],
  ["@voltai/knowledge-core", "knowledge-core"],
  ["@voltai/knowledge-sqlite", "knowledge-sqlite"],
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (entry === "dist" || entry === "node_modules") {
      return [];
    }

    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function workspacePackages(): Map<string, string> {
  return new Map(
    readdirSync(packagesRoot).flatMap((directory) => {
      const packageJsonPath = join(packagesRoot, directory, "package.json");

      try {
        const packageJson = JSON.parse(
          readFileSync(packageJsonPath, "utf8"),
        ) as {
          name?: unknown;
        };

        return typeof packageJson.name === "string"
          ? [
              [
                packageJson.name,
                `./packages/${directory}/src/index.ts`,
              ] as const,
            ]
          : [];
      } catch {
        return [];
      }
    }),
  );
}

function importedModuleSpecifiers(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const moduleSpecifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleSpecifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      moduleSpecifiers.push(node.argument.literal.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      moduleSpecifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return moduleSpecifiers;
}

function importedWorkspacePackages(
  packageNames: Set<string>,
): Map<string, string[]> {
  const imports = new Map<string, string[]>();

  for (const file of [
    ...sourceFiles(packagesRoot),
    ...sourceFiles(join(root, "tests")),
  ]) {
    const source = readFileSync(file, "utf8");

    for (const packageName of importedModuleSpecifiers(file, source)) {
      if (!packageNames.has(packageName)) {
        continue;
      }

      imports.set(packageName, [
        ...(imports.get(packageName) ?? []),
        relative(root, file),
      ]);
    }
  }

  return imports;
}

describe("workspace source resolution", () => {
  it("distinguishes module references from ordinary string literals", () => {
    const moduleSpecifiers = importedModuleSpecifiers(
      "module-reference-contract.ts",
      [
        'const packageName = "@voltai/context-core";',
        'import value from "@voltai/static-import";',
        'import type { Value } from "@voltai/type-import";',
        'export type { Value as ExportedValue } from "@voltai/re-export";',
        'type Imported = import("@voltai/import-type").Imported;',
        'const loaded = import("@voltai/dynamic-import");',
        'import "@voltai/side-effect-import";',
      ].join("\n"),
    );

    expect(moduleSpecifiers).toEqual([
      "@voltai/static-import",
      "@voltai/type-import",
      "@voltai/re-export",
      "@voltai/import-type",
      "@voltai/dynamic-import",
      "@voltai/side-effect-import",
    ]);
    expect(moduleSpecifiers).not.toContain("@voltai/context-core");
  });

  it.each(sourceCapablePackages)(
    "%s preserves legacy entries and exposes the approved source-capable root",
    (packageName, directory) => {
      const manifest = JSON.parse(
        readFileSync(join(packagesRoot, directory, "package.json"), "utf8"),
      ) as {
        main?: unknown;
        types?: unknown;
        exports?: Record<string, unknown>;
      };
      const rootExport = manifest.exports?.["."] as
        Record<string, unknown> | undefined;

      expect(manifest.main).toBe("dist/index.js");
      expect(manifest.types).toBe("dist/index.d.ts");
      expect(
        rootExport,
        `${packageName} is missing exports["."]`,
      ).toBeDefined();
      expect(Object.keys(rootExport ?? {})).toEqual([
        "types",
        "voltai-source",
        "default",
      ]);
      expect(rootExport).toEqual({
        types: "./src/index.ts",
        "voltai-source": "./src/index.ts",
        default: "./dist/index.js",
      });
    },
  );

  it("aliases every imported workspace package directly to src/index.ts", () => {
    const packages = workspacePackages();
    const imports = importedWorkspacePackages(new Set(packages.keys()));
    const vitestConfig = readFileSync(join(root, "vitest.config.ts"), "utf8");
    const missing = Array.from(imports.keys()).filter((packageName) => {
      const sourceEntry = packages.get(packageName);

      return (
        !vitestConfig.includes(`"${packageName}"`) ||
        !vitestConfig.includes(sourceEntry ?? "")
      );
    });

    expect(
      missing,
      `Missing source aliases for: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps CI test before build and explicitly removes stale package dist output", () => {
    const workflow = readFileSync(
      join(root, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const testIndex = workflow.indexOf("pnpm test");
    const buildIndex = workflow.indexOf("pnpm build");

    expect(testIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(testIndex);
    expect(workflow).toMatch(/(?:rm -rf|find).*packages.*dist/);
  });
});
