import { createRequire } from "node:module";

import type {
  KecVerifiedExecutionCoordinates,
  KecVerifiedExecutionReceipt,
} from "../types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type ReceiptDatabase = InstanceType<typeof DatabaseSync>;

const lowerHexSha256 = /^[0-9a-f]{64}$/u;
const receiptStoreApplicationId = 0x564b5231;
const receiptStoreSchemaVersion = 1;

export class ReceiptStoreFailure extends Error {
  readonly category: "unavailable" | "schema" | "corrupt" | "transaction";

  constructor(
    category: ReceiptStoreFailure["category"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReceiptStoreFailure";
    this.category = category;
  }
}

export class ReceiptCollisionFailure extends Error {
  constructor() {
    super("verified execution receipt collision");
    this.name = "ReceiptCollisionFailure";
  }
}

function values(
  value: KecVerifiedExecutionCoordinates,
): readonly [string, string, string, string, string, string] {
  return [
    value.sourceIdentity,
    value.revisionKey,
    value.blobAlgorithm,
    value.blobDigest,
    value.extractionContract,
    value.locatorSpace,
  ];
}

function validateReceipt(receipt: KecVerifiedExecutionReceipt): void {
  for (const [field, value] of Object.entries({
    sourceIdentity: receipt.sourceIdentity,
    revisionKey: receipt.revisionKey,
    blobDigest: receipt.blobDigest,
    extractionContract: receipt.extractionContract,
    locatorSpace: receipt.locatorSpace,
  })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  if (
    receipt.blobAlgorithm !== "sha-256" ||
    !lowerHexSha256.test(receipt.blobDigest) ||
    !Number.isSafeInteger(receipt.admissionSequence) ||
    receipt.admissionSequence <= 0 ||
    receipt.commitmentAlgorithm !== "sha-256" ||
    receipt.commitmentCodec !== "kec:verified-extraction-result:v1" ||
    !lowerHexSha256.test(receipt.commitmentDigest)
  ) {
    throw new TypeError("invalid verified execution receipt");
  }
}

function pragmaNumber(
  database: ReceiptDatabase,
  pragma: "application_id" | "user_version",
): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as
    Record<string, unknown> | undefined;
  const value = row?.[pragma];
  if (typeof value !== "number") {
    throw new ReceiptStoreFailure("schema", `invalid ${pragma}`);
  }
  return value;
}

function receiptTableExists(database: ReceiptDatabase): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("kec_verified_execution_receipts") !== undefined
  );
}

