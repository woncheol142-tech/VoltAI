import { existsSync, readFileSync } from "node:fs";
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
  initializeExactTask91V1Database,
  schemaObjects,
  task91Snapshot,
  TASK91_APPLICATION_ID,
  TASK91_V1_TABLES,
  TASK91_V1_USER_VERSION,
  TASK93_USER_VERSION,
  TASK93_V2_TABLES,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const storePath = join(packageRoot, "src", "requirementSnapshot", "index.ts");
const schemaPath = join(packageRoot, "src", "requirementSnapshot", "schema.ts");
const storeExists = existsSync(storePath);
const schemaSource = readFileSync(schemaPath, "utf8");
const schemaV2Declared = /requirementSnapshotSchemaVersion\s*=\s*2\b/u.test(
  schemaSource,
);

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

describe("Task93 current SQLite schema RED gate", () => {
  it("fails explicitly until the current schema version is v2", () => {
    expect(
      schemaV2Declared,
      "Task93 requires requirementSnapshotSchemaVersion = 2",
    ).toBe(true);
  });
});

describe.runIf(storeExists)("Task91 v1 compatibility authority", () => {
  afterEach(cleanupTempSnapshotDatabases);

  it("keeps the predecessor application id, v1 number, and exact two-table fixture", () => {
    expect(TASK91_APPLICATION_ID).toBe(0x56524831);
    expect(TASK91_V1_USER_VERSION).toBe(1);
    expect(TASK91_V1_TABLES).toEqual([
      "kec_requirement_snapshots",
      "kec_requirement_snapshot_members",
    ]);
  });

  it("opens an exact valid v1 database without migration or mutation", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    initializeExactTask91V1Database(dbPath);
    const before = schemaObjects(dbPath);
    const Constructor = await StoreConstructor();
    new Constructor(dbPath).close();

    expect(schemaObjects(dbPath)).toEqual(before);
    const database = new DatabaseSync(dbPath);
    try {
      expect(database.prepare("PRAGMA application_id").get()).toEqual({
        application_id: TASK91_APPLICATION_ID,
      });
      expect(database.prepare("PRAGMA user_version").get()).toEqual({
        user_version: TASK91_V1_USER_VERSION,
      });
    } finally {
      database.close();
    }
  });

  it("keeps the legacy store API readable and writable on exact v1", async () => {
    const snapshot = task91Snapshot();
    const { dbPath } = createTempSnapshotDatabase();
    initializeExactTask91V1Database(dbPath);
    const Constructor = await StoreConstructor();
    const store = new Constructor(dbPath);
    store.storeSnapshot(snapshot);
    expect(store.loadSnapshot(snapshot.binding)).toEqual(snapshot);
    store.close();
    const database = new DatabaseSync(dbPath);
    expect(database.prepare("PRAGMA user_version").get()).toEqual({
      user_version: TASK91_V1_USER_VERSION,
    });
    database.close();
  });

  it("retains the bounded Task91 orphan-member audit on v1", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    initializeExactTask91V1Database(dbPath);
    const database = new DatabaseSync(dbPath);
    database
      .prepare(
        `INSERT INTO kec_requirement_snapshot_members
           (snapshot_id, population_index, requirement_id, statement, locators_json)
         VALUES (999, 0, 'orphan', 'orphan', '[[1,0,1]]')`,
      )
      .run();
    database.close();
    const Constructor = await StoreConstructor();
    expect(categoryOf(() => new Constructor(dbPath))).toBe("member-corruption");
  });

  it("rejects drifted v1 without migration or repair", async () => {
    const { dbPath } = createTempSnapshotDatabase();
    initializeExactTask91V1Database(dbPath);
    const database = new DatabaseSync(dbPath);
    database.exec(
      "ALTER TABLE kec_requirement_snapshots ADD COLUMN task93_drift TEXT",
    );
    database.close();
    const before = schemaObjects(dbPath);
    const Constructor = await StoreConstructor();
    expect(categoryOf(() => new Constructor(dbPath))).toBe("schema");
    expect(schemaObjects(dbPath)).toEqual(before);
  });

  it.each([
    ["foreign application id", { applicationId: 0x12345678 }],
    ["unsupported future version", { userVersion: 3 }],
    ["unrelated nonempty database", { unrelated: true }],
  ])("rejects %s without adoption or repair", async (_name, options) => {
    const { dbPath } = createTempSnapshotDatabase();
    createCandidateSchema(dbPath, options);
    const Constructor = await StoreConstructor();
    expect(categoryOf(() => new Constructor(dbPath))).toBe("schema");
  });
});

