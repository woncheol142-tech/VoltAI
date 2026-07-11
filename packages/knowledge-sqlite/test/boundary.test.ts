import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(testDirectory, "..", "src");

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

describe("knowledge-sqlite dependency boundary", () => {
  it("depends on knowledge-core but not MCP, Agent, or Review layers", () => {
    expect(existsSync(sourceRoot)).toBe(true);

    if (!existsSync(sourceRoot)) {
      return;
    }

    const sources = sourceFiles(sourceRoot).map((path) => readFileSync(path, "utf8"));

    expect(sources.join("\n")).toContain("@voltai/knowledge-core");
    expect(sources.join("\n")).not.toMatch(
      /@modelcontextprotocol\/sdk|@voltai\/mcp-|@voltai\/agent-review|reviewProject|ReviewReport/,
    );
  });
});
