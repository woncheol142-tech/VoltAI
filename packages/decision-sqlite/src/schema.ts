import { DecisionStoreError } from "./errors.js";
import type { SqliteDatabase } from "./sqlite.js";

export const currentDecisionSchemaVersion = 1;
export const decisionApplicationId = 0x56444831;

const ownedTables = [
  "decision_records",
  "decision_bases",
  "decision_supersessions",
] as const;

type OwnedTable = (typeof ownedTables)[number];

type TableListRow = {
  schema: string;
  name: string;
  type: string;
  ncol: number;
  wr: number;
  strict: number;
};

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

type IndexListRow = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type IndexKey = readonly [name: string, collation: string];

type RequiredIndex = {
  readonly name: string;
  readonly table: OwnedTable;
  readonly keys: readonly IndexKey[];
  readonly sql: string;
};

const expectedColumns: Record<OwnedTable, readonly TableInfoRow[]> = {
  decision_records: [
    {
      cid: 0,
      name: "namespace",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 1,
    },
    {
      cid: 1,
      name: "record_key",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 2,
    },
    {
      cid: 2,
      name: "selection",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      cid: 3,
      name: "context",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
  ],
  decision_bases: [
    {
      cid: 0,
      name: "decision_namespace",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      cid: 1,
      name: "decision_record_key",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      cid: 2,
      name: "basis",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
  ],
  decision_supersessions: [
    {
      cid: 0,
      name: "superseded_namespace",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      cid: 1,
      name: "superseded_record_key",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      cid: 2,
      name: "superseding_namespace",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
    {
      cid: 3,
      name: "superseding_record_key",
      type: "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: 0,
    },
  ],
};

const recordIdentityKeys: readonly IndexKey[] = [
  ["namespace", "BINARY"],
  ["record_key", "BINARY"],
];

const supersessionIdentityKeys: readonly IndexKey[] = [
  ["superseded_namespace", "BINARY"],
  ["superseded_record_key", "BINARY"],
  ["superseding_namespace", "BINARY"],
  ["superseding_record_key", "BINARY"],
];

const requiredIndexes: readonly RequiredIndex[] = [
  {
    name: "decision_bases_address_idx",
    table: "decision_bases",
    keys: [
      ["decision_namespace", "BINARY"],
      ["decision_record_key", "BINARY"],
    ],
    sql: `CREATE INDEX decision_bases_address_idx
            ON decision_bases (decision_namespace, decision_record_key)`,
  },
  {
    name: "decision_supersessions_superseded_idx",
    table: "decision_supersessions",
    keys: [
      ["superseded_namespace", "BINARY"],
      ["superseded_record_key", "BINARY"],
    ],
    sql: `CREATE INDEX decision_supersessions_superseded_idx
            ON decision_supersessions (superseded_namespace, superseded_record_key)`,
  },
  {
    name: "decision_supersessions_superseding_idx",
    table: "decision_supersessions",
    keys: [
      ["superseding_namespace", "BINARY"],
      ["superseding_record_key", "BINARY"],
    ],
    sql: `CREATE INDEX decision_supersessions_superseding_idx
            ON decision_supersessions (superseding_namespace, superseding_record_key)`,
  },
];

function schemaError(): never {
  throw new DecisionStoreError("schema", "schema");
}

function pragmaNumber(
  database: SqliteDatabase,
  pragma: "application_id" | "user_version",
): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  const value = row?.[pragma];
  if (typeof value !== "number") {
    schemaError();
  }
  return value;
}

function transaction(database: SqliteDatabase, operation: () => void): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    operation();
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The original failure remains authoritative.
    }
    throw error;
  }
}

function initializeSchema(database: SqliteDatabase): void {
  transaction(database, () => {
    database.exec(`
      CREATE TABLE decision_records (
        namespace TEXT COLLATE BINARY NOT NULL,
        record_key TEXT COLLATE BINARY NOT NULL,
        selection TEXT NOT NULL,
        context TEXT NOT NULL,
        PRIMARY KEY (namespace, record_key)
      ) STRICT;

      CREATE TABLE decision_bases (
        decision_namespace TEXT COLLATE BINARY NOT NULL,
        decision_record_key TEXT COLLATE BINARY NOT NULL,
        basis TEXT NOT NULL
      ) STRICT;

      CREATE TABLE decision_supersessions (
        superseded_namespace TEXT COLLATE BINARY NOT NULL,
        superseded_record_key TEXT COLLATE BINARY NOT NULL,
        superseding_namespace TEXT COLLATE BINARY NOT NULL,
        superseding_record_key TEXT COLLATE BINARY NOT NULL,
        UNIQUE (
          superseded_namespace,
          superseded_record_key,
          superseding_namespace,
          superseding_record_key
        )
      ) STRICT;

      ${requiredIndexes.map((index) => `${index.sql};`).join("\n")}

      PRAGMA application_id = ${decisionApplicationId};
      PRAGMA user_version = ${currentDecisionSchemaVersion};
    `);
  });
}

