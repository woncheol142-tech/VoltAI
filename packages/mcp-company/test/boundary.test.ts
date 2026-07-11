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

describe("mcp-company dependency boundary", () => {
  it("composes generic Company knowledge without KEC or Agent dependencies", () => {
    expect(existsSync(sourceRoot)).toBe(true);

    if (!existsSync(sourceRoot)) {
      return;
    }

    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});
    const source = sourceFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(dependencies).toEqual(
      expect.arrayContaining([
        "@voltai/knowledge-company",
        "@voltai/knowledge-core",
        "@voltai/knowledge-sqlite",
        "@voltai/mcp-core",
        "@voltai/mcp-project-files",
      ]),
    );
    expect(dependencies).not.toContain("@voltai/mcp-kec");
    expect(dependencies).not.toContain("@voltai/agent-review");
    expect(source).not.toMatch(/@voltai\/mcp-kec|@voltai\/agent-review/);
  });
});
