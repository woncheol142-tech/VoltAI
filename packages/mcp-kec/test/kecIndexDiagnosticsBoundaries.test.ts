import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertTask61KnowledgeSqliteCompatibility,
  readCompatibilityBaseline,
  readCompatibilityWorkingTree,
} from "./helpers/knowledgeSqliteCompatibility.js";

import {
  createChunksOnlyIndexFixture,
  createCorruptDatabaseFixture,
  createDirectoryPathFixture,
  createEmptyIndexFixture,
  createInvalidSourcePathFixture,
  createLockedDatabaseFixture,
  createMalformedEmbeddingFixture,
  createMalformedMetadataFixture,
  createMalformedSchemaFixture,
  createMetadataDimensionMismatchFixture,
  createMetadataOnlyIndexFixture,
  createMissingDatabaseFixture,
  createMixedDimensionsFixture,
  createMultipleSourcesIndexFixture,
  createPartialSchemaFixture,
  createReadyIndexFixture,
  createSymlinkFixture,
  createUninitializedDatabaseFixture,
  DatabaseSync,
  snapshotArtifacts,
} from "./helpers/kecIndexDiagnosticsFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const diagnosticsRoot = join(sourceRoot, "indexDiagnostics");
const plannedModulePaths = [
  join(diagnosticsRoot, "types.ts"),
  join(diagnosticsRoot, "inspectKecIndex.ts"),
  join(diagnosticsRoot, "serializeKecIndexDiagnostics.ts"),
  join(diagnosticsRoot, "index.ts"),
];

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function readHeadFile(relativePath: string): string {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

describe("KEC index diagnostics approved module boundary", () => {
  it("is RED until exactly the four approved core production modules exist", () => {
    expect(plannedModulePaths.map((path) => existsSync(path))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("keeps the future namespace internal and out of the package root", () => {
    const packageIndex = readSource(join(sourceRoot, "index.ts"));

    expect(packageIndex).not.toMatch(/indexDiagnostics|inspectKecIndex/iu);
  });

  it("keeps default and explicit hybrid MCP runtimes byte-identical to HEAD", () => {
    for (const relativePath of [
      "packages/mcp-kec/src/index.ts",
      "packages/mcp-kec/src/hybrid.ts",
      "packages/mcp-kec/src/tools/searchKec.ts",
      "packages/mcp-kec/src/tools/searchKecHybrid.ts",
    ]) {
      expect(readSource(join(workspaceRoot, relativePath))).toBe(
        readHeadFile(relativePath),
      );
    }
  });

  it("adds the approved CLI boundary without changing environment or Docker files", () => {
    for (const relativePath of [
      ".env.example",
      "Dockerfile",
      "docker-compose.yml",
    ]) {
      expect(readSource(join(workspaceRoot, relativePath))).toBe(
        readHeadFile(relativePath),
      );
    }

    expect(existsSync(join(sourceRoot, "inspectIndex.ts"))).toBe(true);
    expect(
      existsSync(join(packageRoot, "test", "kecIndexDiagnosticsCli.test.ts")),
    ).toBe(true);
    expect(
      existsSync(
        join(packageRoot, "test", "kecIndexDiagnosticsDocumentation.test.ts"),
      ),
    ).toBe(true);
  });

  it("keeps storage schemas, public store interfaces, indexing, search, and providers unchanged", () => {
    for (const relativePath of [
      "packages/knowledge-sqlite/src/schema.ts",
      "packages/knowledge-sqlite/src/sqliteKnowledgeStore.ts",
      "packages/knowledge-core/src/vectorStore.ts",
      "packages/mcp-kec/src/knowledge/vectorStore.ts",
      "packages/mcp-kec/src/knowledge/sqliteVectorStore.ts",
      "packages/mcp-kec/src/knowledge/embedding.ts",
      "packages/mcp-kec/src/knowledge/indexCompatibility.ts",
      "packages/mcp-kec/src/tools/indexKec.ts",
      "packages/mcp-kec/src/searchSemantic/semanticSearchCore.ts",
      "packages/mcp-kec/src/searchLexical/searchKecLexically.ts",
    ]) {
      if (
        relativePath === "packages/knowledge-sqlite/src/sqliteKnowledgeStore.ts"
      ) {
        assertTask61KnowledgeSqliteCompatibility(
          readCompatibilityBaseline(workspaceRoot),
          readCompatibilityWorkingTree(workspaceRoot),
        );
        continue;
      }
      expect(readSource(join(workspaceRoot, relativePath))).toBe(
        readHeadFile(relativePath),
      );
    }
  });

  it("keeps future core files free of runtime, provider, writable-store, and mutation authority", () => {
    const existingSources = plannedModulePaths
      .filter((path) => existsSync(path))
      .map(readSource)
      .join("\n");

    expect(existingSources).not.toMatch(
      /process\.env|@voltai\/mcp-core|EmbeddingProvider|createEmbeddingProvider|SqliteKnowledgeStore|SqliteVectorStore|runStdioServer|createVoltAiMcpServer/iu,
    );
    expect(existingSources).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(|new\s+Function|node:child_process/iu,
    );
    expect(existingSources).not.toMatch(
      /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|VACUUM|REINDEX|ATTACH|DETACH)\b/iu,
    );
    expect(existingSources).not.toMatch(
      /PRAGMA\s+(?:user_version|journal_mode|locking_mode)\s*=/iu,
    );
    expect(existingSources).not.toMatch(
      /console\.|logger|\.loadExtension\s*\(/iu,
    );
    expect(existingSources).not.toMatch(/\b(?:Map|WeakMap|WeakSet)\b/iu);
  });

  it("keeps source paths out of the future public output type", () => {
    const typesPath = join(diagnosticsRoot, "types.ts");
    const source = existsSync(typesPath) ? readSource(typesPath) : "";

    expect(source).not.toMatch(/\bsourcePath\s*:/u);
    expect(source).not.toMatch(/\bdatabasePath\s*:/u);
    expect(source).not.toMatch(/\bendpoint\s*:/u);
    expect(source).not.toMatch(/\bembedding\s*:/u);
    expect(source).not.toMatch(/\btext\s*:/u);
    expect(source).not.toMatch(/\bclause\s*:/u);
  });
});

describe("KEC index diagnostics fixture boundary", () => {
  it("constructs and cleans every approved fixture state without production modules", () => {
    const fixtures = [
      createMissingDatabaseFixture(false),
      createMissingDatabaseFixture(true),
      createCorruptDatabaseFixture(),
      createUninitializedDatabaseFixture(),
      createPartialSchemaFixture(),
      createMalformedSchemaFixture(),
      createEmptyIndexFixture(),
      createMetadataOnlyIndexFixture(),
      createChunksOnlyIndexFixture(),
      createReadyIndexFixture(),
      createMultipleSourcesIndexFixture(),
      createMalformedMetadataFixture(),
      createMalformedEmbeddingFixture("not-json"),
      createMalformedEmbeddingFixture('{"value":1}'),
      createMalformedEmbeddingFixture("[]"),
      createMalformedEmbeddingFixture('[1,"2",3]'),
      createMalformedEmbeddingFixture("[1e999]"),
      createMixedDimensionsFixture(),
      createMetadataDimensionMismatchFixture(),
      createInvalidSourcePathFixture(),
      createSymlinkFixture(),
      createDirectoryPathFixture(),
      createLockedDatabaseFixture(),
    ];

    try {
      expect(fixtures).toHaveLength(23);
      expect(
        fixtures.every((fixture) => fixture.rootPath.startsWith(tmpdir())),
      ).toBe(true);
    } finally {
      for (const fixture of fixtures.reverse()) {
        fixture.cleanup();
      }
    }

    expect(fixtures.every((fixture) => !existsSync(fixture.rootPath))).toBe(
      true,
    );
  });

  it("creates initialized fixture databases only under os.tmpdir and cleans idempotently", () => {
    const fixture = createReadyIndexFixture();

    try {
      expect(fixture.rootPath.startsWith(tmpdir())).toBe(true);
      expect(fixture.databasePath.startsWith(fixture.rootPath)).toBe(true);
      expect(snapshotArtifacts(fixture.databasePath)).toMatchObject({
        parentExists: true,
        databaseExists: true,
        databaseIsSymlink: false,
        walExists: false,
        shmExists: false,
        journalExists: false,
      });

      const database = new DatabaseSync(fixture.databasePath, {
        readOnly: true,
      });
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all();
      database.close();

      expect(tables).toEqual([
        { name: "index_metadata" },
        { name: "kec_chunks" },
      ]);
    } finally {
      fixture.cleanup();
      fixture.cleanup();
    }

    expect(existsSync(fixture.rootPath)).toBe(false);
  });

  it("does not import a production store, provider, PDF, MCP server, or network helper", () => {
    const fixtureSource = readSource(
      join(packageRoot, "test", "helpers", "kecIndexDiagnosticsFixture.ts"),
    );

    expect(fixtureSource).not.toMatch(
      /SqliteKnowledgeStore|SqliteVectorStore|EmbeddingProvider|readPdf|pdfjs|mcp-core|fetch\s*\(|process\.env/iu,
    );
    expect(fixtureSource).not.toMatch(/node:child_process|runStdioServer/iu);
  });
});