function sameColumns(
  actual: readonly TableInfoRow[],
  expected: readonly TableInfoRow[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function indexList(
  database: SqliteDatabase,
  table: OwnedTable,
): IndexListRow[] {
  return database
    .prepare("SELECT * FROM pragma_index_list(?)")
    .all(table) as IndexListRow[];
}

function indexKeys(database: SqliteDatabase, indexName: string): IndexKey[] {
  const rows = database
    .prepare("SELECT * FROM pragma_index_xinfo(?)")
    .all(indexName) as Array<{
    name: string | null;
    coll: string;
    key: number;
  }>;

  return rows
    .filter((row) => row.key === 1)
    .map((row) => [row.name ?? "", row.coll] as const);
}

function sameKeys(
  actual: readonly IndexKey[],
  expected: readonly IndexKey[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateTableStructure(database: SqliteDatabase): void {
  const tables = database.prepare("PRAGMA table_list").all() as TableListRow[];

  for (const tableName of ownedTables) {
    const table = tables.find(
      (candidate) =>
        candidate.schema === "main" && candidate.name === tableName,
    );
    if (
      table === undefined ||
      table.type !== "table" ||
      table.strict !== 1 ||
      table.wr !== 0
    ) {
      schemaError();
    }

    const columns = database
      .prepare("SELECT * FROM pragma_table_info(?)")
      .all(tableName) as TableInfoRow[];
    if (!sameColumns(columns, expectedColumns[tableName])) {
      schemaError();
    }

    const foreignKeys = database
      .prepare("SELECT * FROM pragma_foreign_key_list(?)")
      .all(tableName);
    if (foreignKeys.length !== 0) {
      schemaError();
    }

    const schemaRow = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .get(tableName);
    if (
      typeof schemaRow?.sql !== "string" ||
      /\bCHECK\s*\(/i.test(schemaRow.sql)
    ) {
      schemaError();
    }
  }

  const triggers = database
    .prepare(
      `SELECT 1 FROM sqlite_schema
       WHERE type = 'trigger' AND tbl_name IN (?, ?, ?)
       LIMIT 1`,
    )
    .get(...ownedTables);
  if (triggers !== undefined) {
    schemaError();
  }
}

function validateUniqueIndexes(database: SqliteDatabase): void {
  const recordUnique = indexList(database, "decision_records").filter(
    (index) => index.unique === 1,
  );
  if (
    recordUnique.length !== 1 ||
    recordUnique[0].origin !== "pk" ||
    recordUnique[0].partial !== 0 ||
    !sameKeys(indexKeys(database, recordUnique[0].name), recordIdentityKeys)
  ) {
    schemaError();
  }

  const basisUnique = indexList(database, "decision_bases").filter(
    (index) => index.unique === 1,
  );
  if (basisUnique.length !== 0) {
    schemaError();
  }

  const supersessionUnique = indexList(
    database,
    "decision_supersessions",
  ).filter((index) => index.unique === 1);
  if (
    supersessionUnique.length !== 1 ||
    supersessionUnique[0].origin !== "u" ||
    supersessionUnique[0].partial !== 0 ||
    !sameKeys(
      indexKeys(database, supersessionUnique[0].name),
      supersessionIdentityKeys,
    )
  ) {
    schemaError();
  }
}

function missingRequiredIndexes(database: SqliteDatabase): RequiredIndex[] {
  return requiredIndexes.filter((required) => {
    const indexes = indexList(database, required.table);
    const matchingIndex = indexes.find(
      (index) =>
        index.unique === 0 &&
        index.partial === 0 &&
        sameKeys(indexKeys(database, index.name), required.keys),
    );
    if (matchingIndex !== undefined) {
      return false;
    }

    if (indexes.some((index) => index.name === required.name)) {
      schemaError();
    }
    return true;
  });
}

function repairIndexes(
  database: SqliteDatabase,
  missing: readonly RequiredIndex[],
): void {
  if (missing.length === 0) {
    return;
  }

  transaction(database, () => {
    for (const index of missing) {
      database.exec(index.sql);
    }
  });
}

function validateAndRepairSchema(database: SqliteDatabase): void {
  validateTableStructure(database);
  validateUniqueIndexes(database);
  const missing = missingRequiredIndexes(database);
  repairIndexes(database, missing);
}

export function openDecisionSchema(database: SqliteDatabase): void {
  const applicationId = pragmaNumber(database, "application_id");
  const userVersion = pragmaNumber(database, "user_version");
  const objectCountRow = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema")
    .get();
  const objectCount = objectCountRow?.count;

  if (typeof objectCount !== "number") {
    schemaError();
  }

  if (applicationId === 0 && userVersion === 0 && objectCount === 0) {
    initializeSchema(database);
    return;
  }

  if (
    applicationId !== decisionApplicationId ||
    userVersion !== currentDecisionSchemaVersion
  ) {
    schemaError();
  }

  validateAndRepairSchema(database);
}
