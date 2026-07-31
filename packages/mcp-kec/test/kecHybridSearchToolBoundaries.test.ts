import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const sourceRoot = join(packageRoot, "src");
const toolSourcePath = join(sourceRoot, "tools", "searchKecHybrid.ts");
const packageIndexPath = join(sourceRoot, "index.ts");

function readSource(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
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

describe("native KEC hybrid MCP architecture boundaries", () => {
  it("reserves exactly the approved future production files", () => {
    expect(existsSync(toolSourcePath)).toBe(true);
    expect(existsSync(packageIndexPath)).toBe(true);
    expect(existsSync(join(sourceRoot, "config", "hybridSearch.ts"))).toBe(
      false,
    );
    expect(
      existsSync(join(sourceRoot, "tools", "searchKecHybridTypes.ts")),
    ).toBe(false);
    expect(existsSync(join(sourceRoot, "tools", "hybridLifecycle.ts"))).toBe(
      false,
    );
  });

  it("defines one internal search_kec_hybrid factory", () => {
    const source = sourceFile(toolSourcePath);
    const factories = source.statements.filter(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === "createSearchKecHybridTool",
    );

    expect(factories).toHaveLength(1);
    expect(
      factories[0]?.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
    ).toBe(true);
    expect(readSource(toolSourcePath)).toContain('"search_kec_hybrid"');
  });

  it("keeps the tool module export surface exact", () => {
    const source = sourceFile(toolSourcePath);
    const exportedNames = source.statements
      .flatMap((statement) => {
        const modifiers = ts.canHaveModifiers(statement)
          ? ts.getModifiers(statement)
          : undefined;
        const isExported = modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );
        if (!isExported) return [];
        if (
          (ts.isTypeAliasDeclaration(statement) ||
            ts.isFunctionDeclaration(statement)) &&
          statement.name
        ) {
          return [statement.name.text];
        }
        return [];
      })
      .sort();

    expect(exportedNames).toEqual([
      "SearchKecHybridInput",
      "SearchKecHybridToolDependencies",
      "SearchKecHybridToolResult",
      "createSearchKecHybridTool",
    ]);
  });

  it("keeps the tool a direct Task 52 adapter without lower-layer calls", () => {
    const source = readSource(toolSourcePath);

    expect(source).toMatch(/\bsearchKecHybrid\s*\(/);
    expect(source).not.toMatch(
      /\b(?:createExistingKecHybridSearch|executeKecSemanticSearch|searchKecLexically|createKecWeightedRankingStrategy|mergeCandidates)\s*\(/,
    );
    expect(source).not.toMatch(
      /\.(?:embed|getIndexMetadata|search|listChunks)\s*\(/,
    );
    expect(source).not.toMatch(
      /\.(?:map|filter|sort|reverse|slice|flatMap|reduce)\s*\(/,
    );
  });

  it("uses the generic SqliteKnowledgeStore and no legacy store", () => {
    const source = readSource(toolSourcePath);

    expect(source).toContain("SqliteKnowledgeStore");
    expect(source).not.toContain("SqliteVectorStore");
    expect(source).toContain("KEC_DB_PATH");
    expect(source).toContain(".voltai");
    expect(source).toContain("kec.sqlite");
  });

  it("contains no network, SQL, logging, cache, retry, or code execution authority", () => {
    const source = readSource(toolSourcePath);

    expect(source).not.toMatch(
      /node:(?:http|https|net|child_process|vm)|\bfetch\s*\(|\bWebSocket\b/,
    );
    expect(source).not.toMatch(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|MATCH|CREATE\s+TABLE)\b/,
    );
    expect(source).not.toMatch(
      /\b(?:eval|Function)\s*\(|console\.|logger|\bretry\b|\bfallback\b/,
    );
    expect(source).not.toMatch(/\b(?:Map|WeakMap|Set|WeakSet)\s*</);
  });

  it("does not expose native Task 52 or the tool factory at package root", () => {
    const source = readSource(packageIndexPath);

    expect(source).not.toMatch(
      /export\s+(?:\{[^}]*\bcreateSearchKecHybridTool\b|(?:async\s+)?function\s+createSearchKecHybridTool)/,
    );
    expect(source).not.toMatch(
      /export\s+(?:\{[^}]*\bsearchKecHybrid\b|(?:async\s+)?function\s+searchKecHybrid)/,
    );
  });

  it("conditionally appends the hybrid tool after the unchanged legacy order", () => {
    const source = readSource(packageIndexPath);
    const legacyPlaceholder = source.indexOf("placeholderTool");
    const legacyIndex = source.indexOf("createIndexKecTool()");
    const legacySearch = source.indexOf("createSearchKecTool()");
    const hybridSearch = source.indexOf("createSearchKecHybridTool(");

    expect(legacyPlaceholder).toBeGreaterThanOrEqual(0);
    expect(legacyIndex).toBeGreaterThan(legacyPlaceholder);
    expect(legacySearch).toBeGreaterThan(legacyIndex);
    expect(hybridSearch).toBeGreaterThan(legacySearch);
    expect(source).toMatch(/\bhybridSearch\b/);
  });

  it("keeps main legacy-only and avoids global registration state", () => {
    const source = readSource(packageIndexPath);
    const main = source.match(
      /export async function main\(\): Promise<void> \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(main).toContain("createServer()");
    expect(main).not.toContain("hybridSearch");
    expect(source).not.toMatch(
      /\b(?:globalThis|global|registry|singleton|cachedTools|toolCache)\b/,
    );
  });

  it("adds no schema migration, package manifest, or root export indirection", () => {
    const toolSource = readSource(toolSourcePath);
    const packageIndex = readSource(packageIndexPath);

    expect(toolSource).not.toMatch(
      /migrate|schemaVersion|ALTER\s+TABLE|CREATE\s+TABLE/,
    );
    expect(packageIndex).not.toMatch(
      /from\s+["']\.\/searchEntryPoints\/index\.js["']\s*;/,
    );
    expect(packageIndex).not.toContain("weightedScore");
  });
});