function initializeReceiptSchema(database: ReceiptDatabase): void {
  const applicationId = pragmaNumber(database, "application_id");
  const userVersion = pragmaNumber(database, "user_version");
  const exists = receiptTableExists(database);
  if (!exists && applicationId === 0 && userVersion === 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE kec_verified_execution_receipts (
          source_identity TEXT COLLATE BINARY NOT NULL,
          revision_key TEXT COLLATE BINARY NOT NULL,
          blob_algorithm TEXT COLLATE BINARY NOT NULL,
          blob_digest TEXT COLLATE BINARY NOT NULL,
          extraction_contract TEXT COLLATE BINARY NOT NULL,
          locator_space TEXT COLLATE BINARY NOT NULL,
          admission_sequence INTEGER NOT NULL,
          commitment_algorithm TEXT COLLATE BINARY NOT NULL,
          commitment_codec TEXT COLLATE BINARY NOT NULL,
          commitment_digest TEXT COLLATE BINARY NOT NULL,
          PRIMARY KEY (
            source_identity, revision_key, blob_algorithm, blob_digest,
            extraction_contract, locator_space, admission_sequence
          )
        ) STRICT;
        PRAGMA application_id = ${receiptStoreApplicationId};
        PRAGMA user_version = ${receiptStoreSchemaVersion};
      `);
      database.exec("COMMIT");
    } catch (failure) {
      database.exec("ROLLBACK");
      throw failure;
    }
    return;
  }
  if (
    !exists ||
    applicationId !== receiptStoreApplicationId ||
    userVersion !== receiptStoreSchemaVersion
  ) {
    throw new ReceiptStoreFailure("schema", "unsupported receipt store schema");
  }
}

export class SqliteVerifiedExecutionReceiptStore {
  private readonly database: ReceiptDatabase;
  private closed = false;

  constructor(dbPath: string) {
    let database: ReceiptDatabase | undefined;
    try {
      database = new DatabaseSync(dbPath);
      initializeReceiptSchema(database);
      this.database = database;
    } catch (failure) {
      try {
        database?.close();
      } catch {
        // Keep the opening or schema failure.
      }
      throw failure instanceof ReceiptStoreFailure
        ? failure
        : new ReceiptStoreFailure("unavailable", "cannot open receipt store", {
            cause: failure,
          });
    }
  }

  appendDerivedReceipt(receipt: KecVerifiedExecutionReceipt): void {
    this.assertOpen();
    validateReceipt(receipt);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(
          `SELECT commitment_algorithm, commitment_codec, commitment_digest
             FROM kec_verified_execution_receipts
            WHERE source_identity = ? AND revision_key = ?
              AND blob_algorithm = ? AND blob_digest = ?
              AND extraction_contract = ? AND locator_space = ?
              AND admission_sequence = ?`,
        )
        .get(...values(receipt), receipt.admissionSequence) as
        | {
            commitment_algorithm: unknown;
            commitment_codec: unknown;
            commitment_digest: unknown;
          }
        | undefined;
      if (existing !== undefined) {
        if (
          existing.commitment_algorithm !== receipt.commitmentAlgorithm ||
          existing.commitment_codec !== receipt.commitmentCodec ||
          existing.commitment_digest !== receipt.commitmentDigest
        ) {
          throw new ReceiptCollisionFailure();
        }
        this.database.exec("COMMIT");
        return;
      }
      this.database
        .prepare(
          `INSERT INTO kec_verified_execution_receipts (
             source_identity, revision_key, blob_algorithm, blob_digest,
             extraction_contract, locator_space, admission_sequence,
             commitment_algorithm, commitment_codec, commitment_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ...values(receipt),
          receipt.admissionSequence,
          receipt.commitmentAlgorithm,
          receipt.commitmentCodec,
          receipt.commitmentDigest,
        );
      this.database.exec("COMMIT");
    } catch (failure) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Keep the original append failure.
      }
      if (
        failure instanceof ReceiptCollisionFailure ||
        failure instanceof TypeError ||
        failure instanceof ReceiptStoreFailure
      ) {
        throw failure;
      }
      throw new ReceiptStoreFailure(
        "transaction",
        "receipt append transaction failed",
        { cause: failure },
      );
    }
  }

  findVerifiedExecutions(
    query?: KecVerifiedExecutionCoordinates,
  ): readonly KecVerifiedExecutionReceipt[] {
    this.assertOpen();
    try {
      const selection =
        query === undefined
          ? this.database
              .prepare(
                `SELECT source_identity, revision_key, blob_algorithm, blob_digest,
                extraction_contract, locator_space, admission_sequence,
                commitment_algorithm, commitment_codec, commitment_digest
           FROM kec_verified_execution_receipts
          ORDER BY source_identity ASC, revision_key ASC,
                   blob_algorithm ASC, blob_digest ASC,
                   extraction_contract ASC, locator_space ASC,
                   admission_sequence ASC`,
              )
              .all()
          : this.database
              .prepare(
                `SELECT source_identity, revision_key, blob_algorithm, blob_digest,
                extraction_contract, locator_space, admission_sequence,
                commitment_algorithm, commitment_codec, commitment_digest
           FROM kec_verified_execution_receipts
          WHERE source_identity = ? AND revision_key = ?
            AND blob_algorithm = ? AND blob_digest = ?
            AND extraction_contract = ? AND locator_space = ?
          ORDER BY admission_sequence ASC`,
              )
              .all(...values(query));
      return selection.map((row) => {
        const stored = row as Record<string, unknown>;
        const receipt = Object.freeze({
          sourceIdentity: stored.source_identity,
          revisionKey: stored.revision_key,
          blobAlgorithm: stored.blob_algorithm,
          blobDigest: stored.blob_digest,
          extractionContract: stored.extraction_contract,
          locatorSpace: stored.locator_space,
          admissionSequence: stored.admission_sequence,
          commitmentAlgorithm: stored.commitment_algorithm,
          commitmentCodec: stored.commitment_codec,
          commitmentDigest: stored.commitment_digest,
        }) as KecVerifiedExecutionReceipt;
        try {
          validateReceipt(receipt);
        } catch (failure) {
          throw new ReceiptStoreFailure("corrupt", "invalid stored receipt", {
            cause: failure,
          });
        }
        return receipt;
      });
    } catch (failure) {
      throw failure instanceof ReceiptStoreFailure
        ? failure
        : new ReceiptStoreFailure("unavailable", "cannot read receipt store", {
            cause: failure,
          });
    }
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ReceiptStoreFailure(
        "unavailable",
        "verified execution receipt store closed",
      );
    }
  }
}
