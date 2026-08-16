import type {
  DecisionBasis,
  DecisionRecord,
  DecisionRecordKeyCodec,
  DecisionSupersession,
  DecisionValueCodec,
  JsonValue,
} from "@voltai/knowledge-core";

import {
  decodeDecisionRecordKey,
  encodeDecisionRecordKey,
  validateAddressCoordinate,
  validateNamespace,
} from "./address.js";
import { DecisionStoreError } from "./errors.js";
import {
  decodeCodecValue,
  decodePhysicalJson,
  encodeCodecValue,
} from "./physicalJson.js";
import { openDecisionSchema } from "./schema.js";
import { DatabaseSync, type SqliteDatabase } from "./sqlite.js";
import type {
  StoredDecisionAddress,
  StoredDecisionRecord,
  StoredDecisionSupersession,
} from "./types.js";

type StoredDecisionRow = {
  namespace?: unknown;
  namespace_bytes?: unknown;
  record_key: unknown;
  record_key_bytes?: unknown;
  selection: unknown;
  context: unknown;
};

type StoredAddressRow = {
  namespace: unknown;
  namespace_bytes: unknown;
  record_key: unknown;
  record_key_bytes: unknown;
};

type StoredBasisRow = {
  basis: unknown;
};

type StoredSupersessionRow = {
  superseded_namespace: unknown;
  superseded_namespace_bytes?: unknown;
  superseded_record_key: unknown;
  superseded_record_key_bytes?: unknown;
  superseding_namespace: unknown;
  superseding_namespace_bytes?: unknown;
  superseding_record_key: unknown;
  superseding_record_key_bytes?: unknown;
};

type StoredAddressQuery = {
  readonly namespace?: string;
  readonly after?: StoredDecisionAddress;
  readonly limit?: number;
};

type StoredDecisionPage = {
  readonly records: readonly StoredDecisionRecord[];
  readonly nextCursor: StoredDecisionAddress | null;
};

type StoredAddressPage = {
  readonly addresses: readonly StoredDecisionAddress[];
  readonly nextCursor: StoredDecisionAddress | null;
};

type StoredSupersessionQuery = {
  readonly superseded?: StoredDecisionAddress;
  readonly superseding?: StoredDecisionAddress;
  readonly after?: StoredDecisionSupersession;
  readonly limit?: number;
};

type StoredSupersessionPage = {
  readonly supersessions: readonly StoredDecisionSupersession[];
  readonly nextCursor: StoredDecisionSupersession | null;
};

type NormalizedAddressQuery = {
  readonly namespace?: string;
  readonly after?: StoredDecisionAddress;
  readonly limit: number;
};

type NormalizedSupersessionQuery = {
  readonly superseded?: StoredDecisionAddress;
  readonly superseding?: StoredDecisionAddress;
  readonly after?: StoredDecisionSupersession;
  readonly limit: number;
};

const defaultPageSize = 100;
const maximumPageSize = 1000;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryObject(query: unknown): Record<string, unknown> {
  if (query === undefined) {
    return {};
  }
  if (!isObjectRecord(query)) {
    throw new DecisionStoreError("query", "query");
  }
  return query;
}

function pageSize(value: unknown): number {
  if (value === undefined) {
    return defaultPageSize;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumPageSize
  ) {
    throw new DecisionStoreError("query", "page-size");
  }
  return value;
}

function storedAddress(
  value: unknown,
  containerField: "query" | "cursor",
  namespaceField: "namespace" | "superseded-address" | "superseding-address",
  recordKeyField: "record-key" | "superseded-address" | "superseding-address",
): StoredDecisionAddress {
  if (!isObjectRecord(value)) {
    throw new DecisionStoreError("query", containerField);
  }
  return {
    namespace: validateAddressCoordinate(value.namespace, namespaceField),
    recordKey: validateAddressCoordinate(value.recordKey, recordKeyField),
  };
}

