import { createRequire } from "node:module";

import type {
  KecRequirementExtraction,
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
  KecRequirementId,
} from "../knowledge/requirementExtraction.js";
import { KEC_REQUIREMENT_LOCATOR_SPACE } from "../knowledge/requirementExtraction.js";

import { KecRequirementSnapshotStoreError } from "./errors.js";
import {
  decodeKecRequirementLocators,
  encodeKecRequirementLocators,
} from "./locatorCodec.js";
import { openRequirementSnapshotSchema } from "./schema.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type RequirementSnapshotDatabase = InstanceType<typeof DatabaseSync>;

type SnapshotRow = {
  readonly snapshot_id: unknown;
  readonly source_identity: unknown;
  readonly revision_key: unknown;
  readonly blob_algorithm: unknown;
  readonly blob_digest: unknown;
  readonly extraction_contract: unknown;
  readonly locator_space: unknown;
};

type MemberRow = {
  readonly population_index: unknown;
  readonly requirement_id: unknown;
  readonly statement: unknown;
  readonly locators_json: unknown;
};

type EncodedMember = {
  readonly requirementId: string;
  readonly statement: string;
  readonly locatorsText: string;
};

function normalizeStorageFailure(failure: unknown): never {
  if (failure instanceof KecRequirementSnapshotStoreError) throw failure;
  throw new KecRequirementSnapshotStoreError("storage");
}

function sameBinding(
  member: KecRequirementExtraction,
  binding: KecRequirementExtractionBinding,
): boolean {
  return (
    member.provenance.sourceRevision.sourceIdentity ===
      binding.sourceRevision.sourceIdentity &&
    member.provenance.sourceRevision.revisionKey ===
      binding.sourceRevision.revisionKey &&
    member.provenance.lineage.input.algorithm === binding.blobHash.algorithm &&
    member.provenance.lineage.input.digest === binding.blobHash.digest &&
    member.provenance.lineage.contract === binding.extractionContract &&
    member.provenance.locatorSpace === binding.locatorSpace
  );
}

function validateAndEncode(
  snapshot: KecRequirementExtractionSnapshot,
): readonly EncodedMember[] {
  if (snapshot.binding.locatorSpace !== KEC_REQUIREMENT_LOCATOR_SPACE) {
    throw new KecRequirementSnapshotStoreError("unsupported-locator-space");
  }
  const encoded: EncodedMember[] = [];
  for (const member of snapshot.requirements) {
    if (!sameBinding(member, snapshot.binding)) {
      throw new KecRequirementSnapshotStoreError("binding-mismatch");
    }
    encoded.push({
      requirementId: member.requirement.id,
      statement: member.requirement.statement,
      locatorsText: encodeKecRequirementLocators(member.provenance.locators),
    });
  }
  return encoded;
}

function snapshotId(row: SnapshotRow): number | bigint {
  if (
    (typeof row.snapshot_id !== "number" &&
      typeof row.snapshot_id !== "bigint") ||
    (typeof row.snapshot_id === "number" &&
      (!Number.isSafeInteger(row.snapshot_id) || row.snapshot_id < 1)) ||
    (typeof row.snapshot_id === "bigint" && row.snapshot_id < 1n)
  ) {
    throw new KecRequirementSnapshotStoreError("member-corruption");
  }
  return row.snapshot_id;
}

function ensureStoredBinding(row: SnapshotRow): void {
  if (
    typeof row.source_identity !== "string" ||
    typeof row.revision_key !== "string" ||
    row.blob_algorithm !== "sha-256" ||
    typeof row.blob_digest !== "string" ||
    typeof row.extraction_contract !== "string" ||
    row.locator_space !== KEC_REQUIREMENT_LOCATOR_SPACE
  ) {
    throw new KecRequirementSnapshotStoreError("member-corruption");
  }
}

function memberRows(
  database: RequirementSnapshotDatabase,
  id: number | bigint,
): readonly MemberRow[] {
  return database
    .prepare(
      `SELECT population_index, requirement_id, statement, locators_json
       FROM kec_requirement_snapshot_members
       WHERE snapshot_id = ?
       ORDER BY population_index ASC`,
    )
    .all(id) as MemberRow[];
}

function validateMemberRows(rows: readonly MemberRow[]): void {
  for (const [position, row] of rows.entries()) {
    if (
      row.population_index !== position ||
      typeof row.requirement_id !== "string" ||
      typeof row.statement !== "string"
    ) {
      throw new KecRequirementSnapshotStoreError("member-corruption");
    }
    if (typeof row.locators_json !== "string") {
      throw new KecRequirementSnapshotStoreError("locator-decode");
    }
    decodeKecRequirementLocators(row.locators_json);
  }
}

function exactPopulation(
  rows: readonly MemberRow[],
  incoming: readonly EncodedMember[],
): boolean {
  validateMemberRows(rows);
  return (
    rows.length === incoming.length &&
    rows.every(
      (row, position) =>
        row.requirement_id === incoming[position]!.requirementId &&
        row.statement === incoming[position]!.statement &&
        row.locators_json === incoming[position]!.locatorsText,
    )
  );
}

