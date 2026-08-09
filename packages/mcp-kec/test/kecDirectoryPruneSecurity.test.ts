import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  packageRoot,
  pruneCliPath,
  pruneRoot,
  task60ModulesExist,
  workspaceRoot,
} from "./helpers/kecDirectoryPruneFixture.js";

function listTypeScriptFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("Task 60 authority and mutation boundaries", () => {
  it("is RED until the package-local pruning boundary exists", () => {
    expect(
      task60ModulesExist(),
      "missing Task 60 pruning authority boundary",
    ).toBe(true);
  });

  it("contains no indexing, embedding, parser, Ollama, network, MCP, or recursive authority", () => {
    if (!task60ModulesExist()) return;
    const sources = [pruneCliPath, ...listTypeScriptFiles(pruneRoot)];
    expect(sources.length).toBeGreaterThan(1);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(
        /EmbeddingProvider|createEmbeddingProvider|KEC_EMBED_PROVIDER|OLLAMA_|Ollama|\.embed\s*\(|readPdf|pdfjs|getDocument|createPageChunks|indexKec|executeKecBatchIndex|fetch\s*\(|XMLHttpRequest|WebSocket|node:http|node:https|@modelcontextprotocol|createVoltAiMcpServer|registerTool|recursive\s*:\s*true/iu,
      );
      expect(source).not.toMatch(/localeCompare\s*\(/u);
      expect(source).not.toMatch(/deleteBySourcePath\s*\(/u);
    }
  });

  it("requires Task 60 discovery to consume the Task 59 directory-discovery boundary", () => {
    if (!task60ModulesExist()) return;
    const discoverySources = listTypeScriptFiles(pruneRoot)
      .map((path) => readFileSync(path, "utf8"))
      .filter((source) => source.includes("discoverKecDirectoryPruneScope"));
    expect(discoverySources).toHaveLength(1);
    expect(discoverySources[0]).toMatch(/directoryBatchIndexing/iu);
    expect(discoverySources[0]).not.toMatch(
      /readdirSync|lstatSync|realpathSync/iu,
    );
  });

  it("uses only PROJECT_ROOT and KEC_DB_PATH configuration authority", () => {
    if (!existsSync(pruneCliPath)) return;
    const source = readFileSync(pruneCliPath, "utf8");
    expect(source).toContain("PROJECT_ROOT");
    expect(source).toContain("KEC_DB_PATH");
    expect(source).not.toMatch(
      /KEC_EMBED_|OLLAMA_|OPENAI_|process\.stdin|readline|glob|manifest/iu,
    );
  });

  it("keeps Task 59 additive and free of prune/delete authority", () => {
    const task59 = readFileSync(
      join(packageRoot, "src", "indexKecDirectory.ts"),
      "utf8",
    );
    expect(task59).not.toMatch(
      /pruneKec|directoryPrun|pruneSource|listSourcePaths|INDEX_CHANGED|PRUNE_FAILED/iu,
    );
    expect(task59).not.toMatch(/deleteBySourcePath|DELETE\s+FROM/iu);
  });

  it("does not add Task 60 methods to the broad KnowledgeVectorStore interfaces", () => {
    const generic = readFileSync(
      join(
        workspaceRoot,
        "packages",
        "knowledge-core",
        "src",
        "vectorStore.ts",
      ),
      "utf8",
    );
    const kec = readFileSync(
      join(packageRoot, "src", "knowledge", "vectorStore.ts"),
      "utf8",
    );
    for (const source of [generic, kec]) {
      expect(source).not.toMatch(/listSourcePaths|pruneSourcePaths/iu);
    }
  });

  it("keeps MCP tool registration unchanged and excludes pruning", () => {
    const source = readFileSync(join(packageRoot, "src", "index.ts"), "utf8");
    expect(source).toContain("createIndexKecTool()");
    expect(source).toContain("createSearchKecTool()");
    expect(source).not.toMatch(/prune|deleteSource|directoryPrun/iu);
  });

  it("keeps schema version 1 and adds no source-ownership table or column", () => {
    const source = readFileSync(
      join(workspaceRoot, "packages", "knowledge-sqlite", "src", "schema.ts"),
      "utf8",
    );
    expect(source).toContain("const currentKnowledgeSchemaVersion = 1;");
    expect(source).not.toMatch(
      /CREATE TABLE[^;]*(?:source_ownership|directory_scope|source_fingerprint)|ALTER TABLE[^;]*(?:directory|fingerprint|owner)/iu,
    );
  });
});