function decisionAddress(value: unknown): StoredDecisionAddress {
  return storedAddress(value, "query", "namespace", "record-key");
}

function cursorAddress(value: unknown): StoredDecisionAddress {
  return storedAddress(value, "cursor", "namespace", "record-key");
}

function filteredEndpoint(
  value: unknown,
  field: "superseded-address" | "superseding-address",
): StoredDecisionAddress {
  return storedAddress(value, "query", field, field);
}

function supersessionCursor(value: unknown): StoredDecisionSupersession {
  if (!isObjectRecord(value)) {
    throw new DecisionStoreError("query", "cursor");
  }
  return {
    supersededNamespace: validateAddressCoordinate(
      value.supersededNamespace,
      "superseded-address",
    ),
    supersededRecordKey: validateAddressCoordinate(
      value.supersededRecordKey,
      "superseded-address",
    ),
    supersedingNamespace: validateAddressCoordinate(
      value.supersedingNamespace,
      "superseding-address",
    ),
    supersedingRecordKey: validateAddressCoordinate(
      value.supersedingRecordKey,
      "superseding-address",
    ),
  };
}

function normalizeAddressQuery(query: unknown): NormalizedAddressQuery {
  const value = queryObject(query);
  const limit = pageSize(value.limit);
  const namespace =
    value.namespace === undefined
      ? undefined
      : validateNamespace(value.namespace);
  const after =
    value.after === undefined ? undefined : cursorAddress(value.after);

  if (
    namespace !== undefined &&
    after !== undefined &&
    after.namespace !== namespace
  ) {
    throw new DecisionStoreError("query", "cursor");
  }
  return { namespace, after, limit };
}

function sameEndpoint(
  edgeNamespace: string,
  edgeRecordKey: string,
  address: StoredDecisionAddress,
): boolean {
  return (
    edgeNamespace === address.namespace && edgeRecordKey === address.recordKey
  );
}

function normalizeSupersessionQuery(
  query: unknown,
): NormalizedSupersessionQuery {
  const value = queryObject(query);
  const limit = pageSize(value.limit);
  const superseded =
    value.superseded === undefined
      ? undefined
      : filteredEndpoint(value.superseded, "superseded-address");
  const superseding =
    value.superseding === undefined
      ? undefined
      : filteredEndpoint(value.superseding, "superseding-address");
  const after =
    value.after === undefined ? undefined : supersessionCursor(value.after);

  if (
    after !== undefined &&
    ((superseded !== undefined &&
      !sameEndpoint(
        after.supersededNamespace,
        after.supersededRecordKey,
        superseded,
      )) ||
      (superseding !== undefined &&
        !sameEndpoint(
          after.supersedingNamespace,
          after.supersedingRecordKey,
          superseding,
        )))
  ) {
    throw new DecisionStoreError("query", "cursor");
  }
  return { superseded, superseding, after, limit };
}

function decodeStoredAddress(row: StoredAddressRow): StoredDecisionAddress {
  return {
    namespace: decodeStoredCoordinate(
      row.namespace,
      row.namespace_bytes,
      "namespace",
    ),
    recordKey: decodeStoredCoordinate(
      row.record_key,
      row.record_key_bytes,
      "record-key",
    ),
  };
}

function decodeStoredCoordinate(
  value: unknown,
  bytes: unknown,
  field:
    "namespace" | "record-key" | "superseded-address" | "superseding-address",
): string {
  const coordinate = validateAddressCoordinate(value, field);
  if (!(bytes instanceof Uint8Array)) {
    throw new DecisionStoreError("address", field);
  }

  const encoded = new TextEncoder().encode(coordinate);
  if (
    encoded.length !== bytes.length ||
    encoded.some((byte, index) => byte !== bytes[index])
  ) {
    throw new DecisionStoreError("address", field);
  }
  return coordinate;
}

