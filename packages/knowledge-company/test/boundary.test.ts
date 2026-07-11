import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

describe("knowledge-company dependency boundary", () => {
  it("depends only on knowledge-core in production", () => {
    expect(existsSync(sourceRoot)).toBe(true);

    if (!existsSync(sourceRoot)) {
      return;
    }

    const source = sourceFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([
      "@voltai/knowledge-core",
    ]);
    expect(source).not.toMatch(
      /@voltai\/mcp-kec|@voltai\/agent-review|@modelcontextprotocol\/sdk|\bzod\b/,
    );
  });
});
