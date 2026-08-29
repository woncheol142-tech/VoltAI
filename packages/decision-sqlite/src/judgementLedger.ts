import { JudgementLedgerError } from "./judgementLedgerError.js";
import { openJudgementLedgerSchema } from "./judgementLedgerSchema.js";
import type {
  ImmutableJudgementRecord,
  JudgementAddress,
  JudgementLedger,
  JudgementReplayResult,
  JudgementSupersession,
  ReplayApplicabilityKey,
} from "./judgementLedgerTypes.js";
import { DatabaseSync, type SqliteDatabase } from "./sqlite.js";

export type {
  ImmutableJudgementRecord,
  JudgementAddress,
  JudgementLedger,
  JudgementRecordId,
  JudgementReplayResult,
  JudgementSupersession,
  ReplayApplicabilityKey,
} from "./judgementLedgerTypes.js";

export type JudgementLedgerFailurePoint =
  | "RECORD_WRITE"
  | "EDGE_WRITE"
  | "AFTER_RECORD_COMPONENT"
  | "AFTER_EDGE_COMPONENT"
  | "READ";

type StoredRecordRow = {
  namespace: unknown;
  record_key: unknown;
  record_id: unknown;
  applicability_key: unknown;
  record_json: unknown;
};

type StoredEdgeRow = {
  superseded_namespace: unknown;
  superseded_record_key: unknown;
  superseding_namespace: unknown;
  superseding_record_key: unknown;
  superseded_applicability: unknown;
  superseding_applicability: unknown;
};

function lifecycleError(): never {
  throw new JudgementLedgerError("lifecycle");
}

function coordinate(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new JudgementLedgerError("address");
  }
  return value;
}

function recordJson(record: ImmutableJudgementRecord): string {
  try {
    const text = JSON.stringify(record);
    if (typeof text !== "string" || JSON.stringify(JSON.parse(text)) !== text) {
      throw new Error("record is not stable JSON");
    }
    return text;
  } catch {
    throw new JudgementLedgerError("invalid-record");
  }
}

function addressKey(address: JudgementAddress): string {
  return `${address.namespace}\0${address.recordKey}`;
}

function decodeRecord<TRecord extends ImmutableJudgementRecord>(
  row: StoredRecordRow,
): TRecord {
  try {
    if (
      typeof row.record_json !== "string" ||
      typeof row.namespace !== "string" ||
      typeof row.record_key !== "string" ||
      typeof row.record_id !== "string" ||
      typeof row.applicability_key !== "string"
    ) {
      lifecycleError();
    }

    const parsed = JSON.parse(row.record_json) as TRecord;
    if (
      parsed.recordId !== row.record_id ||
      parsed.address.namespace !== row.namespace ||
      parsed.address.recordKey !== row.record_key ||
      parsed.applicabilityKey !== row.applicability_key
    ) {
      lifecycleError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof JudgementLedgerError) {
      throw error;
    }
    lifecycleError();
  }
}

class FailurePointOperationError {
  readonly cause: unknown;

  constructor(cause: unknown) {
    this.cause = cause;
  }
}

export class SqliteJudgementLedger<
  TRecord extends ImmutableJudgementRecord = ImmutableJudgementRecord,
