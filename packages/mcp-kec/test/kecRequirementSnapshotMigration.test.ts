import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupTempSnapshotDatabases,
  createTempSnapshotDatabase,
  DatabaseSync,
  initializeExactTask91V1Database,
  schemaObjects,
  seedTask91V1Snapshot,
  semanticRows,
  task91Snapshot,
  TASK91_APPLICATION_ID,
  TASK91_V1_TABLES,
  TASK91_V1_USER_VERSION,
  TASK93_USER_VERSION,
  TASK93_V2_TABLES,
} from "./fixtures/requirementSnapshotContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = join(
  packageRoot,
  "src",
  "requirementSnapshot",
  "migrate.ts",
);
const indexPath = join(packageRoot, "src", "requirementSnapshot", "index.ts");
const migrationApiExists =
  existsSync(migrationPath) &&
  /export[^;]*\bmigrateRequirementSnapshotSchemaToV2\b/su.test(
    readFileSync(indexPath, "utf8"),
  );
const nativeRequire = createRequire(import.meta.url);
const nativeNodeModule = nativeRequire(
  "node:module",
) as typeof import("node:module");
const nativeSqlite = nativeRequire(
  "node:sqlite",
) as typeof import("node:sqlite");

type MigrationModule = {
  readonly migrateRequirementSnapshotSchemaToV2: (dbPath: string) => void;
};

