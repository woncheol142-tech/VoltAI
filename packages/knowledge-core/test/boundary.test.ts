import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const sourceRoot = join(packageRoot, "src");
const workspaceRoot = join(packageRoot, "..", "..");
const typeContractFixture = join(testDirectory, "fixtures", "genericContracts.ts");
const typescriptCli = join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

describe("knowledge-core compile-time and dependency boundary", () => {
  it("compiles valid domain generics and rejects invalid schema and locator contracts", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          typeContractFixture,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("does not import MCP, SQLite, Agent, or Review layers", () => {
    expect(existsSync(sourceRoot)).toBe(true);

    if (!existsSync(sourceRoot)) {
      return;
    }

    const forbiddenImports = [
      "@modelcontextprotocol/sdk",
      "node:sqlite",
      "@voltai/agent-review",
      "@voltai/mcp-",
      "sqliteVectorStore",
      "reviewProject",
    ];
    const sources = sourceFiles(sourceRoot).map((path) => readFileSync(path, "utf8"));

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      for (const forbiddenImport of forbiddenImports) {
        expect(source).not.toContain(forbiddenImport);
      }
    }
  });
});
