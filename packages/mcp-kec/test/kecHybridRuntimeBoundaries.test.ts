import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const packageIndexPath = join(sourceRoot, "index.ts");
const hybridRuntimePath = join(sourceRoot, "hybrid.ts");
const packageJsonPath = join(packageRoot, "package.json");
const dockerComposePath = join(workspaceRoot, "docker-compose.yml");

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function importSpecifiers(source: ts.SourceFile): string[] {
  return source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) =>
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : "",
    )
    .sort();
}

describe("explicit KEC hybrid runtime architecture boundaries", () => {
  it("keeps the package-root main legacy-only", () => {
    const source = readSource(packageIndexPath);
    const main = source.match(
      /export async function main\(\): Promise<void> \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(main).toContain("runStdioServer(createServer())");
    expect(main).not.toContain("hybridSearch");
    expect(source).not.toMatch(
      /export\s+(?:\{[^}]*\b(?:createHybridServer|readKecHybridRuntimeConfig)\b|(?:async\s+)?function\s+createHybridServer)/,
    );
  });

  it("preserves default package commands", () => {
    const packageJson = JSON.parse(readSource(packageJsonPath)) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toBe("tsx src/index.ts");
    expect(packageJson.scripts.start).toBe("node dist/index.js");
  });

  it("keeps Docker and container defaults on the legacy entrypoint", () => {
    const compose = readSource(dockerComposePath);

    expect(compose).not.toContain("start:hybrid");
    expect(compose).not.toContain("src/hybrid.ts");
    expect(compose).not.toContain("dist/hybrid.js");
  });

  it("reserves a separate runtime with only approved composition imports", () => {
    expect(existsSync(hybridRuntimePath)).toBe(true);

    const source = readSource(hybridRuntimePath);
    const imports = importSpecifiers(sourceFile(hybridRuntimePath));

    expect(imports).toEqual([
      "./index.js",
      "./runtime/hybridRuntimeConfig.js",
      "@voltai/mcp-core",
    ]);
    expect(source).toContain("readKecHybridRuntimeConfig");
    expect(source).toContain("createServer");
    expect(source).toContain("runStdioServer");
    expect(source).toContain("isMainModule");
    expect(
      [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["KEC_HYBRID_SEMANTIC_WEIGHT", "KEC_HYBRID_LEXICAL_WEIGHT"]);
    expect(source).not.toMatch(/Number\s*\(|parseFloat|parseInt|\.trim\s*\(/);
  });

  it("keeps provider, store, search, filesystem, and test authority out", () => {
    expect(existsSync(hybridRuntimePath)).toBe(true);

    const source = readSource(hybridRuntimePath);

    expect(source).not.toMatch(
      /knowledge|search(?:Foundation|Semantic|Lexical|Hybrid|Ranking)|tools\/|agent-review|mcp-agent|test\/|helpers\//,
    );
    expect(source).not.toMatch(
      /node:(?:fs|path|http|https|net|child_process)|Sqlite|EmbeddingProvider|\bfetch\s*\(|console\.|logger/,
    );
    expect(source).not.toMatch(/\b(?:Map|WeakMap|Set|WeakSet)\s*</);
  });

  it("uses the existing guarded main-module convention", () => {
    expect(existsSync(hybridRuntimePath)).toBe(true);

    const source = readSource(hybridRuntimePath);

    expect(source).toMatch(
      /if\s*\(\s*isMainModule\(import\.meta\.url,\s*process\.argv\[1\]\)\s*\)\s*\{\s*await main\(\);\s*\}/,
    );
    expect(source).toMatch(/export function createHybridServer\s*\(/);
    expect(source).toMatch(/export async function main\(\): Promise<void>/);
  });
});
