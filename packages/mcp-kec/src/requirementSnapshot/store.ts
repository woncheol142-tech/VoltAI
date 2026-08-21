import { createRequire } from "node:module";

import type {
  KecRequirementExtraction,
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
  KecRequirementId,
} from "../knowledge/requirementExtraction.js";
import { KEC_REQUIREMENT_LOCATOR_SPACE } from "../knowledge/requirementExtraction.js";
import type {
  KecCapturedRequirementSnapshot,
  KecSourceCaptureContractId,
  KecSourceCaptureFragment,
  KecSourceCaptureObservation,
  KecSourceCaptureSnapshot,
} from "../knowledge/sourceCapture.js";
import {
  compareKecSourceCaptureObservations,
  KEC_SOURCE_CAPTURE_CONTRACT_ID,
  normalizeKecSourceText,
} from "../knowledge/sourceCapture.js";

import {
  decodeKecSourceCaptureObservation,
  encodeKecSourceCaptureObservation,
} from "./captureCodec.js";
import type { KecRequirementSnapshotErrorCategory } from "./errors.js";
import { KecRequirementSnapshotStoreError } from "./errors.js";
import {
  decodeKecRequirementLocators,
  encodeKecRequirementLocators,
} from "./locatorCodec.js";
import type { RequirementSnapshotSchemaMode } from "./schema.js";
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

type CaptureRow = {
  readonly observation_index: unknown;
  readonly kind: unknown;
  readonly payload_json: unknown;
};

type EncodedMember = {
  readonly requirementId: string;
  readonly statement: string;
  readonly locatorsText: string;
};

type EncodedCapture = {
  readonly kind: KecSourceCaptureObservation["kind"];
  readonly payloadText: string;
};

type CaptureValidationFailure = Extract<
  KecRequirementSnapshotErrorCategory,
  "capture-invalid" | "capture-corruption"
>;

export type KecSnapshotWithCaptureLoadResult =
  | { readonly status: "not-found" }
  | {
      readonly status: "capture-absent";
      readonly requirementSnapshot: KecRequirementExtractionSnapshot;
    }
  | {
      readonly status: "captured";
      readonly requirementSnapshot: KecRequirementExtractionSnapshot;
      readonly captureSnapshot: KecSourceCaptureSnapshot;
    };

function normalizeStorageFailure(failure: unknown): never {
  if (failure instanceof KecRequirementSnapshotStoreError) throw failure;
  throw new KecRequirementSnapshotStoreError("storage");
}

