import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
} from "../src/knowledge/requirementExtraction.js";
import {
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
  DatabaseSync,
  TASK91_APPLICATION_ID,
  TASK91_USER_VERSION,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const storePath = join(packageRoot, "src", "requirementSnapshot", "index.ts");
const storeExists = existsSync(storePath);
const semanticTables = [
  "kec_requirement_snapshots",
  "kec_requirement_snapshot_members",
] as const;

type Store = {
  storeSnapshot(snapshot: KecRequirementExtractionSnapshot): void;
  loadSnapshot(
    binding: KecRequirementExtractionBinding,
  ): KecRequirementExtractionSnapshot | null;
  close(): void;
};

async function StoreConstructor(): Promise<new (dbPath: string) => Store> {
  const module = (await import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/requirementSnapshot/index.ts", import.meta.url),
    )
  )) as { readonly KecRequirementSnapshotStore: new (dbPath: string) => Store };
  return module.KecRequirementSnapshotStore;
}

function categoryOf(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return typeof error === "object" && error !== null && "category" in error
      ? String(error.category)
      : undefined;
  }
}

function createCandidateSchema(
  dbPath: string,
  options: {
    readonly applicationId?: number;
    readonly userVersion?: number;
    readonly unrelated?: boolean;
  },
): void {
  const database = new DatabaseSync(dbPath);
  try {
    if (options.unrelated) {
      database.exec("CREATE TABLE unrelated (value TEXT) STRICT;");
    }
    database.exec(`PRAGMA application_id = ${options.applicationId ?? 0}`);
    database.exec(`PRAGMA user_version = ${options.userVersion ?? 0}`);
  } finally {
    database.close();
  }
}

