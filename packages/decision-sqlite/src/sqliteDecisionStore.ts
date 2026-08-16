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
import type { StoredDecisionSupersession } from "./types.js";

type StoredDecisionRow = {
  record_key: unknown;
  selection: unknown;
  context: unknown;
};

type StoredBasisRow = {
  basis: unknown;
};

type StoredSupersessionRow = {
  superseded_namespace: unknown;
  superseded_record_key: unknown;
  superseding_namespace: unknown;
  superseding_record_key: unknown;
};

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

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.storageOperation(() => this.database.close());
  }
}
