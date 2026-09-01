import type {
  Acquisition,
  AdmissionAuthorityRef,
  AdmissionBasisRef,
  AdmissionEvent,
  AdmissionRecordReference,
  SourceBinding,
  SourceBindingKey,
  VerifyBindingSemanticResult,
} from "@voltai/source-admission";
import { BindingRepository } from "@voltai/source-admission";
import { BindingCorruptionFailure, BindingStoreFailure } from "./errors.js";
import { initializeBindingStoreSchema } from "./schema.js";
import { DatabaseSync, type SqliteDatabase } from "./sqlite.js";

interface StoredEventRow {
  readonly source_identity: unknown;
  readonly revision_key: unknown;
  readonly blob_algorithm: unknown;
  readonly blob_digest: unknown;
  readonly admission_sequence: unknown;
  readonly event_kind: unknown;
  readonly authority: unknown;
  readonly basis: unknown;
  readonly withdraws_sequence: unknown;
}

interface StoredBindingRow {
  readonly source_identity: unknown;
  readonly revision_key: unknown;
  readonly blob_algorithm: unknown;
  readonly blob_digest: unknown;
}

type SourceBlobHash = SourceBinding["blobHash"];
type SourceRevision = SourceBinding["sourceRevision"];

function nonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BindingCorruptionFailure(`invalid ${field}`);
  }
}

function decodeEvent(row: StoredEventRow): AdmissionEvent {
  nonEmpty(row.source_identity, "source_identity");
  nonEmpty(row.revision_key, "revision_key");
  if (row.blob_algorithm !== "sha-256") {
    throw new BindingCorruptionFailure("invalid blob_algorithm");
  }
  nonEmpty(row.blob_digest, "blob_digest");
  if (!/^[0-9a-f]{64}$/u.test(row.blob_digest)) {
    throw new BindingCorruptionFailure("invalid blob_digest");
  }
  if (
    typeof row.admission_sequence !== "number" ||
    !Number.isSafeInteger(row.admission_sequence) ||
    row.admission_sequence <= 0
  ) {
    throw new BindingCorruptionFailure("invalid admission_sequence");
  }
  nonEmpty(row.authority, "authority");
  nonEmpty(row.basis, "basis");
  if (row.event_kind !== "ADMIT" && row.event_kind !== "WITHDRAW") {
    throw new BindingCorruptionFailure("invalid event_kind");
  }
  if (row.event_kind === "ADMIT" && row.withdraws_sequence !== null) {
    throw new BindingCorruptionFailure("ADMIT cannot target another event");
  }
  if (
    row.event_kind === "WITHDRAW" &&
    (typeof row.withdraws_sequence !== "number" ||
      !Number.isSafeInteger(row.withdraws_sequence) ||
      row.withdraws_sequence <= 0)
  ) {
    throw new BindingCorruptionFailure("WITHDRAW must target one event");
  }
  return Object.freeze({
    sourceIdentity: row.source_identity,
    revisionKey: row.revision_key,
    blobAlgorithm: row.blob_algorithm,
    blobDigest: row.blob_digest,
    admissionSequence: row.admission_sequence,
    eventKind: row.event_kind,
    authority: row.authority,
    basis: row.basis,
    ...(row.event_kind === "WITHDRAW"
      ? { withdrawsSequence: row.withdraws_sequence as number }
      : {}),
  }) as AdmissionEvent;
}