describe.runIf(storeExists)("Task91 frozen SQLite schema", () => {
  afterEach(cleanupTempSnapshotDatabases);

  it("initializes only a pristine database with the frozen identity", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    new Constructor(dbPath).close();

    const database = new DatabaseSync(dbPath);
    try {
      expect(TASK91_APPLICATION_ID).toBe(0x56524831);
      expect(TASK91_USER_VERSION).toBe(1);
      expect(database.prepare("PRAGMA application_id").get()).toEqual({
        application_id: 0x56524831,
      });
      expect(database.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 1,
      });
      const objects = database
        .prepare(
          `SELECT type, name FROM sqlite_schema
           WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
        )
        .all() as Array<{ readonly type: string; readonly name: string }>;
      expect(objects.filter(({ type }) => type === "table")).toEqual(
        semanticTables
          .map((name) => ({ type: "table", name }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      expect(objects.filter(({ type }) => type === "trigger")).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("freezes STRICT tables and exact semantic columns", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    new Constructor(dbPath).close();
    const database = new DatabaseSync(dbPath);

    try {
      const tables = database.prepare("PRAGMA table_list").all() as Array<{
        readonly name: string;
        readonly strict: number;
      }>;
      for (const table of semanticTables) {
        expect(tables.find(({ name }) => name === table)?.strict).toBe(1);
      }
      const snapshotColumns = database
        .prepare("PRAGMA table_info(kec_requirement_snapshots)")
        .all() as Array<{ readonly name: string }>;
      expect(snapshotColumns.map(({ name }) => name)).toEqual([
        "snapshot_id",
        "source_identity",
        "revision_key",
        "blob_algorithm",
        "blob_digest",
        "extraction_contract",
        "locator_space",
      ]);
      const memberColumns = database
        .prepare("PRAGMA table_info(kec_requirement_snapshot_members)")
        .all() as Array<{ readonly name: string }>;
      expect(memberColumns.map(({ name }) => name)).toEqual([
        "snapshot_id",
        "population_index",
        "requirement_id",
        "statement",
        "locators_json",
      ]);
    } finally {
      database.close();
    }
  });

  it("freezes the natural key, member keys, BINARY identity, and no FK/CHECK", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    new Constructor(dbPath).close();
    const database = new DatabaseSync(dbPath);

    try {
      const schemaRows = database
        .prepare(
          `SELECT name, sql FROM sqlite_schema
           WHERE type = 'table' AND name IN (?, ?) ORDER BY name`,
        )
        .all(...semanticTables) as Array<{
        readonly name: string;
        readonly sql: string;
      }>;
      const sql = schemaRows.map(({ sql: source }) => source).join("\n");
      expect(sql).not.toMatch(/\bCHECK\s*\(/iu);
      expect(sql).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
      expect(sql).toMatch(/COLLATE\s+BINARY/iu);

      for (const table of semanticTables) {
        expect(
          database.prepare(`PRAGMA foreign_key_list(${table})`).all(),
        ).toEqual([]);
      }

      const snapshotIndexes = database
        .prepare("PRAGMA index_list(kec_requirement_snapshots)")
        .all() as Array<{ readonly name: string; readonly unique: number }>;
      const snapshotKeys = snapshotIndexes
        .filter(({ unique }) => unique === 1)
        .map(({ name }) =>
          (
            database.prepare(`PRAGMA index_info('${name}')`).all() as Array<{
              readonly name: string;
            }>
          ).map((column) => column.name),
        );
      expect(snapshotKeys).toContainEqual([
        "source_identity",
        "revision_key",
        "blob_algorithm",
        "blob_digest",
        "extraction_contract",
        "locator_space",
      ]);
      const naturalKeyIndex = snapshotIndexes.find(({ name, unique }) => {
        if (unique !== 1) return false;
        const columns = database
          .prepare(`PRAGMA index_info('${name}')`)
          .all() as Array<{ readonly name: string }>;
        return (
          JSON.stringify(columns.map((column) => column.name)) ===
          JSON.stringify([
            "source_identity",
            "revision_key",
            "blob_algorithm",
            "blob_digest",
            "extraction_contract",
            "locator_space",
          ])
        );
      });
      expect(naturalKeyIndex).toBeDefined();
      const naturalKeyCollations = database
        .prepare(`PRAGMA index_xinfo('${naturalKeyIndex!.name}')`)
        .all() as Array<{ readonly coll: string; readonly key: number }>;
      expect(
        naturalKeyCollations
          .filter(({ key }) => key === 1)
          .map(({ coll }) => coll),
      ).toEqual(Array.from({ length: 6 }, () => "BINARY"));

      const memberIndexes = database
        .prepare("PRAGMA index_list(kec_requirement_snapshot_members)")
        .all() as Array<{ readonly name: string; readonly unique: number }>;
      const memberKeys = memberIndexes
        .filter(({ unique }) => unique === 1)
        .map(({ name }) =>
          (
            database.prepare(`PRAGMA index_info('${name}')`).all() as Array<{
              readonly name: string;
            }>
          ).map((column) => column.name),
        );
      expect(memberKeys).toContainEqual(["snapshot_id", "population_index"]);
      expect(memberKeys).toContainEqual(["snapshot_id", "requirement_id"]);
    } finally {
      database.close();
    }
  });

  it.each([
    ["foreign application id", { applicationId: 0x12345678 }],
    ["unsupported version", { userVersion: 2 }],
    ["unrelated nonempty database", { unrelated: true }],
  ])("rejects %s without adoption or repair", async (_name, options) => {
    const { dbPath } = createTempSnapshotDatabase();
    createCandidateSchema(dbPath, options);
    const Constructor = await StoreConstructor();
    expect(categoryOf(() => new Constructor(dbPath))).toBe("schema");
  });

  it("performs a bounded open-time orphan audit and keeps it", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    new Constructor(dbPath).close();
    const database = new DatabaseSync(dbPath);
    database
      .prepare(
        `INSERT INTO kec_requirement_snapshot_members
           (snapshot_id, population_index, requirement_id, statement, locators_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(999_999, 0, "orphan", "orphan", "[[1,0,1]]");
    database.close();

    expect(categoryOf(() => new Constructor(dbPath))).toBe("member-corruption");
  });

  it.each([
    [
      "unexpected column",
      "ALTER TABLE kec_requirement_snapshots ADD COLUMN drift TEXT",
    ],
    [
      "owned-table trigger",
      `CREATE TRIGGER task91_drift AFTER INSERT ON kec_requirement_snapshots
       BEGIN SELECT 1; END`,
    ],
  ])("rejects schema drift without repairing it: %s", async (_name, sql) => {
    const { dbPath } = createTempSnapshotDatabase();
    const Constructor = await StoreConstructor();
    new Constructor(dbPath).close();
    const before = new DatabaseSync(dbPath);
    before.exec(sql);
    const driftBefore = before
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
      )
      .all();
    before.close();

    expect(categoryOf(() => new Constructor(dbPath))).toBe("schema");
    const after = new DatabaseSync(dbPath);
    const driftAfter = after
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
      )
      .all();
    after.close();
    expect(driftAfter).toEqual(driftBefore);
  });
});