function bindingValues(
  binding: KecRequirementExtractionBinding,
): readonly [string, string, string, string, string, string] {
  return [
    binding.sourceRevision.sourceIdentity,
    binding.sourceRevision.revisionKey,
    binding.blobHash.algorithm,
    binding.blobHash.digest,
    binding.extractionContract,
    binding.locatorSpace,
  ];
}

function findSnapshot(
  database: RequirementSnapshotDatabase,
  binding: KecRequirementExtractionBinding,
): SnapshotRow | undefined {
  return database
    .prepare(
      `SELECT snapshot_id, source_identity, revision_key, blob_algorithm,
              blob_digest, extraction_contract, locator_space
       FROM kec_requirement_snapshots
       WHERE source_identity = ?
         AND revision_key = ?
         AND blob_algorithm = ?
         AND blob_digest = ?
         AND extraction_contract = ?
         AND locator_space = ?`,
    )
    .get(...bindingValues(binding)) as SnapshotRow | undefined;
}

function auditStoredBindings(database: RequirementSnapshotDatabase): void {
  const invalid = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshots
       WHERE blob_algorithm <> ? OR locator_space <> ?
       LIMIT 1`,
    )
    .get("sha-256", KEC_REQUIREMENT_LOCATOR_SPACE);
  if (invalid !== undefined) {
    throw new KecRequirementSnapshotStoreError("member-corruption");
  }
}

export class KecRequirementSnapshotStore {
  private readonly database: RequirementSnapshotDatabase;
  private closed = false;

  constructor(dbPath: string) {
    let database: RequirementSnapshotDatabase;
    try {
      database = new DatabaseSync(dbPath);
    } catch {
      throw new KecRequirementSnapshotStoreError("storage");
    }
    try {
      openRequirementSnapshotSchema(database);
    } catch (failure) {
      try {
        database.close();
      } catch {
        // Preserve the schema or storage failure.
      }
      normalizeStorageFailure(failure);
    }
    this.database = database;
  }

  private assertOpen(): void {
    if (this.closed) throw new KecRequirementSnapshotStoreError("closed");
  }

  private storageOperation<Result>(operation: () => Result): Result {
    try {
      return operation();
    } catch (failure) {
      normalizeStorageFailure(failure);
    }
  }

  private transaction<Result>(operation: () => Result): Result {
    return this.storageOperation(() => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (failure) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          throw new KecRequirementSnapshotStoreError("storage");
        }
        throw failure;
      }
    });
  }

  storeSnapshot(snapshot: KecRequirementExtractionSnapshot): void {
    this.assertOpen();
    const encoded = validateAndEncode(snapshot);

    this.transaction(() => {
      const existing = findSnapshot(this.database, snapshot.binding);
      if (existing !== undefined) {
        ensureStoredBinding(existing);
        const rows = memberRows(this.database, snapshotId(existing));
        if (!exactPopulation(rows, encoded)) {
          throw new KecRequirementSnapshotStoreError("snapshot-conflict");
        }
        return;
      }

      this.database
        .prepare(
          `INSERT INTO kec_requirement_snapshots (
             source_identity, revision_key, blob_algorithm, blob_digest,
             extraction_contract, locator_space
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(...bindingValues(snapshot.binding));
      const inserted = findSnapshot(this.database, snapshot.binding);
      if (inserted === undefined) {
        throw new KecRequirementSnapshotStoreError("storage");
      }
      const id = snapshotId(inserted);
      const insertMember = this.database.prepare(
        `INSERT INTO kec_requirement_snapshot_members (
           snapshot_id, population_index, requirement_id, statement, locators_json
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const [populationIndex, member] of encoded.entries()) {
        insertMember.run(
          id,
          populationIndex,
          member.requirementId,
          member.statement,
          member.locatorsText,
        );
      }
    });
  }

  loadSnapshot(
    binding: KecRequirementExtractionBinding,
  ): KecRequirementExtractionSnapshot | null {
    this.assertOpen();
    if (binding.locatorSpace !== KEC_REQUIREMENT_LOCATOR_SPACE) {
      throw new KecRequirementSnapshotStoreError("unsupported-locator-space");
    }

    return this.storageOperation(() => {
      auditStoredBindings(this.database);
      const stored = findSnapshot(this.database, binding);
      if (stored === undefined) return null;
      ensureStoredBinding(stored);
      const rows = memberRows(this.database, snapshotId(stored));
      validateMemberRows(rows);
      const requirements = rows.map((row): KecRequirementExtraction => ({
        requirement: {
          id: row.requirement_id as KecRequirementId,
          statement: row.statement as string,
        },
        provenance: {
          sourceRevision: binding.sourceRevision,
          lineage: {
            input: binding.blobHash,
            contract: binding.extractionContract,
          },
          locatorSpace: binding.locatorSpace,
          locators: decodeKecRequirementLocators(row.locators_json as string),
        },
      }));
      return { binding, requirements };
    });
  }

  close(): void {
    if (this.closed) return;
    this.storageOperation(() => this.database.close());
    this.closed = true;
  }
}