function decodeStoredRecord(row: StoredDecisionRow): StoredDecisionRecord {
  return {
    address: decodeStoredAddress({
      namespace: row.namespace,
      namespace_bytes: row.namespace_bytes,
      record_key: row.record_key,
      record_key_bytes: row.record_key_bytes,
    }),
    selection: decodePhysicalJson(row.selection, "selection"),
    context: decodePhysicalJson(row.context, "context"),
  };
}

function decodeStoredSupersession(
  row: StoredSupersessionRow,
): StoredDecisionSupersession {
  return {
    supersededNamespace: decodeStoredCoordinate(
      row.superseded_namespace,
      row.superseded_namespace_bytes,
      "superseded-address",
    ),
    supersededRecordKey: decodeStoredCoordinate(
      row.superseded_record_key,
      row.superseded_record_key_bytes,
      "superseded-address",
    ),
    supersedingNamespace: decodeStoredCoordinate(
      row.superseding_namespace,
      row.superseding_namespace_bytes,
      "superseding-address",
    ),
    supersedingRecordKey: decodeStoredCoordinate(
      row.superseding_record_key,
      row.superseding_record_key_bytes,
      "superseding-address",
    ),
  };
}

function normalizeStorageFailure(error: unknown): never {
  if (error instanceof DecisionStoreError) {
    throw error;
  }
  throw new DecisionStoreError("storage", "database");
}

export class SqliteDecisionStore {
  private readonly database: SqliteDatabase;
  private closed = false;