describe.runIf(schemaV2Declared && storeExists)(
  "Task93 exact SQLite schema v2",
  () => {
    afterEach(cleanupTempSnapshotDatabases);

    it("initializes a pristine database directly as v2 with four tables", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      new Constructor(dbPath).close();
      const database = new DatabaseSync(dbPath);
      try {
        expect(database.prepare("PRAGMA application_id").get()).toEqual({
          application_id: TASK91_APPLICATION_ID,
        });
        expect(database.prepare("PRAGMA user_version").get()).toEqual({
          user_version: TASK93_USER_VERSION,
        });
        const tables = database
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type = 'table' ORDER BY name`,
          )
          .all() as Array<{ readonly name: string }>;
        expect(tables.map(({ name }) => name)).toEqual(
          [...TASK93_V2_TABLES].sort(),
        );
      } finally {
        database.close();
      }
    });

    it("reopens an exact valid v2 database without mutation", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      new Constructor(dbPath).close();
      const before = schemaObjects(dbPath);
      new Constructor(dbPath).close();
      expect(schemaObjects(dbPath)).toEqual(before);
    });

    it("keeps v1 columns unchanged and freezes exact capture columns", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      new Constructor(dbPath).close();
      const database = new DatabaseSync(dbPath);
      try {
        const expectedColumns = new Map<string, readonly string[]>([
          [
            "kec_requirement_snapshots",
            [
              "snapshot_id",
              "source_identity",
              "revision_key",
              "blob_algorithm",
              "blob_digest",
              "extraction_contract",
              "locator_space",
            ],
          ],
          [
            "kec_requirement_snapshot_members",
            [
              "snapshot_id",
              "population_index",
              "requirement_id",
              "statement",
              "locators_json",
            ],
          ],
          [
            "kec_requirement_snapshot_captures",
            ["snapshot_id", "capture_contract"],
          ],
          [
            "kec_requirement_snapshot_capture_observations",
            [
              "snapshot_id",
              "capture_contract",
              "observation_index",
              "kind",
              "payload_json",
            ],
          ],
        ]);
        const tableList = database.prepare("PRAGMA table_list").all() as Array<{
          readonly name: string;
          readonly strict: number;
        }>;
        for (const [table, columns] of expectedColumns) {
          expect(tableList.find(({ name }) => name === table)?.strict).toBe(1);
          const observed = database
            .prepare(`PRAGMA table_info(${table})`)
            .all() as Array<{ readonly name: string }>;
          expect(observed.map(({ name }) => name)).toEqual(columns);
        }
      } finally {
        database.close();
      }
    });

    it("freezes capture keys with no FK, CHECK, or trigger", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      new Constructor(dbPath).close();
      const database = new DatabaseSync(dbPath);
      try {
        const headerColumns = database
          .prepare("PRAGMA table_info(kec_requirement_snapshot_captures)")
          .all() as Array<{ readonly name: string; readonly pk: number }>;
        expect(
          headerColumns
            .filter(({ pk }) => pk > 0)
            .sort((left, right) => left.pk - right.pk)
            .map(({ name }) => name),
        ).toEqual(["snapshot_id", "capture_contract"]);

        const observationColumns = database
          .prepare(
            "PRAGMA table_info(kec_requirement_snapshot_capture_observations)",
          )
          .all() as Array<{ readonly name: string; readonly pk: number }>;
        expect(
          observationColumns
            .filter(({ pk }) => pk > 0)
            .sort((left, right) => left.pk - right.pk)
            .map(({ name }) => name),
        ).toEqual(["snapshot_id", "capture_contract", "observation_index"]);

        const objects = database
          .prepare("SELECT type, sql FROM sqlite_schema")
          .all() as Array<{
          readonly type: string;
          readonly sql: string | null;
        }>;
        const tableSql = objects
          .filter(({ type }) => type === "table")
          .map(({ sql }) => sql ?? "")
          .join("\n");
        expect(tableSql).not.toMatch(/\bFOREIGN\s+KEY\b|\bCHECK\s*\(/iu);
        expect(objects.filter(({ type }) => type === "trigger")).toEqual([]);
        for (const table of TASK93_V2_TABLES) {
          expect(
            database.prepare(`PRAGMA foreign_key_list(${table})`).all(),
          ).toEqual([]);
        }
      } finally {
        database.close();
      }
    });

    it("rejects v2 schema drift without repairing it", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const Constructor = await StoreConstructor();
      new Constructor(dbPath).close();
      const before = new DatabaseSync(dbPath);
      before.exec(
        "ALTER TABLE kec_requirement_snapshot_captures ADD COLUMN drift TEXT",
      );
      const driftBefore = schemaObjects(dbPath);
      before.close();

      expect(categoryOf(() => new Constructor(dbPath))).toBe("schema");
      expect(schemaObjects(dbPath)).toEqual(driftBefore);
    });
  },
);
