import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { createKecDirectoryPruneDependencies } from "../src/directoryPruning/createKecDirectoryPruneDependencies.js";
import { prepareKecDirectoryPrune } from "../src/directoryPruning/prepareKecDirectoryPrune.js";
import { withPruneFixture } from "./helpers/kecDirectoryPruneFixture.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const shippedSourceStorePath = join(
  packageRoot,
  "src",
  "directoryPruning",
  "createKecDirectoryPruneDependencies.ts",
);

type Dependencies = ReturnType<typeof createKecDirectoryPruneDependencies>;
type SourceStore = Awaited<ReturnType<Dependencies["createStore"]>>;

type SeedRow = Readonly<{
  collection: string;
  sourcePath: string;
  chunkIndex?: number;
}>;

type RawMetadataRow = Readonly<{
  id: string;
  embedding_provider: string;
  embedding_model: string;
  dimensions: number;
  indexed_at: string;
}>;

function initializeDatabase(
  databasePath: string,
  rows: readonly SeedRow[],
  metadataCollections: readonly string[] = ["kec"],
): void {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE kec_chunks (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        locator_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        page INTEGER,
        clause TEXT,
        PRIMARY KEY (collection, id)
      );

      CREATE TABLE index_metadata (
        id TEXT PRIMARY KEY,
        embedding_provider TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
    const insertChunk = database.prepare(`
      INSERT INTO kec_chunks (
        collection, id, document_id, source_path, chunk_index,
        locator_json, metadata_json, text, embedding, page, clause
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rows.forEach((row, rowIndex) => {
      const chunkIndex = row.chunkIndex ?? rowIndex;
      insertChunk.run(
        row.collection,
        `${row.collection}:${row.sourcePath}#chunk=${chunkIndex}`,
        `${row.collection}:${row.sourcePath}`,
        row.sourcePath,
        chunkIndex,
        JSON.stringify({ kind: "page", page: chunkIndex + 1 }),
        JSON.stringify({ clause: null }),
        `indexed ${row.sourcePath} ${chunkIndex}`,
        "[1,0]",
        chunkIndex + 1,
        null,
      );
    });
    const insertMetadata = database.prepare(`
      INSERT INTO index_metadata (
        id, embedding_provider, embedding_model, dimensions, indexed_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const collection of metadataCollections) {
      insertMetadata.run(
        collection,
        "test",
        "task61-shipped-store",
        2,
        "2026-08-10T00:00:00.000Z",
      );
    }
  } finally {
    database.close();
  }
}

async function withShippedStore(
  databasePath: string,
  operation: (dependencies: Dependencies, store: SourceStore) => Promise<void>,
): Promise<void> {
  const dependencies = createKecDirectoryPruneDependencies();
  dependencies.assertDatabaseAvailable(databasePath);
  const store = await dependencies.createStore(databasePath);
  try {
    await operation(dependencies, store);
  } finally {
    await dependencies.closeStore(store);
  }
}

function rawSourcePaths(
  databasePath: string,
  collection: string,
): readonly string[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT DISTINCT source_path
         FROM kec_chunks
         WHERE collection = ?
         ORDER BY source_path`,
      )
      .all(collection) as Array<{ source_path: string }>;
    return rows.map((row) => row.source_path);
  } finally {
    database.close();
  }
}