function validateText(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function validateBlobHash(blobHash: SourceBlobHash): void {
  if (typeof blobHash !== "object" || blobHash === null) {
    throw new TypeError("blobHash must be an object");
  }
  if (blobHash.algorithm !== "sha-256") {
    throw new TypeError("blobHash.algorithm must be sha-256");
  }
  if (!/^[0-9a-f]{64}$/u.test(blobHash.digest)) {
    throw new TypeError("blobHash.digest must be lowercase sha-256 hex");
  }
}

function validateSourceRevision(sourceRevision: SourceRevision): void {
  if (typeof sourceRevision !== "object" || sourceRevision === null) {
    throw new TypeError("sourceRevision must be established");
  }
  validateText(sourceRevision.sourceIdentity, "sourceRevision.sourceIdentity");
  validateText(sourceRevision.revisionKey, "sourceRevision.revisionKey");
}

function bindingFromRow(row: StoredBindingRow): SourceBinding {
  nonEmpty(row.source_identity, "source_identity");
  nonEmpty(row.revision_key, "revision_key");
  if (row.blob_algorithm !== "sha-256") {
    throw new BindingCorruptionFailure("invalid blob_algorithm");
  }
  nonEmpty(row.blob_digest, "blob_digest");
  if (!/^[0-9a-f]{64}$/u.test(row.blob_digest)) {
    throw new BindingCorruptionFailure("invalid blob_digest");
  }
  const binding = {
    sourceRevision: {
      sourceIdentity: row.source_identity,
      revisionKey: row.revision_key,
    },
    blobHash: {
      algorithm: row.blob_algorithm,
      digest: row.blob_digest,
    },
  } as SourceBinding;
  return Object.freeze({
    sourceRevision: Object.freeze(binding.sourceRevision),
    blobHash: Object.freeze(binding.blobHash),
  });
}

function validateReference(reference: AdmissionRecordReference): void {
  validateSourceRevision({
    sourceIdentity: reference.sourceIdentity,
    revisionKey: reference.revisionKey,
  });
  validateBlobHash({
    algorithm: reference.blobAlgorithm,
    digest: reference.blobDigest,
  });
  if (
    !Number.isSafeInteger(reference.admissionSequence) ||
    reference.admissionSequence <= 0
  ) {
    throw new TypeError("admissionSequence must be a positive safe integer");
  }
}

export class SqliteBindingRepository extends BindingRepository {
  private readonly database: SqliteDatabase;
  private closed = false;

  constructor(dbPath: string) {
    super();
    validateText(dbPath, "dbPath");
    let database: SqliteDatabase | undefined;
    try {
      database = new DatabaseSync(dbPath);
      initializeBindingStoreSchema(database);
      this.database = database;
    } catch (failure) {
      try {
        database?.close();
      } catch {
        // Keep the opening or schema failure.
      }
      throw failure instanceof BindingStoreFailure
        ? failure
        : new BindingStoreFailure("unavailable", "cannot open binding store", {
            cause: failure,
          });
    }
  }

  admitBinding(
    binding: SourceBinding,
    authority: AdmissionAuthorityRef,
    basis: AdmissionBasisRef,
  ): AdmissionRecordReference {
    const key = this.sourceBindingKey(binding);
    validateText(authority, "authority");
    validateText(basis, "basis");
    return this.inTransaction(() => {
      const events = this.loadEvents(key);
      const withdrawn = new Set(
        events
          .filter((event) => event.eventKind === "WITHDRAW")
          .map((event) => event.withdrawsSequence),
      );
      const replay = events.find(
        (event) =>
          event.eventKind === "ADMIT" &&
          event.authority === authority &&
          event.basis === basis &&
          !withdrawn.has(event.admissionSequence),
      );
      if (replay !== undefined) return this.admissionRecordReference(replay);

      const event = Object.freeze({
        ...key,
        admissionSequence: this.nextSequence(events),
        eventKind: "ADMIT" as const,
        authority,
        basis,
      });
      this.insertEvent(event);
      return this.admissionRecordReference(event);
    });
  }

  withdrawAdmission(
    reference: AdmissionRecordReference,
    authority: AdmissionAuthorityRef,
    basis: AdmissionBasisRef,
  ): AdmissionRecordReference {
    validateReference(reference);
    validateText(authority, "authority");
    validateText(basis, "basis");
    const key: SourceBindingKey = reference;
    return this.inTransaction(() => {
      const events = this.loadEvents(key);
      const target = events.find(
        (event) =>
          event.admissionSequence === reference.admissionSequence &&
          event.eventKind === "ADMIT",
      );
      if (target === undefined) {
        throw new RangeError("withdrawal target is not an admission");
      }
      const previous = events.find(
        (event) =>
          event.eventKind === "WITHDRAW" &&
          event.withdrawsSequence === reference.admissionSequence,
      );
      if (previous !== undefined) {
        if (previous.authority === authority && previous.basis === basis) {
          return this.admissionRecordReference(previous);
        }
        throw new RangeError("admission already withdrawn");
      }
      const event = Object.freeze({
        ...key,
        admissionSequence: this.nextSequence(events),
        eventKind: "WITHDRAW" as const,
        authority,
        basis,
        withdrawsSequence: reference.admissionSequence,
      });
      this.insertEvent(event);
      return this.admissionRecordReference(event);
    });
  }

  verifyBinding(binding: SourceBinding): VerifyBindingSemanticResult {
    const key = this.sourceBindingKey(binding);
    return this.evaluateAdmissionEvents(this.loadEvents(key));
  }

  findBindingsByBlob(blobHash: SourceBlobHash): readonly SourceBinding[] {
    validateBlobHash(blobHash);
    this.assertOpen();
    try {
      return Object.freeze(
        (
          this.database
            .prepare(
              `SELECT DISTINCT source_identity, revision_key,
                               blob_algorithm, blob_digest
                 FROM source_binding_admission_events
                WHERE blob_algorithm = ? AND blob_digest = ?
                ORDER BY source_identity ASC, revision_key ASC`,
            )
            .all(
              blobHash.algorithm,
              blobHash.digest,
            ) as unknown as StoredBindingRow[]
        ).map(bindingFromRow),
      );
    } catch (failure) {
      throw this.readFailure(failure);
    }
  }

  findBindingsByRevision(
    sourceRevision: SourceRevision,
  ): readonly SourceBinding[] {
    validateSourceRevision(sourceRevision);
    this.assertOpen();
    try {
      return Object.freeze(
        (
          this.database
            .prepare(
              `SELECT DISTINCT source_identity, revision_key,
                               blob_algorithm, blob_digest
                 FROM source_binding_admission_events
                WHERE source_identity = ? AND revision_key = ?
                ORDER BY blob_algorithm ASC, blob_digest ASC`,
            )
            .all(
              sourceRevision.sourceIdentity,
              sourceRevision.revisionKey,
            ) as unknown as StoredBindingRow[]
        ).map(bindingFromRow),
      );
    } catch (failure) {
      throw this.readFailure(failure);
    }
  }

  findAcquisitionsByBlob(blobHash: SourceBlobHash): readonly Acquisition[] {
    const bindings = this.findBindingsByBlob(blobHash);
    const acquisitions: Acquisition[] = [];
    for (const binding of bindings) {
      for (const event of this.loadEvents(this.sourceBindingKey(binding))) {
        if (event.eventKind !== "ADMIT") continue;
        acquisitions.push(
          Object.freeze({
            binding,
            authority: event.authority,
            basis: event.basis,
          }),
        );
      }
    }
    return Object.freeze(acquisitions);
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new BindingStoreFailure("unavailable", "binding store is closed");
    }
  }

  private loadEvents(key: SourceBindingKey): readonly AdmissionEvent[] {
    this.assertOpen();
    try {
      const rows = this.database
        .prepare(
          `SELECT source_identity, revision_key, blob_algorithm, blob_digest,
                  admission_sequence, event_kind, authority, basis,
                  withdraws_sequence
             FROM source_binding_admission_events
            WHERE source_identity = ? AND revision_key = ?
              AND blob_algorithm = ? AND blob_digest = ?
            ORDER BY admission_sequence ASC`,
        )
        .all(
          key.sourceIdentity,
          key.revisionKey,
          key.blobAlgorithm,
          key.blobDigest,
        ) as unknown as StoredEventRow[];
      return Object.freeze(rows.map(decodeEvent));
    } catch (failure) {
      throw this.readFailure(failure);
    }
  }

  private readFailure(failure: unknown): BindingStoreFailure {
    return failure instanceof BindingStoreFailure
      ? failure
      : new BindingStoreFailure("unavailable", "cannot read binding store", {
          cause: failure,
        });
  }

  private nextSequence(events: readonly AdmissionEvent[]): number {
    const last = events.at(-1)?.admissionSequence ?? 0;
    if (!Number.isSafeInteger(last + 1)) {
      throw new BindingCorruptionFailure("admission sequence exhausted");
    }
    return last + 1;
  }

  private insertEvent(event: AdmissionEvent): void {
    this.database
      .prepare(
        `INSERT INTO source_binding_admission_events (
           source_identity, revision_key, blob_algorithm, blob_digest,
           admission_sequence, event_kind, authority, basis,
           withdraws_sequence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.sourceIdentity,
        event.revisionKey,
        event.blobAlgorithm,
        event.blobDigest,
        event.admissionSequence,
        event.eventKind,
        event.authority,
        event.basis,
        event.withdrawsSequence ?? null,
      );
  }

  private inTransaction<Result>(run: () => Result): Result {
    this.assertOpen();
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const result = run();
      this.database.exec("COMMIT");
      return result;
    } catch (failure) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The original failure remains authoritative.
      }
      if (
        failure instanceof BindingStoreFailure ||
        failure instanceof TypeError ||
        failure instanceof RangeError
      ) {
        throw failure;
      }
      throw new BindingStoreFailure(
        "transaction",
        "binding store transaction failed",
        { cause: failure },
      );
    }
  }
}
