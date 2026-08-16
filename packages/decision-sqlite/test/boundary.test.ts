import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SqliteDecisionStore } from "../src/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const sourceRoot = join(packageRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory()
      ? sourceFiles(path)
      : extname(entry.name) === ".ts"
        ? [path]
        : [];
  });
}

describe("R16 decision-sqlite source-first package boundary", () => {
  it("loads the synchronous public class from ../src/index.js", () => {
    expect(typeof SqliteDecisionStore).toBe("function");
    expect(existsSync(join(sourceRoot, "index.ts"))).toBe(true);
  });

  it("depends on knowledge-core and excludes SQLite-store, MCP, SDK, and review layers", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const allDependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };

    expect(manifest.name).toBe("@voltai/decision-sqlite");
    expect(manifest.dependencies).toMatchObject({
      "@voltai/knowledge-core": "workspace:*",
    });
    expect(Object.keys(allDependencies)).not.toContain(
      "@voltai/knowledge-sqlite",
    );
    expect(Object.keys(allDependencies)).not.toContain(
      "@modelcontextprotocol/sdk",
    );
    expect(Object.keys(allDependencies)).not.toContain("@voltai/agent-review");
    expect(
      Object.keys(allDependencies).some((name) =>
        name.startsWith("@voltai/mcp-"),
      ),
    ).toBe(false);
  });

  it("keeps production imports source-oriented and free of prohibited package layers", () => {
    const sources = sourceFiles(sourceRoot).map((path) =>
      readFileSync(path, "utf8"),
    );
    const combined = sources.join("\n");

    expect(combined).toContain("@voltai/knowledge-core");
    expect(combined).not.toMatch(
      /(?:from|import\s*\()\s*["'][^"']*(?:\/dist\/|@voltai\/knowledge-sqlite|@voltai\/mcp-|@modelcontextprotocol\/sdk|@voltai\/agent-review)/,
    );
  });

  it("targets the source entry point from RED tests without dist imports", () => {
    const tests = sourceFiles(testDirectory).map((path) =>
      readFileSync(path, "utf8"),
    );
    const combined = tests.join("\n");

    expect(combined).toContain("../src/index.js");
    expect(combined).not.toMatch(/(?:from|import\s*\()\s*["'][^"']*\/dist\//);
  });
});