function rawChunkCount(
  databasePath: string,
  collection: string,
  sourcePath: string,
): number {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM kec_chunks
         WHERE collection = ? AND source_path = ?`,
      )
      .get(collection, sourcePath) as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

function metadataExists(databasePath: string, collection: string): boolean {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (
      database
        .prepare("SELECT id FROM index_metadata WHERE id = ?")
        .get(collection) !== undefined
    );
  } finally {
    database.close();
  }
}

function rawMetadataRow(
  databasePath: string,
  collection: string,
): RawMetadataRow | null {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare(
        `SELECT id, embedding_provider, embedding_model, dimensions, indexed_at
         FROM index_metadata
         WHERE id = ?`,
      )
      .get(collection) as RawMetadataRow | undefined;
    return row === undefined ? null : Object.freeze({ ...row });
  } finally {
    database.close();
  }
}

function executeSql(databasePath: string, sql: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

function independentSourceId(sourcePath: string): string {
  return `kecsrc_${createHash("sha256").update(sourcePath, "utf8").digest("hex")}`;
}

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error instance from shipped source store");
  }
  throw new Error("Expected shipped source-store operation to fail");
}

function isIdentifier(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function isBinaryComparison(
  node: ts.Expression,
  operator: ts.SyntaxKind.LessThanToken | ts.SyntaxKind.GreaterThanToken,
): boolean {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === operator &&
    isIdentifier(node.left, "left") &&
    isIdentifier(node.right, "right")
  );
}

function isNumericValue(node: ts.Expression, value: -1 | 0 | 1): boolean {
  if (value === -1) {
    return (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand) &&
      node.operand.text === "1"
    );
  }
  return ts.isNumericLiteral(node) && node.text === String(value);
}

function assertShippedJavaScriptComparatorContract(source: string): void {
  const sourceFile = ts.createSourceFile(
    "createKecDirectoryPruneDependencies.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const asciiOrderFunctions = sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "asciiOrder",
  );
  if (asciiOrderFunctions.length !== 1) {
    throw new Error("Shipped asciiOrder declaration is missing or duplicated");
  }
  const asciiOrder = asciiOrderFunctions[0];
  if (
    asciiOrder.parameters.length !== 2 ||
    !isIdentifier(asciiOrder.parameters[0].name, "left") ||
    !isIdentifier(asciiOrder.parameters[1].name, "right") ||
    asciiOrder.body?.statements.length !== 1
  ) {
    throw new Error("Shipped asciiOrder signature or body changed");
  }
  const returnStatement = asciiOrder.body.statements[0];
  const expression = ts.isReturnStatement(returnStatement)
    ? returnStatement.expression
    : undefined;
  if (
    expression === undefined ||
    !ts.isConditionalExpression(expression) ||
    !isBinaryComparison(expression.condition, ts.SyntaxKind.LessThanToken) ||
    !isNumericValue(expression.whenTrue, -1) ||
    !ts.isConditionalExpression(expression.whenFalse) ||
    !isBinaryComparison(
      expression.whenFalse.condition,
      ts.SyntaxKind.GreaterThanToken,
    ) ||
    !isNumericValue(expression.whenFalse.whenTrue, 1) ||
    !isNumericValue(expression.whenFalse.whenFalse, 0)
  ) {
    throw new Error("Shipped asciiOrder no longer uses JavaScript < / >");
  }

  const canonicalFunctions = sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "canonicalSourcePaths",
  );
  if (canonicalFunctions.length !== 1) {
    throw new Error(
      "Shipped canonicalSourcePaths declaration is missing or duplicated",
    );
  }
  let approvedSortCalls = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "sort" &&
      node.arguments.length === 1 &&
      isIdentifier(node.arguments[0], "asciiOrder")
    ) {
      approvedSortCalls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(canonicalFunctions[0]);
  if (approvedSortCalls !== 1) {
    throw new Error("Shipped canonicalSourcePaths is not bound to asciiOrder");
  }
}

describe("Task 61 shipped SQLite KEC source-store migration", () => {
  it("T1 deduplicates multiple chunks into one source identity", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const sourcePath = "manuals/multi.pdf";
      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath, chunkIndex: 0 },
        { collection: "kec", sourcePath, chunkIndex: 1 },
        { collection: "kec", sourcePath, chunkIndex: 2 },
      ]);

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await expect(store.listSourcePaths("kec")).resolves.toEqual([
          sourcePath,
        ]);
        await store.pruneSourcePaths("kec", [sourcePath], [sourcePath]);
      });

      expect(rawChunkCount(databasePath, "kec", sourcePath)).toBe(0);
    });
  });

  it("T2 enumerates a unique deterministic collection-scoped snapshot", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      initializeDatabase(
        databasePath,
        [
          { collection: "kec", sourcePath: "manuals/zeta.pdf", chunkIndex: 0 },
          { collection: "kec", sourcePath: "manuals/zeta.pdf", chunkIndex: 1 },
          { collection: "kec", sourcePath: "manuals/alpha.pdf" },
          { collection: "company", sourcePath: "manuals/company.pdf" },
        ],
        ["kec", "company"],
      );

      await withShippedStore(databasePath, async (_dependencies, store) => {
        const kec = await store.listSourcePaths("kec");
        expect(kec).toEqual(["manuals/alpha.pdf", "manuals/zeta.pdf"]);
        expect(Object.isFrozen(kec)).toBe(true);
        await expect(store.listSourcePaths("company")).resolves.toEqual([
          "manuals/company.pdf",
        ]);
      });
    });
  });

  it("T3 rejects duplicate normalized snapshots", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const sourcePath = "manuals/duplicate.pdf";
      initializeDatabase(databasePath, [{ collection: "kec", sourcePath }]);

      await withShippedStore(databasePath, async (_dependencies, store) => {
        const duplicateExpectedError = await captureError(() =>
          store.pruneSourcePaths("kec", [sourcePath, sourcePath], [sourcePath]),
        );
        expect(duplicateExpectedError.message).toBe(
          "KEC source snapshot contains duplicate paths",
        );
        const duplicateStaleError = await captureError(() =>
          store.pruneSourcePaths("kec", [sourcePath], [sourcePath, sourcePath]),
        );
        expect(duplicateStaleError.message).toBe(
          "KEC source snapshot contains duplicate paths",
        );
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([sourcePath]);
    });
  });

  it("T4 rolls back completely when the first ordered delete fails", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const expected = ["manuals/first.pdf", "manuals/second.pdf"];
      initializeDatabase(
        databasePath,
        expected.map((sourcePath) => ({ collection: "kec", sourcePath })),
      );
      executeSql(
        databasePath,
        `CREATE TRIGGER task61_fail_first BEFORE DELETE ON kec_chunks
         WHEN OLD.collection = 'kec' AND OLD.source_path = 'manuals/first.pdf'
         BEGIN SELECT RAISE(ABORT, 'task61 first delete secret'); END`,
      );

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await expect(
          store.pruneSourcePaths("kec", expected, expected),
        ).rejects.toBeDefined();
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual(expected);
      expect(metadataExists(databasePath, "kec")).toBe(true);
    });
  });

  it("T5 rolls back prior deletes when a middle ordered delete fails", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const suppliedOrder = [
        "manuals/first.pdf",
        "manuals/middle.pdf",
        "manuals/last.pdf",
      ];
      initializeDatabase(
        databasePath,
        suppliedOrder.map((sourcePath) => ({ collection: "kec", sourcePath })),
      );
      executeSql(
        databasePath,
        `CREATE TRIGGER task61_fail_middle BEFORE DELETE ON kec_chunks
         WHEN OLD.collection = 'kec' AND OLD.source_path = 'manuals/middle.pdf'
         BEGIN SELECT RAISE(ABORT, 'task61 middle delete secret'); END`,
      );

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await expect(
          store.pruneSourcePaths("kec", suppliedOrder, suppliedOrder),
        ).rejects.toBeDefined();
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([
        "manuals/first.pdf",
        "manuals/last.pdf",
        "manuals/middle.pdf",
      ]);
      expect(metadataExists(databasePath, "kec")).toBe(true);
    });
  });

  it("T6 rolls back completely when metadata cleanup fails", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const expected = ["manuals/first.pdf", "manuals/second.pdf"];
      initializeDatabase(
        databasePath,
        expected.map((sourcePath) => ({ collection: "kec", sourcePath })),
      );
      executeSql(
        databasePath,
        `CREATE TRIGGER task61_fail_metadata BEFORE DELETE ON index_metadata
         WHEN OLD.id = 'kec'
         BEGIN SELECT RAISE(ABORT, 'task61 metadata cleanup secret'); END`,
      );

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await expect(
          store.pruneSourcePaths("kec", expected, expected),
        ).rejects.toBeDefined();
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual(expected);
      expect(metadataExists(databasePath, "kec")).toBe(true);
    });
  });

  it("T7 surfaces lock failure without committing an approved mutation", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const expected = ["manuals/active.pdf", "manuals/stale.pdf"];
      initializeDatabase(
        databasePath,
        expected.map((sourcePath) => ({ collection: "kec", sourcePath })),
      );

      await withShippedStore(databasePath, async (_dependencies, store) => {
        const reader = new DatabaseSync(databasePath, { readOnly: true });
        let readerTransaction = false;
        try {
          reader.exec("BEGIN");
          readerTransaction = true;
          reader.prepare("SELECT id FROM kec_chunks ORDER BY id").all();
          await expect(
            store.pruneSourcePaths("kec", expected, [expected[1]]),
          ).rejects.toBeDefined();
        } finally {
          if (readerTransaction) reader.exec("ROLLBACK");
          reader.close();
        }
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual(expected);
      expect(metadataExists(databasePath, "kec")).toBe(true);
    });
  });

  it("T8 reports exact INDEX_CHANGED and performs no prune deletion", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const expected = ["manuals/active.pdf", "manuals/stale.pdf"];
      initializeDatabase(databasePath, [
        ...expected.map((sourcePath) => ({ collection: "kec", sourcePath })),
        { collection: "kec", sourcePath: "manuals/concurrent.pdf" },
      ]);

      await withShippedStore(databasePath, async (_dependencies, store) => {
        const indexChanged = await captureError(() =>
          store.pruneSourcePaths("kec", expected, [expected[1]]),
        );
        expect(indexChanged.message).toBe("KEC_DIRECTORY_PRUNE: INDEX_CHANGED");
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([
        "manuals/active.pdf",
        "manuals/concurrent.pdf",
        "manuals/stale.pdf",
      ]);
    });
  });

  it("T9 isolates collection-scoped deletion and metadata", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const sharedPath = "manuals/shared.pdf";
      initializeDatabase(
        databasePath,
        [
          { collection: "kec", sourcePath: sharedPath },
          { collection: "company", sourcePath: sharedPath },
        ],
        ["kec", "company"],
      );

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await store.pruneSourcePaths("kec", [sharedPath], [sharedPath]);
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([]);
      expect(rawSourcePaths(databasePath, "company")).toEqual([sharedPath]);
      expect(metadataExists(databasePath, "kec")).toBe(false);
      expect(metadataExists(databasePath, "company")).toBe(true);
    });
  });

  it("T10 removes metadata when zero KEC chunks remain", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const only = "manuals/only.pdf";
      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath: only },
      ]);

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await store.pruneSourcePaths("kec", [only], [only]);
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([]);
      expect(metadataExists(databasePath, "kec")).toBe(false);
    });
  });

  it("T11 preserves metadata while KEC chunks remain", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const active = "manuals/active.pdf";
      const stale = "manuals/stale.pdf";
      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath: active },
        { collection: "kec", sourcePath: stale },
      ]);
      const metadataBefore = rawMetadataRow(databasePath, "kec");
      expect(metadataBefore).toEqual({
        id: "kec",
        embedding_provider: "test",
        embedding_model: "task61-shipped-store",
        dimensions: 2,
        indexed_at: "2026-08-10T00:00:00.000Z",
      });

      await withShippedStore(databasePath, async (_dependencies, store) => {
        await store.pruneSourcePaths("kec", [active, stale], [stale]);
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([active]);
      expect(rawMetadataRow(databasePath, "kec")).toEqual(metadataBefore);
    });
  });

  it("T12 distinguishes SQLite BINARY enumeration from shipped JavaScript snapshot ordering", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const active = "manuals/active.pdf";
      const privateUse = "manuals/\uE000.pdf";
      const emoji = "manuals/😀.pdf";
      const requiredJavaScriptOrder = [
        "manuals/😀.pdf",
        "manuals/\uE000.pdf",
      ] as const;
      expect([emoji, privateUse]).toEqual(requiredJavaScriptOrder);
      expect(emoji < privateUse).toBe(true);

      const shippedSource = readFileSync(shippedSourceStorePath, "utf8");
      expect(() =>
        assertShippedJavaScriptComparatorContract(shippedSource),
      ).not.toThrow();
      const wrongByteOrderSource = shippedSource.replace(
        "  return left < right ? -1 : left > right ? 1 : 0;",
        '  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));',
      );
      expect(wrongByteOrderSource).not.toBe(shippedSource);
      expect(() =>
        assertShippedJavaScriptComparatorContract(wrongByteOrderSource),
      ).toThrow("Shipped asciiOrder no longer uses JavaScript < / >");

      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath: active },
        { collection: "kec", sourcePath: privateUse },
        { collection: "kec", sourcePath: emoji },
      ]);

      await withShippedStore(databasePath, async (_dependencies, store) => {
        const snapshot = await store.listSourcePaths("kec");
        // This order is SQLite BINARY enumeration, not snapshot canonical order.
        expect(snapshot).toEqual([active, privateUse, emoji]);
        await expect(
          store.pruneSourcePaths("kec", snapshot, [privateUse]),
        ).resolves.toBeUndefined();
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([active, emoji]);
    });
  });

  it("T13 rejects a stale source outside the expected snapshot before BEGIN", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const active = "manuals/active.pdf";
      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath: active },
      ]);

      await withShippedStore(databasePath, async (_dependencies, store) => {
        const competingWriter = new DatabaseSync(databasePath);
        try {
          competingWriter.exec("BEGIN IMMEDIATE");
          await expect(
            store.pruneSourcePaths("kec", [active], ["manuals/outside.pdf"]),
          ).rejects.toThrow(
            "KEC prune source is outside the expected snapshot",
          );
        } finally {
          competingWriter.exec("ROLLBACK");
          competingWriter.close();
        }
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([active]);
    });
  });

  it("T14 executes DELETEs and reports results in full sourceId ASCII order", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const active = "manuals/active.pdf";
      const lexicalFirst = "manuals/alpha.pdf";
      const lexicalLast = "manuals/omega.pdf";
      const lexicalFirstId = independentSourceId(lexicalFirst);
      const lexicalLastId = independentSourceId(lexicalLast);
      expect(lexicalLast < lexicalFirst).toBe(false);
      expect(lexicalLastId < lexicalFirstId).toBe(true);

      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath: active },
        { collection: "kec", sourcePath: lexicalFirst },
        { collection: "kec", sourcePath: lexicalLast },
      ]);
      executeSql(
        databasePath,
        `CREATE TABLE task61_delete_audit (
           sequence INTEGER PRIMARY KEY AUTOINCREMENT,
           source_path TEXT NOT NULL
         );
         CREATE TRIGGER task61_audit_delete BEFORE DELETE ON kec_chunks
         WHEN OLD.collection = 'kec'
         BEGIN
           INSERT INTO task61_delete_audit (source_path) VALUES (OLD.source_path);
         END`,
      );

      await withShippedStore(databasePath, async (dependencies, store) => {
        const snapshot = await store.listSourcePaths("kec");
        const plan = prepareKecDirectoryPrune(
          { directoryPath: "manuals", sources: [active] },
          snapshot,
        );
        const result = await dependencies.execute(plan, store);

        expect(result.sources).toEqual([
          { sourceId: lexicalLastId, status: "DELETED" },
          { sourceId: lexicalFirstId, status: "DELETED" },
        ]);
      });

      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const actual = database
          .prepare(
            "SELECT source_path FROM task61_delete_audit ORDER BY sequence",
          )
          .all() as Array<{ source_path: string }>;
        expect(actual.map((row) => row.source_path)).toEqual([
          lexicalLast,
          lexicalFirst,
        ]);
      } finally {
        database.close();
      }
    });
  });

  it("T15 redacts raw SQLite failure through dependencies.execute", async () => {
    await withPruneFixture(async ({ databasePath }) => {
      const active = "manuals/active.pdf";
      const stale = "manuals/stale.pdf";
      const rawSecret = "task61 raw sqlite /private/secret.sqlite";
      initializeDatabase(databasePath, [
        { collection: "kec", sourcePath: active },
        { collection: "kec", sourcePath: stale },
      ]);
      executeSql(
        databasePath,
        `CREATE TRIGGER task61_raw_failure BEFORE DELETE ON kec_chunks
         WHEN OLD.collection = 'kec' AND OLD.source_path = 'manuals/stale.pdf'
         BEGIN SELECT RAISE(ABORT, '${rawSecret}'); END`,
      );

      await withShippedStore(databasePath, async (dependencies, store) => {
        const snapshot = await store.listSourcePaths("kec");
        const plan = prepareKecDirectoryPrune(
          { directoryPath: "manuals", sources: [active] },
          snapshot,
        );
        let captured: unknown;
        try {
          await dependencies.execute(plan, store);
        } catch (error) {
          captured = error;
        }
        expect(captured).toBeInstanceOf(Error);
        expect((captured as Error).message).toBe(
          "KEC_DIRECTORY_PRUNE: PRUNE_FAILED",
        );
        expect((captured as Error).message).not.toContain(rawSecret);
        expect((captured as Error).message).not.toContain(databasePath);
      });

      expect(rawSourcePaths(databasePath, "kec")).toEqual([active, stale]);
    });
  });

  it("T16 neither creates nor migrates databases through prune authority", async () => {
    await withPruneFixture(async ({ databasePath, outsideRoot }) => {
      const missingParent = dirname(databasePath);
      const missingDependencies = createKecDirectoryPruneDependencies();
      expect(() =>
        missingDependencies.assertDatabaseAvailable(databasePath),
      ).toThrow("KEC_DIRECTORY_PRUNE: DATABASE_UNAVAILABLE");
      expect(existsSync(missingParent)).toBe(false);
      expect(existsSync(databasePath)).toBe(false);

      const invalidPath = join(outsideRoot, "invalid.sqlite");
      const invalidBytes = Buffer.from("not a sqlite database\n", "utf8");
      writeFileSync(invalidPath, invalidBytes);
      const invalidDependencies = createKecDirectoryPruneDependencies();
      expect(() =>
        invalidDependencies.assertDatabaseAvailable(invalidPath),
      ).toThrow("KEC_DIRECTORY_PRUNE: DATABASE_UNAVAILABLE");
      expect(readFileSync(invalidPath)).toEqual(invalidBytes);

      const uninitializedPath = join(outsideRoot, "uninitialized.sqlite");
      new DatabaseSync(uninitializedPath).close();
      const uninitializedBytes = readFileSync(uninitializedPath);
      const uninitializedDependencies = createKecDirectoryPruneDependencies();
      expect(() =>
        uninitializedDependencies.assertDatabaseAvailable(uninitializedPath),
      ).toThrow("KEC_DIRECTORY_PRUNE: DATABASE_UNAVAILABLE");
      expect(readFileSync(uninitializedPath)).toEqual(uninitializedBytes);
      const resultingEntries = readdirSync(outsideRoot);
      expect(resultingEntries).toHaveLength(2);
      expect(resultingEntries).toEqual(
        expect.arrayContaining(["invalid.sqlite", "uninitialized.sqlite"]),
      );
    });
  });
});
