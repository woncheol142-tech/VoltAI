import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { assertKecDependencyAuthority } from "./helpers/kecDependencyAuthority.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src", "searchFoundation");
const packageIndex = join(packageRoot, "src", "index.ts");
const runtimeFiles = [
  packageIndex,
  join(packageRoot, "src", "tools", "searchKec.ts"),
  join(packageRoot, "src", "knowledge", "embedding.ts"),
  join(packageRoot, "src", "knowledge", "vectorStore.ts"),
  join(packageRoot, "src", "knowledge", "sqliteVectorStore.ts"),
];

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

describe("KEC search foundation dependency boundaries", () => {
  it("provides only the five approved type-contract modules", () => {
    expect(existsSync(sourceRoot)).toBe(true);
    expect(
      sourceFiles(sourceRoot)
        .map((path) => path.slice(sourceRoot.length + 1))
        .sort(),
    ).toEqual([
      "index.ts",
      "lexicalSearcher.ts",
      "rankingStrategy.ts",
      "semanticSearcher.ts",
      "types.ts",
    ]);
  });

  it("has no runtime output or runtime dependency", () => {
    const sources = sourceFiles(sourceRoot);

    expect(sources).toHaveLength(5);
    for (const path of sources) {
      const output = ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          removeComments: true,
        },
      }).outputText;

      expect(output.trim()).toBe("export {};");
    }
  });

  it("does not duplicate low-level vector, model, storage, or cache contracts", () => {
    const forbiddenTerms = [
      "EmbeddingProvider",
      "VectorStore",
      "embedding:",
      "dimensions",
      "cosine",
      "sqlite",
      "OpenAI",
      "fetch(",
      "http://",
      "https://",
      "WeakMap",
      "Map<",
    ];
    const sources = sourceFiles(sourceRoot).map((path) =>
      readFileSync(path, "utf8"),
    );

    expect(sources).toHaveLength(5);
    for (const source of sources) {
      for (const forbiddenTerm of forbiddenTerms) {
        expect(source).not.toContain(forbiddenTerm);
      }
    }
  });

  it("does not connect the type-only foundation to existing runtime modules", () => {
    for (const path of runtimeFiles) {
      expect(readFileSync(path, "utf8")).not.toContain("searchFoundation");
    }
  });

  it("does not require a package-root export", () => {
    expect(readFileSync(packageIndex, "utf8")).not.toContain(
      "./searchFoundation",
    );
  });

  it("does not add network-capable production dependencies", () => {
    assertKecDependencyAuthority(workspaceRoot);
  });
});