async function migrationModule(): Promise<MigrationModule> {
  return import(
    /* @vite-ignore */ fileURLToPath(
      new URL("../src/requirementSnapshot/index.ts", import.meta.url),
    )
  ) as Promise<MigrationModule>;
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

function rawRequirementRows(dbPath: string): {
  readonly snapshots: readonly Record<string, unknown>[];
  readonly members: readonly Record<string, unknown>[];
} {
  return semanticRows(dbPath);
}

afterEach(cleanupTempSnapshotDatabases);

describe("Task93 explicit migration RED gate", () => {
  it("fails explicitly until the explicit v1-to-v2 migration API exists", () => {
    expect(
      migrationApiExists,
      "Task93 migration API is missing: migrateRequirementSnapshotSchemaToV2",
    ).toBe(true);
  });
});

describe.runIf(migrationApiExists)(
  "Task93 explicit Requirement snapshot schema migration",
  () => {
    it("atomically migrates an exact valid v1 DB and preserves every v1 value", async () => {
      const snapshot = task91Snapshot();
      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      seedTask91V1Snapshot(dbPath, snapshot, 41);
      const beforeRows = rawRequirementRows(dbPath);
      const migration = await migrationModule();

      migration.migrateRequirementSnapshotSchemaToV2(dbPath);

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
            "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
          )
          .all() as Array<{ readonly name: string }>;
        expect(tables.map(({ name }) => name)).toEqual(
          [...TASK93_V2_TABLES].sort(),
        );
        const strictTables = database
          .prepare("PRAGMA table_list")
          .all() as Array<{
          readonly name: string;
          readonly strict: number;
        }>;
        for (const table of TASK93_V2_TABLES) {
          expect(strictTables.find(({ name }) => name === table)?.strict).toBe(
            1,
          );
        }
        expect(
          database
            .prepare("SELECT * FROM kec_requirement_snapshot_captures")
            .all(),
        ).toEqual([]);
      } finally {
        database.close();
      }
      expect(rawRequirementRows(dbPath)).toEqual(beforeRows);
      expect(beforeRows.snapshots[0]?.snapshot_id).toBe(41);
      expect(
        beforeRows.members.map(({ population_index }) => population_index),
      ).toEqual([0, 1]);
    });

    it("is an idempotent no-op for an exact valid v2 DB", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const storeModule = (await import(
        /* @vite-ignore */ fileURLToPath(
          new URL("../src/requirementSnapshot/index.ts", import.meta.url),
        )
      )) as {
        readonly KecRequirementSnapshotStore: new (dbPath: string) => {
          close(): void;
        };
      };
      new storeModule.KecRequirementSnapshotStore(dbPath).close();
      const before = schemaObjects(dbPath);
      const migration = await migrationModule();
      migration.migrateRequirementSnapshotSchemaToV2(dbPath);
      expect(schemaObjects(dbPath)).toEqual(before);
    });

    it("rejects a fresh empty DB instead of initializing it", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      const database = new DatabaseSync(dbPath);
      database.close();
      const before = schemaObjects(dbPath);
      const migration = await migrationModule();
      expect(
        categoryOf(() =>
          migration.migrateRequirementSnapshotSchemaToV2(dbPath),
        ),
      ).toBe("schema");
      expect(schemaObjects(dbPath)).toEqual(before);
    });

    it.each([
      ["foreign application id", 0x12345678, TASK91_V1_USER_VERSION],
      ["unsupported version", TASK91_APPLICATION_ID, 3],
    ])("rejects %s without mutation", async (_name, applicationId, version) => {
      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      const database = new DatabaseSync(dbPath);
      database.exec(`PRAGMA application_id = ${applicationId}`);
      database.exec(`PRAGMA user_version = ${version}`);
      database.close();
      const before = schemaObjects(dbPath);
      const migration = await migrationModule();
      expect(
        categoryOf(() =>
          migration.migrateRequirementSnapshotSchemaToV2(dbPath),
        ),
      ).toBe("schema");
      expect(schemaObjects(dbPath)).toEqual(before);
    });

    it("rejects drifted v1 before DDL", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      const database = new DatabaseSync(dbPath);
      database.exec(
        "ALTER TABLE kec_requirement_snapshots ADD COLUMN task93_drift TEXT",
      );
      database.close();
      const before = schemaObjects(dbPath);
      const migration = await migrationModule();
      expect(
        categoryOf(() =>
          migration.migrateRequirementSnapshotSchemaToV2(dbPath),
        ),
      ).toBe("schema");
      expect(schemaObjects(dbPath)).toEqual(before);
    });

    it("rejects corrupt v1 members before DDL with member-corruption", async () => {
      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      const database = new DatabaseSync(dbPath);
      database.exec(`
        INSERT INTO kec_requirement_snapshot_members
          (snapshot_id, population_index, requirement_id, statement, locators_json)
        VALUES (999, 0, 'orphan', 'orphan', '[[1,0,1]]')
      `);
      database.close();
      const before = schemaObjects(dbPath);
      const migration = await migrationModule();
      expect(
        categoryOf(() =>
          migration.migrateRequirementSnapshotSchemaToV2(dbPath),
        ),
      ).toBe("member-corruption");
      expect(schemaObjects(dbPath)).toEqual(before);
    });

    it("rolls back an applied first capture-table DDL when a later allocation fails", async () => {
      const snapshot = task91Snapshot();
      const migration = await migrationModule();

      const { dbPath: calibrationPath } = createTempSnapshotDatabase(
        "voltai-task93-page-calibration-",
      );
      initializeExactTask91V1Database(calibrationPath);
      seedTask91V1Snapshot(calibrationPath, snapshot, 41);
      const calibrationBefore = new DatabaseSync(calibrationPath, {
        readOnly: true,
      });
      const calibrationV1PageCount = Number(
        calibrationBefore.prepare("PRAGMA page_count").get()?.page_count,
      );
      calibrationBefore.close();
      migration.migrateRequirementSnapshotSchemaToV2(calibrationPath);
      const calibrationAfter = new DatabaseSync(calibrationPath, {
        readOnly: true,
      });
      const rootPageCount = (tableName: string): number =>
        Number(
          calibrationAfter
            .prepare(
              `SELECT count(*) AS count
               FROM sqlite_schema
               WHERE tbl_name = ? AND rootpage > 0`,
            )
            .get(tableName)?.count,
        );
      const headerPageBudget = rootPageCount(
        "kec_requirement_snapshot_captures",
      );
      const observationPageBudget = rootPageCount(
        "kec_requirement_snapshot_capture_observations",
      );
      const calibrationV2PageCount = Number(
        calibrationAfter.prepare("PRAGMA page_count").get()?.page_count,
      );
      calibrationAfter.close();
      expect(headerPageBudget).toBeGreaterThan(0);
      expect(observationPageBudget).toBeGreaterThan(0);
      expect(calibrationV2PageCount - calibrationV1PageCount).toBe(
        headerPageBudget + observationPageBudget,
      );

      const { dbPath } = createTempSnapshotDatabase();
      initializeExactTask91V1Database(dbPath);
      seedTask91V1Snapshot(dbPath, snapshot, 41);
      const beforeSchema = schemaObjects(dbPath);
      const beforeRows = rawRequirementRows(dbPath);
      const targetBefore = new DatabaseSync(dbPath, { readOnly: true });
      const v1PageCount = Number(
        targetBefore.prepare("PRAGMA page_count").get()?.page_count,
      );
      targetBefore.close();
      const lateFailureLimit = v1PageCount + headerPageBudget;

      const storeModule = (await import(
        /* @vite-ignore */ fileURLToPath(
          new URL("../src/requirementSnapshot/index.ts", import.meta.url),
        )
      )) as {
        readonly KecRequirementSnapshotStore: new (dbPath: string) => {
          loadSnapshot(
            binding: typeof snapshot.binding,
          ): typeof snapshot | null;
          close(): void;
        };
      };
      const exactV1Preflight = new storeModule.KecRequirementSnapshotStore(
        dbPath,
      );
      expect(exactV1Preflight.loadSnapshot(snapshot.binding)).toEqual(snapshot);
      exactV1Preflight.close();

      let targetConstructorCalls = 0;
      let migrationConnectionLimit: number | undefined;
      function TestDatabaseSync(
        ...args: ConstructorParameters<typeof nativeSqlite.DatabaseSync>
      ): InstanceType<typeof nativeSqlite.DatabaseSync> {
        const database = new nativeSqlite.DatabaseSync(...args);
        if (args[0] === dbPath) {
          targetConstructorCalls += 1;
          database.exec(`PRAGMA max_page_count = ${lateFailureLimit}`);
          const configured = database
            .prepare("PRAGMA max_page_count")
            .get()?.max_page_count;
          if (typeof configured === "number") {
            migrationConnectionLimit = configured;
          }
        }
        return database;
      }

      vi.resetModules();
      vi.doMock("node:module", () => ({
        ...nativeNodeModule,
        createRequire: (filename: string | URL) => {
          const requireFromMigration = nativeNodeModule.createRequire(filename);
          return (specifier: string) =>
            specifier === "node:sqlite"
              ? { ...nativeSqlite, DatabaseSync: TestDatabaseSync }
              : requireFromMigration(specifier);
        },
      }));
      try {
        const injectedMigration = (await import(
          /* @vite-ignore */ fileURLToPath(
            new URL("../src/requirementSnapshot/migrate.ts", import.meta.url),
          )
        )) as MigrationModule;
        expect(() =>
          injectedMigration.migrateRequirementSnapshotSchemaToV2(dbPath),
        ).toThrow();
        expect(targetConstructorCalls).toBe(1);
        expect(migrationConnectionLimit).toBe(lateFailureLimit);
      } finally {
        vi.doUnmock("node:module");
        vi.resetModules();
      }

      expect(schemaObjects(dbPath)).toEqual(beforeSchema);
      expect(rawRequirementRows(dbPath)).toEqual(beforeRows);
      const after = new DatabaseSync(dbPath);
      try {
        expect(after.prepare("PRAGMA application_id").get()).toEqual({
          application_id: TASK91_APPLICATION_ID,
        });
        expect(after.prepare("PRAGMA user_version").get()).toEqual({
          user_version: TASK91_V1_USER_VERSION,
        });
        const tables = after
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
          )
          .all() as Array<{ readonly name: string }>;
        expect(tables.map(({ name }) => name)).toEqual(
          [...TASK91_V1_TABLES].sort(),
        );
      } finally {
        after.close();
      }

      const exactV1AfterFailure = new storeModule.KecRequirementSnapshotStore(
        dbPath,
      );
      expect(exactV1AfterFailure.loadSnapshot(snapshot.binding)).toEqual(
        snapshot,
      );
      exactV1AfterFailure.close();
    });

    it("revalidates exact v1 inside BEGIN IMMEDIATE before capture DDL", () => {
      const source = readFileSync(migrationPath, "utf8");
      expect(source).toMatch(/BEGIN\s+IMMEDIATE/iu);
      const begin = source.search(/BEGIN\s+IMMEDIATE/iu);
      const validation = source.search(/validate[^;]*(?:V1|Schema)/u);
      const createCapture = source.search(
        /CREATE\s+TABLE\s+kec_requirement_snapshot_captures/iu,
      );
      const createObservation = source.search(
        /CREATE\s+TABLE\s+kec_requirement_snapshot_capture_observations/iu,
      );
      const commit = source.search(/\bCOMMIT\b/iu);
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(validation).toBeGreaterThan(begin);
      expect(createCapture).toBeGreaterThan(validation);
      expect(createObservation).toBeGreaterThan(createCapture);
      expect(commit).toBeGreaterThan(createObservation);
    });
  },
);