  constructor(dbPath: string) {
    let database: SqliteDatabase;

    try {
      database = new DatabaseSync(dbPath);
    } catch {
      throw new DecisionStoreError("storage", "database");
    }

    try {
      openDecisionSchema(database);
    } catch (error) {
      try {
        database.close();
      } catch {
        // Constructor failure must not expose a second raw close error.
      }
      normalizeStorageFailure(error);
    }

    this.database = database;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DecisionStoreError("closed");
    }
  }

  private storageOperation<TResult>(operation: () => TResult): TResult {
    try {
      return operation();
    } catch (error) {
      normalizeStorageFailure(error);
    }
  }

  private immediateTransaction<TResult>(operation: () => TResult): TResult {
    return this.storageOperation(() => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          throw new DecisionStoreError("storage", "database");
        }
        throw error;
      }
    });
  }

  insertDecision<
    TDecisionRecordId extends NonNullable<unknown>,
    TSelection,
    TContext,
  >(
    namespace: string,
    record: DecisionRecord<TDecisionRecordId, TSelection, TContext>,
    keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>,
    selectionCodec: DecisionValueCodec<TSelection>,
    contextCodec: DecisionValueCodec<TContext>,
  ): void {
    this.assertOpen();
    const storedNamespace = validateNamespace(namespace);
    const recordKey = encodeDecisionRecordKey(record.id, keyCodec);
    const selection = encodeCodecValue(
      record.decision.selection,
      selectionCodec,
      "selection",
    );
    const context = encodeCodecValue(
      record.decision.context,
      contextCodec,
      "context",
    );

    this.immediateTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO decision_records (namespace, record_key, selection, context)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(namespace, record_key) DO NOTHING`,
        )
        .run(storedNamespace, recordKey, selection, context);

      const row = this.database
        .prepare(
          `SELECT selection, context
           FROM decision_records
           WHERE namespace = ? AND record_key = ?`,
        )
        .get(storedNamespace, recordKey);

      if (row?.selection !== selection || row.context !== context) {
        throw new DecisionStoreError("identity-conflict");
      }
    });
  }

  readDecision<
    TDecisionRecordId extends NonNullable<unknown>,
    TSelection,
    TContext,
  >(
    namespace: string,
    id: TDecisionRecordId,
    keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>,
    selectionCodec: DecisionValueCodec<TSelection>,
    contextCodec: DecisionValueCodec<TContext>,
  ): DecisionRecord<TDecisionRecordId, TSelection, TContext> | null {
    this.assertOpen();
    const storedNamespace = validateNamespace(namespace);
    const lookupKey = encodeDecisionRecordKey(id, keyCodec);
    const row = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT record_key, selection, context
           FROM decision_records
           WHERE namespace = ? AND record_key = ?`,
        )
        .get(storedNamespace, lookupKey),
    ) as StoredDecisionRow | undefined;

    if (row === undefined) {
      return null;
    }

    const selectionValue = decodePhysicalJson(row.selection, "selection");
    const contextValue = decodePhysicalJson(row.context, "context");
    const storedKey = validateAddressCoordinate(row.record_key, "record-key");
    const decodedId = decodeDecisionRecordKey(storedKey, keyCodec);

    return {
      id: decodedId,
      decision: {
        selection: decodeCodecValue(
          selectionValue,
          selectionCodec,
          "selection",
        ),
        context: decodeCodecValue(contextValue, contextCodec, "context"),
      },
    };
  }

  listStoredDecisions(query?: StoredAddressQuery): StoredDecisionPage {
    this.assertOpen();
    const normalized = normalizeAddressQuery(query);
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (normalized.namespace !== undefined) {
      clauses.push("namespace COLLATE BINARY = ?");
      parameters.push(normalized.namespace);
    }
    if (normalized.after !== undefined) {
      clauses.push(
        "(namespace COLLATE BINARY, record_key COLLATE BINARY) > (?, ?)",
      );
      parameters.push(normalized.after.namespace, normalized.after.recordKey);
    }

    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    parameters.push(normalized.limit + 1);
    const rows = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT
             namespace,
             CAST(namespace AS BLOB) AS namespace_bytes,
             record_key,
             CAST(record_key AS BLOB) AS record_key_bytes,
             selection,
             context
           FROM decision_records
           ${where}
           ORDER BY namespace COLLATE BINARY, record_key COLLATE BINARY
           LIMIT ?`,
        )
        .all(...parameters),
    ) as StoredDecisionRow[];

    const hasMore = rows.length > normalized.limit;
    const records = rows
      .slice(0, normalized.limit)
      .map((row) => decodeStoredRecord(row));
    return {
      records,
      nextCursor:
        hasMore && records.length > 0
          ? records[records.length - 1].address
          : null,
    };
  }

  readStoredDecision(
    address: StoredDecisionAddress,
  ): StoredDecisionRecord | null {
    this.assertOpen();
    const stored = decisionAddress(address);
    const row = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT
             namespace,
             CAST(namespace AS BLOB) AS namespace_bytes,
             record_key,
             CAST(record_key AS BLOB) AS record_key_bytes,
             selection,
             context
           FROM decision_records
           WHERE namespace COLLATE BINARY = ?
             AND record_key COLLATE BINARY = ?`,
        )
        .get(stored.namespace, stored.recordKey),
    ) as StoredDecisionRow | undefined;

    return row === undefined ? null : decodeStoredRecord(row);
  }

  insertDecisionBasis<
    TDecisionRecordId extends NonNullable<unknown>,
    TBasis extends NonNullable<unknown>,
  >(
    namespace: string,
    relation: DecisionBasis<TDecisionRecordId, TBasis>,
    keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>,
    basisCodec: DecisionValueCodec<TBasis>,
  ): void {
    this.assertOpen();
    const storedNamespace = validateNamespace(namespace);
    const recordKey = encodeDecisionRecordKey(
      relation.decisionRecordId,
      keyCodec,
    );
    const basis = encodeCodecValue(relation.basis, basisCodec, "basis");

    this.storageOperation(() => {
      this.database
        .prepare(
          `INSERT INTO decision_bases (decision_namespace, decision_record_key, basis)
           VALUES (?, ?, ?)`,
        )
        .run(storedNamespace, recordKey, basis);
    });
  }

  readDecisionBases<TDecisionRecordId extends NonNullable<unknown>>(
    namespace: string,
    id: TDecisionRecordId,
    keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>,
  ): JsonValue[] {
    this.assertOpen();
    const storedNamespace = validateNamespace(namespace);
    const recordKey = encodeDecisionRecordKey(id, keyCodec);
    const rows = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT basis
           FROM decision_bases
           WHERE decision_namespace = ? AND decision_record_key = ?
           ORDER BY rowid`,
        )
        .all(storedNamespace, recordKey),
    ) as StoredBasisRow[];

    return rows.map((row) => decodePhysicalJson(row.basis, "basis"));
  }

  listStoredBasisAddresses(query?: StoredAddressQuery): StoredAddressPage {
    this.assertOpen();
    const normalized = normalizeAddressQuery(query);
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (normalized.namespace !== undefined) {
      clauses.push("decision_namespace COLLATE BINARY = ?");
      parameters.push(normalized.namespace);
    }
    if (normalized.after !== undefined) {
      clauses.push(
        `(decision_namespace COLLATE BINARY,
          decision_record_key COLLATE BINARY) > (?, ?)`,
      );
      parameters.push(normalized.after.namespace, normalized.after.recordKey);
    }

    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    parameters.push(normalized.limit + 1);
    const rows = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT DISTINCT
             decision_namespace AS namespace,
             CAST(decision_namespace AS BLOB) AS namespace_bytes,
             decision_record_key AS record_key,
             CAST(decision_record_key AS BLOB) AS record_key_bytes
           FROM decision_bases
           ${where}
           ORDER BY
             decision_namespace COLLATE BINARY,
             decision_record_key COLLATE BINARY
           LIMIT ?`,
        )
        .all(...parameters),
    ) as StoredAddressRow[];

    const hasMore = rows.length > normalized.limit;
    const addresses = rows
      .slice(0, normalized.limit)
      .map((row) => decodeStoredAddress(row));
    return {
      addresses,
      nextCursor:
        hasMore && addresses.length > 0
          ? addresses[addresses.length - 1]
          : null,
    };
  }

  insertDecisionSupersession<
    TSupersededId extends NonNullable<unknown>,
    TSupersedingId extends NonNullable<unknown>,
  >(
    supersededNamespace: string,
    supersedingNamespace: string,
    relation: DecisionSupersession<TSupersededId, TSupersedingId>,
    supersededKeyCodec: DecisionRecordKeyCodec<TSupersededId>,
    supersedingKeyCodec: DecisionRecordKeyCodec<TSupersedingId>,
  ): void {
    this.assertOpen();
    const storedSupersededNamespace = validateNamespace(supersededNamespace);
    const storedSupersedingNamespace = validateNamespace(supersedingNamespace);
    const supersededRecordKey = encodeDecisionRecordKey(
      relation.supersededDecisionRecordId,
      supersededKeyCodec,
      "superseded-address",
    );
    const supersedingRecordKey = encodeDecisionRecordKey(
      relation.supersedingDecisionRecordId,
      supersedingKeyCodec,
      "superseding-address",
    );

    if (
      storedSupersededNamespace === storedSupersedingNamespace &&
      supersededRecordKey === supersedingRecordKey
    ) {
      throw new DecisionStoreError("self-supersession");
    }

    this.storageOperation(() => {
      this.database
        .prepare(
          `INSERT INTO decision_supersessions (
             superseded_namespace,
             superseded_record_key,
             superseding_namespace,
             superseding_record_key
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT (
             superseded_namespace,
             superseded_record_key,
             superseding_namespace,
             superseding_record_key
           ) DO NOTHING`,
        )
        .run(
          storedSupersededNamespace,
          supersededRecordKey,
          storedSupersedingNamespace,
          supersedingRecordKey,
        );
    });
  }

  readDecisionSupersessions<TDecisionRecordId extends NonNullable<unknown>>(
    namespace: string,
    id: TDecisionRecordId,
    keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>,
  ): StoredDecisionSupersession[] {
    this.assertOpen();
    const storedNamespace = validateNamespace(namespace);
    const recordKey = encodeDecisionRecordKey(id, keyCodec);
    const rows = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT
             superseded_namespace,
             superseded_record_key,
             superseding_namespace,
             superseding_record_key
           FROM decision_supersessions
           WHERE (superseded_namespace = ? AND superseded_record_key = ?)
              OR (superseding_namespace = ? AND superseding_record_key = ?)
           ORDER BY rowid`,
        )
        .all(storedNamespace, recordKey, storedNamespace, recordKey),
    ) as StoredSupersessionRow[];

    return rows.map((row) => ({
      supersededNamespace: validateAddressCoordinate(
        row.superseded_namespace,
        "superseded-address",
      ),
      supersededRecordKey: validateAddressCoordinate(
        row.superseded_record_key,
        "superseded-address",
      ),
      supersedingNamespace: validateAddressCoordinate(
        row.superseding_namespace,
        "superseding-address",
      ),
      supersedingRecordKey: validateAddressCoordinate(
        row.superseding_record_key,
        "superseding-address",
      ),
    }));
  }

  listStoredSupersessions(
    query?: StoredSupersessionQuery,
  ): StoredSupersessionPage {
    this.assertOpen();
    const normalized = normalizeSupersessionQuery(query);
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (normalized.superseded !== undefined) {
      clauses.push(
        `superseded_namespace COLLATE BINARY = ?
         AND superseded_record_key COLLATE BINARY = ?`,
      );
      parameters.push(
        normalized.superseded.namespace,
        normalized.superseded.recordKey,
      );
    }
    if (normalized.superseding !== undefined) {
      clauses.push(
        `superseding_namespace COLLATE BINARY = ?
         AND superseding_record_key COLLATE BINARY = ?`,
      );
      parameters.push(
        normalized.superseding.namespace,
        normalized.superseding.recordKey,
      );
    }
    if (normalized.after !== undefined) {
      clauses.push(
        `(superseded_namespace COLLATE BINARY,
          superseded_record_key COLLATE BINARY,
          superseding_namespace COLLATE BINARY,
          superseding_record_key COLLATE BINARY) > (?, ?, ?, ?)`,
      );
      parameters.push(
        normalized.after.supersededNamespace,
        normalized.after.supersededRecordKey,
        normalized.after.supersedingNamespace,
        normalized.after.supersedingRecordKey,
      );
    }

    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    parameters.push(normalized.limit + 1);
    const rows = this.storageOperation(() =>
      this.database
        .prepare(
          `SELECT
             superseded_namespace,
             CAST(superseded_namespace AS BLOB) AS superseded_namespace_bytes,
             superseded_record_key,
             CAST(superseded_record_key AS BLOB) AS superseded_record_key_bytes,
             superseding_namespace,
             CAST(superseding_namespace AS BLOB) AS superseding_namespace_bytes,
             superseding_record_key,
             CAST(superseding_record_key AS BLOB) AS superseding_record_key_bytes
           FROM decision_supersessions
           ${where}
           ORDER BY
             superseded_namespace COLLATE BINARY,
             superseded_record_key COLLATE BINARY,
             superseding_namespace COLLATE BINARY,
             superseding_record_key COLLATE BINARY
           LIMIT ?`,
        )
        .all(...parameters),
    ) as StoredSupersessionRow[];

    const hasMore = rows.length > normalized.limit;
    const supersessions = rows
      .slice(0, normalized.limit)
      .map((row) => decodeStoredSupersession(row));
    return {
      supersessions,
      nextCursor:
        hasMore && supersessions.length > 0
          ? supersessions[supersessions.length - 1]
          : null,
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.storageOperation(() => this.database.close());
  }
}