> implements JudgementLedger<TRecord> {
  private readonly database: SqliteDatabase;
  private unusable = false;

  constructor(dbPath: string) {
    try {
      this.database = new DatabaseSync(dbPath);
      openJudgementLedgerSchema(this.database);
    } catch (error) {
      if (error instanceof JudgementLedgerError) {
        throw error;
      }
      throw new JudgementLedgerError("storage");
    }
  }

  protected reachedFailurePoint(point: JudgementLedgerFailurePoint): void {
    void point;
  }

  private assertUsable(): void {
    if (this.unusable) {
      throw new JudgementLedgerError("unusable");
    }
  }

  private runFailurePoint(point: JudgementLedgerFailurePoint): void {
    try {
      this.reachedFailurePoint(point);
    } catch (error) {
      throw new FailurePointOperationError(error);
    }
  }

  private storageOperation<TResult>(operation: () => TResult): TResult {
    try {
      return operation();
    } catch (error) {
      if (error instanceof FailurePointOperationError) {
        throw error.cause;
      }
      if (error instanceof JudgementLedgerError) {
        throw error;
      }
      throw new JudgementLedgerError("storage");
    }
  }

  private normalizedPrimaryFailure(error: unknown): unknown {
    if (error instanceof FailurePointOperationError) {
      return error.cause;
    }
    if (error instanceof JudgementLedgerError) {
      return error;
    }
    return new JudgementLedgerError("storage");
  }

  private transactionIsActive(): boolean | undefined {
    try {
      return this.database.isTransaction;
    } catch {
      return undefined;
    }
  }

  private failStopAfterRollbackFailure(primaryFailure: unknown): never {
    this.unusable = true;
    throw new JudgementLedgerError("transaction-recovery", {
      cause: this.normalizedPrimaryFailure(primaryFailure),
    });
  }

  private rollbackAfterFailure(primaryFailure: unknown): never {
    try {
      this.database.exec("ROLLBACK");
    } catch {
      const stateAfterFailure = this.transactionIsActive();
      if (stateAfterFailure === false) {
        throw primaryFailure;
      }
      if (stateAfterFailure === undefined) {
        this.failStopAfterRollbackFailure(primaryFailure);
      }

      try {
        this.database.exec("ROLLBACK TRANSACTION");
      } catch {
        if (this.transactionIsActive() !== false) {
          this.failStopAfterRollbackFailure(primaryFailure);
        }
      }
    }

    if (this.transactionIsActive() !== false) {
      this.failStopAfterRollbackFailure(primaryFailure);
    }
    throw primaryFailure;
  }

  private immediateTransaction<TResult>(operation: () => TResult): TResult {
    this.assertUsable();
    return this.storageOperation(() => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.rollbackAfterFailure(error);
      }
    });
  }

  private readTransaction<TResult>(operation: () => TResult): TResult {
    this.assertUsable();
    return this.storageOperation(() => {
      this.database.exec("BEGIN");
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.rollbackAfterFailure(error);
      }
    });
  }

  private validateRecord(record: TRecord): string {
    const recordId = coordinate(record.recordId);
    const namespace = coordinate(record.address.namespace);
    const recordKey = coordinate(record.address.recordKey);
    coordinate(record.applicabilityKey);

    if (recordKey !== recordId || namespace.length === 0) {
      throw new JudgementLedgerError("invalid-record");
    }
    return recordJson(record);
  }

  private insertRecord(record: TRecord, encoded: string): void {
    this.database
      .prepare(
        `INSERT INTO judgement_records (
           namespace,
           record_key,
           record_id,
           applicability_key,
           record_json
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, record_key) DO NOTHING`,
      )
      .run(
        record.address.namespace,
        record.address.recordKey,
        record.recordId,
        record.applicabilityKey,
        encoded,
      );

    const stored = this.database
      .prepare(
        `SELECT record_id, applicability_key, record_json
         FROM judgement_records
         WHERE namespace = ? AND record_key = ?`,
      )
      .get(record.address.namespace, record.address.recordKey);

    if (
      stored?.record_id !== record.recordId ||
      stored.applicability_key !== record.applicabilityKey ||
      stored.record_json !== encoded
    ) {
      throw new JudgementLedgerError("identity-conflict");
    }
  }

  persistRecord(record: TRecord): void {
    this.assertUsable();
    const encoded = this.validateRecord(record);
    this.immediateTransaction(() => this.insertRecord(record, encoded));
  }

  private applicabilityFor(address: JudgementAddress): string {
    const row = this.database
      .prepare(
        `SELECT applicability_key
         FROM judgement_records
         WHERE namespace = ? AND record_key = ?`,
      )
      .get(coordinate(address.namespace), coordinate(address.recordKey));

    if (typeof row?.applicability_key !== "string") {
      lifecycleError();
    }
    return row.applicability_key;
  }

  private insertSupersession(relation: JudgementSupersession): void {
    const supersededApplicability = this.applicabilityFor(relation.superseded);
    const supersedingApplicability = this.applicabilityFor(
      relation.superseding,
    );

    if (
      supersededApplicability !== supersedingApplicability ||
      addressKey(relation.superseded) === addressKey(relation.superseding)
    ) {
      lifecycleError();
    }

    this.database
      .prepare(
        `INSERT INTO judgement_supersessions (
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
        relation.superseded.namespace,
        relation.superseded.recordKey,
        relation.superseding.namespace,
        relation.superseding.recordKey,
      );
  }

  protected persistSupersession(relation: JudgementSupersession): void {
    this.immediateTransaction(() => this.insertSupersession(relation));
  }

  persistSupersedingJudgement(input: {
    readonly record: TRecord;
    readonly supersedes: JudgementAddress;
  }): void {
    this.assertUsable();
    const encoded = this.validateRecord(input.record);
    const relation: JudgementSupersession = {
      superseded: input.supersedes,
      superseding: input.record.address,
    };

    this.immediateTransaction(() => {
      this.runFailurePoint("RECORD_WRITE");
      this.insertRecord(input.record, encoded);
      this.runFailurePoint("AFTER_RECORD_COMPONENT");
      this.runFailurePoint("EDGE_WRITE");
      this.insertSupersession(relation);
      this.runFailurePoint("AFTER_EDGE_COMPONENT");
    });
  }

  private loadRecords(applicabilityKey: ReplayApplicabilityKey): TRecord[] {
    const rows = this.database
      .prepare(
        `SELECT namespace, record_key, record_id, applicability_key, record_json
         FROM judgement_records
         WHERE applicability_key = ? COLLATE BINARY
         ORDER BY namespace COLLATE BINARY, record_key COLLATE BINARY`,
      )
      .all(coordinate(applicabilityKey)) as StoredRecordRow[];

    return rows.map((row) => decodeRecord<TRecord>(row));
  }

  recordsFor(applicabilityKey: ReplayApplicabilityKey): readonly TRecord[] {
    this.assertUsable();
    return this.storageOperation(() => this.loadRecords(applicabilityKey));
  }

  private loadSupersessions(
    applicabilityKey: ReplayApplicabilityKey,
  ): JudgementSupersession[] {
    const rows = this.database
      .prepare(
        `SELECT
           edge.superseded_namespace,
           edge.superseded_record_key,
           edge.superseding_namespace,
           edge.superseding_record_key,
           superseded.applicability_key AS superseded_applicability,
           superseding.applicability_key AS superseding_applicability
         FROM judgement_supersessions AS edge
         LEFT JOIN judgement_records AS superseded
           ON superseded.namespace = edge.superseded_namespace
          AND superseded.record_key = edge.superseded_record_key
         LEFT JOIN judgement_records AS superseding
           ON superseding.namespace = edge.superseding_namespace
          AND superseding.record_key = edge.superseding_record_key
         WHERE superseded.applicability_key = ? COLLATE BINARY
            OR superseding.applicability_key = ? COLLATE BINARY
         ORDER BY
           edge.superseded_namespace COLLATE BINARY,
           edge.superseded_record_key COLLATE BINARY,
           edge.superseding_namespace COLLATE BINARY,
           edge.superseding_record_key COLLATE BINARY`,
      )
      .all(applicabilityKey, applicabilityKey) as StoredEdgeRow[];

    return rows.map((row) => {
      if (
        row.superseded_applicability !== applicabilityKey ||
        row.superseding_applicability !== applicabilityKey
      ) {
        lifecycleError();
      }
      return {
        superseded: {
          namespace: coordinate(row.superseded_namespace),
          recordKey: coordinate(row.superseded_record_key),
        },
        superseding: {
          namespace: coordinate(row.superseding_namespace),
          recordKey: coordinate(row.superseding_record_key),
        },
      };
    });
  }

  supersessionsFor(
    applicabilityKey: ReplayApplicabilityKey,
  ): readonly JudgementSupersession[] {
    this.assertUsable();
    return this.storageOperation(() =>
      this.loadSupersessions(
        coordinate(applicabilityKey) as ReplayApplicabilityKey,
      ),
    );
  }

  private hasCycle(
    records: readonly TRecord[],
    edges: readonly JudgementSupersession[],
  ): boolean {
    const adjacency = new Map<string, string[]>();
    for (const record of records) {
      adjacency.set(addressKey(record.address), []);
    }
    for (const edge of edges) {
      const from = addressKey(edge.superseded);
      const to = addressKey(edge.superseding);
      const targets = adjacency.get(from);
      if (targets === undefined || !adjacency.has(to)) {
        lifecycleError();
      }
      targets.push(to);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string): boolean => {
      if (visiting.has(node)) {
        return true;
      }
      if (visited.has(node)) {
        return false;
      }
      visiting.add(node);
      for (const target of adjacency.get(node) ?? []) {
        if (visit(target)) {
          return true;
        }
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    };

    return [...adjacency.keys()].some((node) => visit(node));
  }

  replay(
    applicabilityKey: ReplayApplicabilityKey,
  ): JudgementReplayResult<TRecord> {
    this.assertUsable();
    try {
      this.runFailurePoint("READ");
      return this.readTransaction(() => {
        const records = this.loadRecords(applicabilityKey);
        const edges = this.loadSupersessions(applicabilityKey);

        if (this.hasCycle(records, edges)) {
          return { kind: "LIFECYCLE_CORRUPT" };
        }

        const superseded = new Set(
          edges.map((edge) => addressKey(edge.superseded)),
        );
        const active = records.filter(
          (record) => !superseded.has(addressKey(record.address)),
        );

        if (active.length === 0) {
          return { kind: "NO_ACTIVE_JUDGEMENT" };
        }
        if (active.length === 1) {
          return { kind: "SINGLE_ACTIVE_JUDGEMENT", record: active[0] };
        }
        return { kind: "CONFLICTING_ACTIVE_JUDGEMENTS", records: active };
      });
    } catch (error) {
      if (
        error instanceof JudgementLedgerError &&
        error.category === "lifecycle"
      ) {
        return { kind: "LIFECYCLE_CORRUPT" };
      }
      return { kind: "PERSISTENCE_UNAVAILABLE" };
    }
  }
}