function captureFailure(category: CaptureValidationFailure): never {
  throw new KecRequirementSnapshotStoreError(category);
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

function sameSnapshotBinding(
  left: KecRequirementExtractionBinding,
  right: KecRequirementExtractionBinding,
): boolean {
  return (
    JSON.stringify(bindingValues(left)) === JSON.stringify(bindingValues(right))
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

function auditRequirementMembers(database: RequirementSnapshotDatabase): void {
  const orphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_members AS m
       LEFT JOIN kec_requirement_snapshots AS s USING (snapshot_id)
       WHERE s.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  if (orphan !== undefined) {
    throw new KecRequirementSnapshotStoreError("member-corruption");
  }
}

function auditCaptureRows(database: RequirementSnapshotDatabase): void {
  const headerOrphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_captures AS c
       LEFT JOIN kec_requirement_snapshots AS s USING (snapshot_id)
       WHERE s.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  const observationOrphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_capture_observations AS o
       LEFT JOIN kec_requirement_snapshot_captures AS c
         ON c.snapshot_id = o.snapshot_id
        AND c.capture_contract = o.capture_contract
       WHERE c.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  const unknownKind = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_capture_observations
       WHERE kind NOT IN (
         'column-gap-region-excluded',
         'suppressed-assembly',
         'requirement-assembly'
       )
       LIMIT 1`,
    )
    .get();
  if (
    headerOrphan !== undefined ||
    observationOrphan !== undefined ||
    unknownKind !== undefined
  ) {
    throw new KecRequirementSnapshotStoreError("capture-corruption");
  }
}

function snapshotFromRows(
  binding: KecRequirementExtractionBinding,
  rows: readonly MemberRow[],
): KecRequirementExtractionSnapshot {
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
}

function insertRequirementSnapshot(
  database: RequirementSnapshotDatabase,
  snapshot: KecRequirementExtractionSnapshot,
  encoded: readonly EncodedMember[],
): number | bigint {
  database
    .prepare(
      `INSERT INTO kec_requirement_snapshots (
         source_identity, revision_key, blob_algorithm, blob_digest,
         extraction_contract, locator_space
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(...bindingValues(snapshot.binding));
  const inserted = findSnapshot(database, snapshot.binding);
  if (inserted === undefined) {
    throw new KecRequirementSnapshotStoreError("storage");
  }
  const id = snapshotId(inserted);
  const insertMember = database.prepare(
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
  return id;
}

function validFragmentDetectors(fragment: KecSourceCaptureFragment): boolean {
  if (fragment.role === "normative-pattern-fragment") {
    return (
      fragment.detectors.length === 1 &&
      fragment.detectors[0] === "normative-sentence-ending"
    );
  }
  return (
    fragment.detectors.length > 0 &&
    fragment.detectors.every(
      (detector) => detector !== "normative-sentence-ending",
    )
  );
}

function validateCaptureSemantics(
  requirementSnapshot: KecRequirementExtractionSnapshot,
  observations: readonly KecSourceCaptureObservation[],
  category: CaptureValidationFailure,
): void {
  const ordered = [...observations].sort(compareKecSourceCaptureObservations);
  if (JSON.stringify(ordered) !== JSON.stringify(observations)) {
    captureFailure(category);
  }

  for (const observation of observations) {
    if (observation.kind === "suppressed-assembly") {
      const last = observation.fragments.at(-1);
      if (
        last?.role !== "normative-pattern-fragment" ||
        observation.fragments
          .slice(0, -1)
          .some(({ role }) => role !== "attached-context-fragment") ||
        observation.blockingCandidate.role !== "unattached-context-candidate" ||
        !observation.fragments.every(validFragmentDetectors) ||
        !validFragmentDetectors(observation.blockingCandidate)
      ) {
        captureFailure(category);
      }
    }
  }

  const assemblies = observations.filter(
    (
      observation,
    ): observation is Extract<
      KecSourceCaptureObservation,
      { readonly kind: "requirement-assembly" }
    > => observation.kind === "requirement-assembly",
  );
  if (assemblies.length !== requirementSnapshot.requirements.length) {
    captureFailure(category);
  }
  for (const [position, assembly] of assemblies.entries()) {
    const requirement = requirementSnapshot.requirements[position];
    if (
      requirement === undefined ||
      assembly.requirementId !== requirement.requirement.id ||
      assembly.fragments.at(-1)?.role !== "normative-pattern-fragment" ||
      assembly.fragments
        .slice(0, -1)
        .some(({ role }) => role !== "attached-context-fragment") ||
      !assembly.fragments.every(validFragmentDetectors)
    ) {
      captureFailure(category);
    }
    const statement = normalizeKecSourceText(
      assembly.fragments.map(({ observedText }) => observedText).join(" "),
    );
    if (statement !== requirement.requirement.statement) {
      captureFailure(category);
    }
    if (
      JSON.stringify(assembly.fragments.map(({ span }) => span)) !==
      JSON.stringify(requirement.provenance.locators)
    ) {
      captureFailure(category);
    }
  }
}

function encodeCapture(
  snapshot: KecCapturedRequirementSnapshot,
): readonly EncodedCapture[] {
  if (
    !sameSnapshotBinding(
      snapshot.requirementSnapshot.binding,
      snapshot.captureSnapshot.binding,
    )
  ) {
    throw new KecRequirementSnapshotStoreError("binding-mismatch");
  }
  if (
    snapshot.captureSnapshot.captureContract !== KEC_SOURCE_CAPTURE_CONTRACT_ID
  ) {
    throw new KecRequirementSnapshotStoreError("capture-invalid");
  }
  return snapshot.captureSnapshot.observations.map((observation) => ({
    kind: observation.kind,
    payloadText: encodeKecSourceCaptureObservation(observation),
  }));
}

function hasCapture(
  database: RequirementSnapshotDatabase,
  id: number | bigint,
  contract: KecSourceCaptureContractId,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 AS found
         FROM kec_requirement_snapshot_captures
         WHERE snapshot_id = ? AND capture_contract = ?`,
      )
      .get(id, contract) !== undefined
  );
}

function captureRows(
  database: RequirementSnapshotDatabase,
  id: number | bigint,
  contract: KecSourceCaptureContractId,
): readonly CaptureRow[] {
  return database
    .prepare(
      `SELECT observation_index, kind, payload_json
       FROM kec_requirement_snapshot_capture_observations
       WHERE snapshot_id = ? AND capture_contract = ?
       ORDER BY observation_index ASC`,
    )
    .all(id, contract) as CaptureRow[];
}

function decodeCaptureRows(rows: readonly CaptureRow[]): {
  readonly observations: readonly KecSourceCaptureObservation[];
  readonly encoded: readonly EncodedCapture[];
} {
  const observations: KecSourceCaptureObservation[] = [];
  const encoded: EncodedCapture[] = [];
  for (const [position, row] of rows.entries()) {
    if (
      row.observation_index !== position ||
      typeof row.kind !== "string" ||
      typeof row.payload_json !== "string"
    ) {
      captureFailure("capture-corruption");
    }
    const observation = decodeKecSourceCaptureObservation(row.payload_json);
    if (row.kind !== observation.kind) captureFailure("capture-corruption");
    observations.push(observation);
    encoded.push({ kind: observation.kind, payloadText: row.payload_json });
  }
  return { observations, encoded };
}

function insertCapture(
  database: RequirementSnapshotDatabase,
  id: number | bigint,
  captureSnapshot: KecSourceCaptureSnapshot,
  encoded: readonly EncodedCapture[],
): void {
  database
    .prepare(
      `INSERT INTO kec_requirement_snapshot_captures
         (snapshot_id, capture_contract)
       VALUES (?, ?)`,
    )
    .run(id, captureSnapshot.captureContract);
  const insertObservation = database.prepare(
    `INSERT INTO kec_requirement_snapshot_capture_observations
       (snapshot_id, capture_contract, observation_index, kind, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [position, observation] of encoded.entries()) {
    insertObservation.run(
      id,
      captureSnapshot.captureContract,
      position,
      observation.kind,
      observation.payloadText,
    );
  }
}

export class KecRequirementSnapshotStore {
  private readonly database: RequirementSnapshotDatabase;
  private readonly schemaMode: RequirementSnapshotSchemaMode;
  private closed = false;

  constructor(dbPath: string) {
    let database: RequirementSnapshotDatabase;
    try {
      database = new DatabaseSync(dbPath);
    } catch {
      throw new KecRequirementSnapshotStoreError("storage");
    }
    let schemaMode: RequirementSnapshotSchemaMode;
    try {
      schemaMode = openRequirementSnapshotSchema(database);
      auditRequirementMembers(database);
      if (schemaMode === 2) auditCaptureRows(database);
    } catch (failure) {
      try {
        database.close();
      } catch {
        // Keep the schema or storage failure.
      }
      normalizeStorageFailure(failure);
    }
    this.database = database;
    this.schemaMode = schemaMode;
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
      insertRequirementSnapshot(this.database, snapshot, encoded);
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
      return snapshotFromRows(
        binding,
        memberRows(this.database, snapshotId(stored)),
      );
    });
  }

  storeCapturedSnapshot(snapshot: KecCapturedRequirementSnapshot): void {
    this.assertOpen();
    if (this.schemaMode === 1) {
      throw new KecRequirementSnapshotStoreError("capture-unsupported-schema");
    }
    const members = validateAndEncode(snapshot.requirementSnapshot);
    const encoded = encodeCapture(snapshot);

    this.transaction(() => {
      const existing = findSnapshot(
        this.database,
        snapshot.requirementSnapshot.binding,
      );
      let id: number | bigint;
      if (existing === undefined) {
        validateCaptureSemantics(
          snapshot.requirementSnapshot,
          snapshot.captureSnapshot.observations,
          "capture-invalid",
        );
        id = insertRequirementSnapshot(
          this.database,
          snapshot.requirementSnapshot,
          members,
        );
      } else {
        ensureStoredBinding(existing);
        id = snapshotId(existing);
        const rows = memberRows(this.database, id);
        if (!exactPopulation(rows, members)) {
          throw new KecRequirementSnapshotStoreError("snapshot-conflict");
        }
        if (
          hasCapture(
            this.database,
            id,
            snapshot.captureSnapshot.captureContract,
          )
        ) {
          const stored = decodeCaptureRows(
            captureRows(
              this.database,
              id,
              snapshot.captureSnapshot.captureContract,
            ),
          );
          const storedSnapshot = snapshotFromRows(
            snapshot.requirementSnapshot.binding,
            rows,
          );
          validateCaptureSemantics(
            storedSnapshot,
            stored.observations,
            "capture-corruption",
          );
          if (JSON.stringify(stored.encoded) === JSON.stringify(encoded)) {
            return;
          }
          throw new KecRequirementSnapshotStoreError("capture-conflict");
        }
        validateCaptureSemantics(
          snapshot.requirementSnapshot,
          snapshot.captureSnapshot.observations,
          "capture-invalid",
        );
      }
      insertCapture(this.database, id, snapshot.captureSnapshot, encoded);
    });
  }

  loadSnapshotWithCapture(
    binding: KecRequirementExtractionBinding,
    captureContract: KecSourceCaptureContractId,
  ): KecSnapshotWithCaptureLoadResult {
    this.assertOpen();
    if (binding.locatorSpace !== KEC_REQUIREMENT_LOCATOR_SPACE) {
      throw new KecRequirementSnapshotStoreError("unsupported-locator-space");
    }
    return this.storageOperation(() => {
      auditStoredBindings(this.database);
      const stored = findSnapshot(this.database, binding);
      if (stored === undefined) return { status: "not-found" };
      ensureStoredBinding(stored);
      const id = snapshotId(stored);
      const requirementSnapshot = snapshotFromRows(
        binding,
        memberRows(this.database, id),
      );
      if (
        this.schemaMode === 1 ||
        !hasCapture(this.database, id, captureContract)
      ) {
        return { status: "capture-absent", requirementSnapshot };
      }
      if (captureContract !== KEC_SOURCE_CAPTURE_CONTRACT_ID) {
        throw new KecRequirementSnapshotStoreError("capture-corruption");
      }
      const decoded = decodeCaptureRows(
        captureRows(this.database, id, captureContract),
      );
      validateCaptureSemantics(
        requirementSnapshot,
        decoded.observations,
        "capture-corruption",
      );
      const captureSnapshot: KecSourceCaptureSnapshot = {
        binding,
        captureContract,
        observations: decoded.observations,
      };
      return { status: "captured", requirementSnapshot, captureSnapshot };
    });
  }

  close(): void {
    if (this.closed) return;
    this.storageOperation(() => this.database.close());
    this.closed = true;
  }
}
