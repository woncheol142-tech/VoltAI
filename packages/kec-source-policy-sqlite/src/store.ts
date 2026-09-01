import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import {
  createKecSourcePolicy,
  type AssertionSchemeVersion,
} from "@voltai/kec-source-policy";
import type {
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "@voltai/source-core";

import {
  PolicyEpochSealedFailure,
  PolicyRegistrationFailure,
  SourceResolutionStoreFailure,
} from "./errors.js";
import type {
  EstablishedSourceRevisionRecord,
  PolicyConfigurationSnapshot,
  RevisionScheme,
  Task97Instrumentation,
} from "./types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type Database = InstanceType<typeof DatabaseSync>;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "string") {
    throw new SourceResolutionStoreFailure("corrupt", `invalid ${field}`);
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) {
    throw new SourceResolutionStoreFailure("corrupt", `invalid ${field}`);
  }
  return parsed as Record<string, unknown>;
}

function schema(database: Database): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS policy_epoch (
      epoch TEXT PRIMARY KEY,
      sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS registered_scheme_version (
      epoch TEXT NOT NULL,
      scheme_id TEXT NOT NULL,
      version TEXT NOT NULL,
      policy_domain TEXT NOT NULL DEFAULT 'GENERIC',
      scheme_json TEXT NOT NULL,
      PRIMARY KEY (epoch, scheme_id, version)
    );
    CREATE TABLE IF NOT EXISTS active_origin_designation (
      epoch TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL,
      version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_revision_scheme (
      epoch TEXT NOT NULL,
      scheme_id TEXT NOT NULL,
      scheme_version TEXT NOT NULL,
      scheme_json TEXT NOT NULL,
      PRIMARY KEY (epoch, scheme_id, scheme_version)
    );
    CREATE TABLE IF NOT EXISTS crosswalk_edge (
      epoch TEXT NOT NULL,
      left_claim_key TEXT NOT NULL,
      right_claim_key TEXT NOT NULL,
      relation TEXT NOT NULL,
      PRIMARY KEY (epoch, left_claim_key, right_claim_key)
    );
    CREATE TABLE IF NOT EXISTS cross_version_correspondence (
      epoch TEXT NOT NULL,
      predecessor_scheme_id TEXT NOT NULL,
      predecessor_version TEXT NOT NULL,
      successor_scheme_id TEXT NOT NULL,
      successor_version TEXT NOT NULL,
      correspondence_json TEXT NOT NULL,
      PRIMARY KEY (
        epoch, predecessor_scheme_id, predecessor_version,
        successor_scheme_id, successor_version
      )
    );
    CREATE TABLE IF NOT EXISTS assertion_claim (
      claim_key TEXT PRIMARY KEY,
      source_identity TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revision_claim (
      revision_claim_key TEXT PRIMARY KEY,
      source_identity TEXT NOT NULL,
      revision_key TEXT NOT NULL,
      revision_basis_json TEXT NOT NULL,
      resolution_record_ref TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_revision (
      source_identity TEXT NOT NULL,
      revision_key TEXT NOT NULL,
      identity_basis_json TEXT NOT NULL,
      revision_basis_json TEXT NOT NULL,
      resolution_record_ref TEXT NOT NULL,
      PRIMARY KEY (source_identity, revision_key)
    );
    CREATE TABLE IF NOT EXISTS issuance_request (
      request_key TEXT PRIMARY KEY,
      content_canonical TEXT NOT NULL,
      outcome_canonical TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS acquisition_record (
      acquisition_ref TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL,
      locator_scheme TEXT NOT NULL,
      locator_value TEXT NOT NULL,
      blob_algorithm TEXT NOT NULL,
      blob_digest TEXT NOT NULL,
      byte_length INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resolution_record (
      resolution_key TEXT PRIMARY KEY,
      outcome_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_policy_question (
      question_key TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (question_key, subject_key)
    );
    CREATE TABLE IF NOT EXISTS activation_read_snapshot (
      snapshot_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch TEXT NOT NULL,
      active_count INTEGER NOT NULL CHECK (active_count >= 0)
    );
    CREATE TABLE IF NOT EXISTS bootstrap_configuration (
      epoch TEXT PRIMARY KEY,
      configured INTEGER NOT NULL CHECK (configured IN (0, 1)),
      ceremony_reference TEXT NOT NULL
    );
  `);
}

function open(path: string): Database {
  try {
    const database = new DatabaseSync(text(path, "databasePath"));
    schema(database);
    return database;
  } catch (failure) {
    if (failure instanceof SourceResolutionStoreFailure) throw failure;
    throw new SourceResolutionStoreFailure(
      "unavailable",
      "cannot open source policy store",
      { cause: failure },
    );
  }
}

function ensureEpoch(database: Database, epoch: string): void {
  database
    .prepare(
      "INSERT INTO policy_epoch(epoch) VALUES (?) ON CONFLICT DO NOTHING",
    )
    .run(epoch);
}

function assertMutable(database: Database, epoch: string): void {
  ensureEpoch(database, epoch);
  const row = database
    .prepare("SELECT sealed FROM policy_epoch WHERE epoch = ?")
    .get(epoch);
  if (row?.sealed === 1) throw new PolicyEpochSealedFailure(epoch);
}

function establishedFromRow(
  row: Record<string, unknown> | undefined,
): EstablishedSourceRevisionRecord | undefined {
  if (row === undefined) return undefined;
  const identity = text(
    row.source_identity,
    "source_identity",
  ) as SourceIdentity;
  const key = text(row.revision_key, "revision_key") as SourceRevisionKey;
  return Object.freeze({
    sourceRevision: Object.freeze({
      sourceIdentity: identity,
      revisionKey: key,
    }),
    identityBasis: parseRecord(row.identity_basis_json, "identity_basis_json"),
    revisionBasis: parseRecord(row.revision_basis_json, "revision_basis_json"),
    resolutionRecordRef: text(
      row.resolution_record_ref,
      "resolution_record_ref",
    ),
  });
}

export class PolicyResolutionStore {
  private readonly database: Database;
  private closed = false;

  constructor(
    path: string,
    private readonly instrumentation: Task97Instrumentation = {},
  ) {
    this.database = open(path);
  }

  configuration(epoch: string): PolicyConfigurationSnapshot {
    this.assertOpen();
    ensureEpoch(this.database, epoch);
    const schemeRows = this.database
      .prepare(
        "SELECT scheme_json FROM registered_scheme_version WHERE epoch = ? ORDER BY scheme_id, version",
      )
      .all(epoch) as Record<string, unknown>[];
    const revisionRows = this.database
      .prepare(
        "SELECT scheme_json FROM registered_revision_scheme WHERE epoch = ? ORDER BY scheme_id, scheme_version",
      )
      .all(epoch) as Record<string, unknown>[];
    const activeRows = this.database
      .prepare(
        "SELECT scheme_id, version FROM active_origin_designation WHERE epoch = ?",
      )
      .all(epoch) as Record<string, unknown>[];
    const epochRow = this.database
      .prepare("SELECT sealed FROM policy_epoch WHERE epoch = ?")
      .get(epoch);
    return Object.freeze({
      epoch,
      registeredSchemes: Object.freeze(
        schemeRows.map(
          (row) =>
            parseRecord(
              row.scheme_json,
              "scheme_json",
            ) as AssertionSchemeVersion,
        ),
      ),
      activeAutomaticOriginSchemeVersions: Object.freeze(
        activeRows.map((row) =>
          Object.freeze({
            schemeId: text(row.scheme_id, "scheme_id"),
            version: text(row.version, "version"),
          }),
        ),
      ),
      registeredRevisionSchemes: Object.freeze(
        revisionRows.map(
          (row) =>
            parseRecord(row.scheme_json, "scheme_json") as RevisionScheme,
        ),
      ),
      sealed: epochRow?.sealed === 1,
    });
  }

  identityFor(claimKey: string): SourceIdentity | undefined {
    this.assertOpen();
    const row = this.database
      .prepare(
        "SELECT source_identity FROM assertion_claim WHERE claim_key = ?",
      )
      .get(claimKey);
    return typeof row?.source_identity === "string"
      ? (row.source_identity as SourceIdentity)
      : undefined;
  }

  issueIdentity(): SourceIdentity {
    this.assertOpen();
    return `si:kec:v1:${randomBytes(16).toString("hex")}` as SourceIdentity;
  }

  issueRevisionKey(): SourceRevisionKey {
    this.assertOpen();
    return `srk:kec:v1:${randomBytes(16).toString("hex")}` as SourceRevisionKey;
  }

  issuanceOutcome(requestKey: string): unknown | undefined {
    this.assertOpen();
    const row = this.database
      .prepare(
        "SELECT outcome_canonical FROM issuance_request WHERE request_key = ?",
      )
      .get(requestKey);
    return typeof row?.outcome_canonical === "string"
      ? JSON.parse(row.outcome_canonical)
      : undefined;
  }

  registerIssuance(
    requestKey: string,
    content: unknown,
    outcome: unknown,
  ): unknown {
    this.assertOpen();
    const contentCanonical = json(content);
    const outcomeCanonical = json(outcome);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO issuance_request(
             request_key, content_canonical, outcome_canonical
           ) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .run(requestKey, contentCanonical, outcomeCanonical);
      const stored = this.database
        .prepare(
          `SELECT content_canonical, outcome_canonical FROM issuance_request
           WHERE request_key = ?`,
        )
        .get(requestKey);
      this.database.exec("COMMIT");
      if (stored?.content_canonical !== contentCanonical) {
        return Object.freeze({
          kind: "ISSUANCE_REQUEST_COLLISION",
          reason: "ISSUANCE_REQUEST_CONTENT_CONFLICT",
        });
      }
      if (typeof stored.outcome_canonical !== "string") {
        throw new Error("issuance request outcome disappeared");
      }
      return JSON.parse(stored.outcome_canonical);
    } catch (failure) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary failure.
      }
      throw new SourceResolutionStoreFailure(
        "transaction",
        "cannot register issuance request",
        { cause: failure },
      );
    }
  }

  associateIdentity(
    claimKey: string,
    proposed: SourceIdentity,
  ): SourceIdentity {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          "INSERT INTO assertion_claim(claim_key, source_identity) VALUES (?, ?) ON CONFLICT DO NOTHING",
        )
        .run(claimKey, proposed);
      const winner = this.identityFor(claimKey);
      if (winner === undefined)
        throw new Error("claim association disappeared");
      this.database.exec("COMMIT");
      this.instrumentation.associateIdentity?.(claimKey, winner);
      return winner;
    } catch (failure) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary failure.
      }
      throw new SourceResolutionStoreFailure(
        "transaction",
        "cannot associate assertion claim",
        { cause: failure },
      );
    }
  }

  revisionFor(
    revisionClaimKey: string,
  ): EstablishedSourceRevisionRecord | undefined {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT sr.source_identity, sr.revision_key, sr.identity_basis_json,
                sr.revision_basis_json, sr.resolution_record_ref
         FROM revision_claim rc
         JOIN source_revision sr
           ON sr.source_identity = rc.source_identity
          AND sr.revision_key = rc.revision_key
         WHERE rc.revision_claim_key = ?`,
      )
      .get(revisionClaimKey) as Record<string, unknown> | undefined;
    return establishedFromRow(row);
  }

  associateRevision(
    input: Readonly<{
      revisionClaimKey: string;
      proposed: SourceRevision;
      identityBasis: unknown;
      revisionBasis: unknown;
      resolutionRecordRef: string;
    }>,
  ): EstablishedSourceRevisionRecord {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO revision_claim(
             revision_claim_key, source_identity, revision_key,
             revision_basis_json, resolution_record_ref
           ) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .run(
          input.revisionClaimKey,
          input.proposed.sourceIdentity,
          input.proposed.revisionKey,
          json(input.revisionBasis),
          input.resolutionRecordRef,
        );
      const claim = this.database
        .prepare(
          "SELECT source_identity, revision_key FROM revision_claim WHERE revision_claim_key = ?",
        )
        .get(input.revisionClaimKey);
      const winner: SourceRevision = Object.freeze({
        sourceIdentity: text(
          claim?.source_identity,
          "source_identity",
        ) as SourceIdentity,
        revisionKey: text(
          claim?.revision_key,
          "revision_key",
        ) as SourceRevisionKey,
      });
      this.database
        .prepare(
          `INSERT INTO source_revision(
             source_identity, revision_key, identity_basis_json,
             revision_basis_json, resolution_record_ref
           ) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .run(
          winner.sourceIdentity,
          winner.revisionKey,
          json(input.identityBasis),
          json(input.revisionBasis),
          input.resolutionRecordRef,
        );
      this.database.exec("COMMIT");
      this.instrumentation.associateRevision?.(input.revisionClaimKey, winner);
      const established = this.loadEstablished(winner);
      if (established === undefined)
        throw new Error("revision association disappeared");
      return established;
    } catch (failure) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary failure.
      }
      if (failure instanceof SourceResolutionStoreFailure) throw failure;
      throw new SourceResolutionStoreFailure(
        "transaction",
        "cannot associate revision claim",
        { cause: failure },
      );
    }
  }

  loadEstablished(
    query: SourceRevision,
  ): EstablishedSourceRevisionRecord | undefined {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT source_identity, revision_key, identity_basis_json,
                revision_basis_json, resolution_record_ref
         FROM source_revision WHERE source_identity = ? AND revision_key = ?`,
      )
      .get(query.sourceIdentity, query.revisionKey) as
      Record<string, unknown> | undefined;
    return establishedFromRow(row);
  }

  persistAcquisition(input: Readonly<Record<string, unknown>>): void {
    this.assertOpen();
    const acquisition = input.acquisition as Record<string, unknown>;
    const locator = acquisition.locator as Record<string, unknown>;
    const blob = acquisition.observedBlobHash as Record<string, unknown>;
    this.database
      .prepare(
        `INSERT INTO acquisition_record(
           acquisition_ref, observation_id, locator_scheme, locator_value,
           blob_algorithm, blob_digest, byte_length
         ) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(
        `acquisition:${text(input.observationId, "observationId")}`,
        text(input.observationId, "observationId"),
        text(locator.scheme, "locator.scheme"),
        text(locator.value, "locator.value"),
        text(blob.algorithm, "blob.algorithm"),
        text(blob.digest, "blob.digest"),
        Number(acquisition.observedByteLength),
      );
  }

  persistResolution(key: string, value: unknown): void {
    this.assertOpen();
    const kind =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>).kind
        : undefined;
    this.database
      .prepare(
        "INSERT INTO resolution_record(resolution_key, outcome_kind, payload_json) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      )
      .run(key, typeof kind === "string" ? kind : "UNRESOLVED", json(value));
  }

  savePendingQuestion(
    questionKey: string,
    subjectKey: string,
    value: unknown,
  ): void {
    this.assertOpen();
    this.database
      .prepare(
        `INSERT INTO pending_policy_question(
           question_key, subject_key, payload_json
         ) VALUES (?, ?, ?) ON CONFLICT(question_key, subject_key)
         DO UPDATE SET payload_json = excluded.payload_json`,
      )
      .run(questionKey, subjectKey, json(value));
  }

  loadPendingQuestion(
    questionKey: string,
    subjectKey: string,
  ): Record<string, unknown> | undefined {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT payload_json FROM pending_policy_question
         WHERE question_key = ? AND subject_key = ?`,
      )
      .get(questionKey, subjectKey);
    return typeof row?.payload_json === "string"
      ? parseRecord(row.payload_json, "payload_json")
      : undefined;
  }

  count(
    table:
      | "assertion_claim"
      | "revision_claim"
      | "source_revision"
      | "acquisition_record",
  ): number {
    this.assertOpen();
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get();
    return Number(row?.count ?? 0);
  }

  countDistinctIdentities(): number {
    this.assertOpen();
    const row = this.database
      .prepare(
        "SELECT COUNT(DISTINCT source_identity) AS count FROM assertion_claim",
      )
      .get();
    return Number(row?.count ?? 0);
  }

  crossVersionCorrespondence(
    input: Readonly<{
      epoch: string;
      predecessorSchemeId: string;
      predecessorVersion: string;
      successorSchemeId: string;
      successorVersion: string;
    }>,
  ): unknown | undefined {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT correspondence_json FROM cross_version_correspondence
         WHERE epoch = ? AND predecessor_scheme_id = ?
           AND predecessor_version = ? AND successor_scheme_id = ?
           AND successor_version = ?`,
      )
      .get(
        input.epoch,
        input.predecessorSchemeId,
        input.predecessorVersion,
        input.successorSchemeId,
        input.successorVersion,
      );
    return typeof row?.correspondence_json === "string"
      ? JSON.parse(row.correspondence_json)
      : undefined;
  }

  originTransition(
    input:
      | Readonly<{
          epoch: string;
          successorSchemeId: string;
          successorVersion: string;
        }>
      | undefined,
  ):
    | Readonly<{
        predecessorAutomaticOriginSchemeVersion: Readonly<{
          schemeId: string;
          version: string;
        }>;
        crossVersionCorrespondence: unknown;
      }>
    | undefined {
    if (input === undefined) return undefined;
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT predecessor_scheme_id, predecessor_version,
                correspondence_json
         FROM cross_version_correspondence
         WHERE epoch = ? AND successor_scheme_id = ?
           AND successor_version = ?`,
      )
      .get(input.epoch, input.successorSchemeId, input.successorVersion);
    if (
      typeof row?.predecessor_scheme_id !== "string" ||
      typeof row.predecessor_version !== "string" ||
      typeof row.correspondence_json !== "string"
    ) {
      return undefined;
    }
    return Object.freeze({
      predecessorAutomaticOriginSchemeVersion: Object.freeze({
        schemeId: row.predecessor_scheme_id,
        version: row.predecessor_version,
      }),
      crossVersionCorrespondence: JSON.parse(row.correspondence_json),
    });
  }

  crosswalkEdges(epoch: string): readonly Readonly<{
    left: string;
    right: string;
    relation: string;
  }>[] {
    this.assertOpen();
    return this.database
      .prepare(
        `SELECT left_claim_key AS left, right_claim_key AS right, relation
         FROM crosswalk_edge WHERE epoch = ? ORDER BY left_claim_key, right_claim_key`,
      )
      .all(epoch)
      .map((row) =>
        Object.freeze({
          left: text(row.left, "left"),
          right: text(row.right, "right"),
          relation: text(row.relation, "relation"),
        }),
      );
  }

  sealEpoch(epoch: string): void {
    this.assertOpen();
    ensureEpoch(this.database, epoch);
    this.database
      .prepare("UPDATE policy_epoch SET sealed = 1 WHERE epoch = ?")
      .run(epoch);
  }

  bootstrapConfigured(epoch: string): boolean {
    this.assertOpen();
    const row = this.database
      .prepare("SELECT configured FROM bootstrap_configuration WHERE epoch = ?")
      .get(epoch);
    return row?.configured === 1;
  }

  authorityLookupFirewallIntact(): boolean {
    this.assertOpen();
    const rows = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
      )
      .all() as readonly Record<string, unknown>[];
    return rows.every((row) => {
      const sql = typeof row.sql === "string" ? row.sql.toLowerCase() : "";
      return !(
        sql.includes("source_identity") &&
        (sql.includes("blob_digest") || sql.includes("locator"))
      );
    });
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SourceResolutionStoreFailure(
        "unavailable",
        "source policy store is closed",
      );
    }
  }
}

export class ReadOnlyEstablishedRevisionView {
  private readonly store: PolicyResolutionStore;

  constructor(path: string) {
    this.store = new PolicyResolutionStore(path);
  }

  loadEstablishedSourceRevision(query: SourceRevision): unknown {
    return this.store.loadEstablished(query) ?? { kind: "NOT_ESTABLISHED" };
  }

  findEstablishedRevisionByBlob(_value: unknown): unknown {
    if (_value === null || typeof _value !== "object") {
      throw new TypeError("blob query must be an object");
    }
    if (!this.store.authorityLookupFirewallIntact()) {
      throw new SourceResolutionStoreFailure(
        "corrupt",
        "blob-to-identity authority index is forbidden",
      );
    }
    return { kind: "NOT_ESTABLISHED" };
  }

  findEstablishedRevisionByLocator(_value: unknown): unknown {
    if (_value === null || typeof _value !== "object") {
      throw new TypeError("locator query must be an object");
    }
    if (!this.store.authorityLookupFirewallIntact()) {
      throw new SourceResolutionStoreFailure(
        "corrupt",
        "locator-to-identity authority index is forbidden",
      );
    }
    return { kind: "NOT_ESTABLISHED" };
  }

  close(): void {
    this.store.close();
  }
}

export class PolicyRegistrar {
  private readonly database: Database;

  constructor(private readonly path: string) {
    this.database = open(path);
  }

  registerAssertionSchemeVersion(
    input: Readonly<Record<string, unknown>>,
  ): void {
    const epoch = text(input.epoch, "epoch");
    const scheme = input.scheme as Record<string, unknown>;
    const canonicalization = scheme.canonicalization as
      Record<string, unknown> | undefined;
    const vectors = canonicalization?.reviewedKnownVectors;
    if (Array.isArray(vectors)) {
      const rawByCanonical = new Map<string, Set<string>>();
      for (const vector of vectors) {
        if (typeof vector !== "object" || vector === null) continue;
        const entry = vector as Record<string, unknown>;
        if (
          typeof entry.raw !== "string" ||
          typeof entry.canonical !== "string"
        ) {
          continue;
        }
        const values = rawByCanonical.get(entry.canonical) ?? new Set<string>();
        values.add(entry.raw);
        rawByCanonical.set(entry.canonical, values);
      }
      const declarations =
        canonicalization?.equivalencePreservingTransformations;
      if (
        [...rawByCanonical.values()].some((values) => values.size > 1) &&
        (!Array.isArray(declarations) || declarations.length === 0)
      ) {
        throw new PolicyRegistrationFailure(
          "UNDECLARED_CANONICALIZATION_COLLISION",
        );
      }
    }
    assertMutable(this.database, epoch);
    this.database
      .prepare(
        `INSERT INTO registered_scheme_version(
           epoch, scheme_id, version, policy_domain, scheme_json
         ) VALUES (?, ?, ?, ?, ?) ON CONFLICT(epoch, scheme_id, version)
         DO UPDATE SET scheme_json = excluded.scheme_json`,
      )
      .run(
        epoch,
        text(scheme.schemeId, "schemeId"),
        text(scheme.version, "version"),
        scheme.sourceDomain === "KEC" ? "KEC" : "GENERIC",
        json(scheme),
      );
  }

  registerRevisionAssertionScheme(
    input: Readonly<Record<string, unknown>>,
  ): void {
    const epoch = text(input.epoch, "epoch");
    const scheme = input.scheme as Record<string, unknown>;
    assertMutable(this.database, epoch);
    this.database
      .prepare(
        `INSERT INTO registered_revision_scheme(
           epoch, scheme_id, scheme_version, scheme_json
         ) VALUES (?, ?, ?, ?) ON CONFLICT(epoch, scheme_id, scheme_version)
         DO UPDATE SET scheme_json = excluded.scheme_json`,
      )
      .run(
        epoch,
        text(scheme.schemeId, "schemeId"),
        text(scheme.schemeVersion, "schemeVersion"),
        json(scheme),
      );
  }

  replaceActiveOriginScheme(input: Readonly<Record<string, unknown>>): void {
    const epoch = text(input.epoch, "epoch");
    assertMutable(this.database, epoch);
    const schemeId = text(input.schemeId, "schemeId");
    const schemeVersion = text(input.schemeVersion, "schemeVersion");
    const registered = this.database
      .prepare(
        `SELECT 1 AS present FROM registered_scheme_version
         WHERE epoch = ? AND scheme_id = ? AND version = ?`,
      )
      .get(epoch, schemeId, schemeVersion);
    if (registered?.present !== 1) {
      throw new PolicyRegistrationFailure(
        "ACTIVE_SCHEME_VERSION_NOT_REGISTERED",
      );
    }
    const schemes = this.database
      .prepare(
        "SELECT scheme_json FROM registered_scheme_version WHERE epoch = ?",
      )
      .all(epoch)
      .map((row) => parseRecord(row.scheme_json, "scheme_json"));
    const prior = this.database
      .prepare(
        "SELECT scheme_id, version FROM active_origin_designation WHERE epoch = ?",
      )
      .get(epoch);
    const correspondence =
      typeof prior?.scheme_id === "string" && typeof prior.version === "string"
        ? this.database
            .prepare(
              `SELECT correspondence_json FROM cross_version_correspondence
               WHERE epoch = ? AND predecessor_scheme_id = ?
                 AND predecessor_version = ? AND successor_scheme_id = ?
                 AND successor_version = ?`,
            )
            .get(epoch, prior.scheme_id, prior.version, schemeId, schemeVersion)
        : undefined;
    const policy = createKecSourcePolicy({
      opaqueIdentityIssuer: {
        issue: async () => {
          throw new Error("registrar cannot issue identity");
        },
      },
      assertionClaimRegistry: {
        identityFor: () => undefined,
        associateAtomically: () => {
          throw new Error("registrar cannot associate identity");
        },
      },
      issuanceRequestRegistry: {
        outcomeFor: () => undefined,
        register: () => {
          throw new Error("registrar cannot register issuance");
        },
      },
    });
    const validation = policy.validateSchemeActivation({
      activeAutomaticOriginSchemeVersions: [
        { schemeId, version: schemeVersion },
      ],
      registeredSchemes: schemes,
      ...(prior === undefined
        ? {}
        : {
            predecessorAutomaticOriginSchemeVersion: {
              schemeId: prior.scheme_id,
              version: prior.version,
            },
            crossVersionCorrespondence:
              typeof correspondence?.correspondence_json === "string"
                ? JSON.parse(correspondence.correspondence_json)
                : undefined,
          }),
    }) as Record<string, unknown>;
    if (validation.kind !== "POLICY_VALID") {
      throw new PolicyRegistrationFailure(
        String(validation.reason ?? "INVALID_POLICY_CONFIGURATION"),
      );
    }
    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database
        .prepare(
          `INSERT INTO active_origin_designation(epoch, scheme_id, version)
           VALUES (?, ?, ?) ON CONFLICT(epoch) DO UPDATE SET
             scheme_id = excluded.scheme_id, version = excluded.version`,
        )
        .run(epoch, schemeId, schemeVersion);
      this.database.exec("COMMIT");
    } catch (failure) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the primary failure.
      }
      throw new SourceResolutionStoreFailure(
        "transaction",
        "one active origin designation already exists",
        { cause: failure },
      );
    }
  }

  seedAssertionClaim(input: Readonly<Record<string, unknown>>): void {
    const store = new PolicyResolutionStore(this.path);
    try {
      store.associateIdentity(
        text(input.claimRegistryKey, "claimRegistryKey"),
        text(input.sourceIdentity, "sourceIdentity") as SourceIdentity,
      );
    } finally {
      store.close();
    }
  }

  associateAssertionClaimAtomically(
    input: Readonly<Record<string, unknown>>,
  ): unknown {
    const store = new PolicyResolutionStore(this.path);
    try {
      const key = text(input.claimRegistryKey, "claimRegistryKey");
      const proposed = text(
        input.proposedSourceIdentity,
        "proposedSourceIdentity",
      ) as SourceIdentity;
      const winner = store.associateIdentity(key, proposed);
      return winner === proposed
        ? { kind: "CLAIM_ASSOCIATED", sourceIdentity: winner }
        : {
            kind: "IDENTITY_ISSUANCE_CONFLICT",
            reason: "ASSERTION_CLAIM_CONFLICT",
          };
    } finally {
      store.close();
    }
  }

  identityForClaim(key: string): SourceIdentity | undefined {
    const store = new PolicyResolutionStore(this.path);
    try {
      return store.identityFor(key);
    } finally {
      store.close();
    }
  }

  countAssertionClaims(): number {
    return this.count("assertion_claim");
  }

  countAuthoritativeIdentities(): number {
    const store = new PolicyResolutionStore(this.path);
    try {
      return store.countDistinctIdentities();
    } finally {
      store.close();
    }
  }

  countRevisionClaims(): number {
    return this.count("revision_claim");
  }

  countEstablishedSourceRevisions(): number {
    return this.count("source_revision");
  }

  countAcquisitionRecords(): number {
    return this.count("acquisition_record");
  }

  activeOriginDesignations(epoch: string): readonly unknown[] {
    return this.database
      .prepare(
        "SELECT scheme_id AS schemeId, version FROM active_origin_designation WHERE epoch = ?",
      )
      .all(epoch);
  }

  registeredKecAssertionSchemes(epoch: string): readonly unknown[] {
    return this.database
      .prepare(
        `SELECT scheme_json FROM registered_scheme_version
         WHERE epoch = ? AND policy_domain = 'KEC'`,
      )
      .all(epoch);
  }

  countActiveOriginDesignations(epoch: string): number {
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM active_origin_designation WHERE epoch = ?",
      )
      .get(epoch);
    return Number(row?.count ?? 0);
  }

  capturedConcurrentReadSnapshots(epoch: string): readonly unknown[] {
    const observed = this.countActiveOriginDesignations(epoch);
    this.database
      .prepare(
        `INSERT INTO activation_read_snapshot(epoch, active_count)
         VALUES (?, ?)`,
      )
      .run(epoch, observed);
    return this.database
      .prepare(
        `SELECT active_count AS activeOriginDesignationCount
         FROM activation_read_snapshot WHERE epoch = ?
         ORDER BY snapshot_sequence`,
      )
      .all(epoch);
  }

  sealPolicyEpoch(epoch: string): void {
    ensureEpoch(this.database, epoch);
    this.database
      .prepare("UPDATE policy_epoch SET sealed = 1 WHERE epoch = ?")
      .run(epoch);
  }

  registerCrosswalkEdge(input: Readonly<Record<string, unknown>>): void {
    const epoch = text(input.epoch, "epoch");
    assertMutable(this.database, epoch);
    const relation = text(input.relation, "relation");
    if (relation !== "SAME" && relation !== "DIFFERENT") {
      throw new PolicyRegistrationFailure("INVALID_CROSSWALK_RELATION");
    }
    this.database
      .prepare(
        "INSERT INTO crosswalk_edge(epoch, left_claim_key, right_claim_key, relation) VALUES (?, ?, ?, ?)",
      )
      .run(
        epoch,
        text(input.left, "left"),
        text(input.right, "right"),
        relation,
      );
  }

  registerCrossVersionCorrespondence(
    input: Readonly<Record<string, unknown>>,
  ): void {
    const epoch = text(input.epoch, "epoch");
    assertMutable(this.database, epoch);
    const predecessor = input.predecessor as Record<string, unknown>;
    const successor = input.successor as Record<string, unknown>;
    this.database
      .prepare(
        `INSERT INTO cross_version_correspondence(
           epoch, predecessor_scheme_id, predecessor_version,
           successor_scheme_id, successor_version, correspondence_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        epoch,
        text(predecessor.schemeId, "predecessor.schemeId"),
        text(predecessor.version, "predecessor.version"),
        text(successor.schemeId, "successor.schemeId"),
        text(successor.version, "successor.version"),
        json(input.correspondence),
      );
  }

  activateEpoch(epoch: string): void {
    ensureEpoch(this.database, epoch);
  }

  markBootstrapConfigured(input: Readonly<Record<string, unknown>>): void {
    const epoch = text(input.epoch, "epoch");
    const ceremonyReference = text(
      input.ceremonyReference,
      "ceremonyReference",
    );
    this.database
      .prepare(
        `INSERT INTO bootstrap_configuration(
           epoch, configured, ceremony_reference
         ) VALUES (?, 1, ?)`,
      )
      .run(epoch, ceremonyReference);
  }

  openReadOnlyResolution(
    _input: Readonly<Record<string, unknown>>,
  ): ReadOnlyEstablishedRevisionView {
    void _input;
    return new ReadOnlyEstablishedRevisionView(this.path);
  }

  close(): void {
    this.database.close();
  }

  private count(
    table:
      | "assertion_claim"
      | "revision_claim"
      | "source_revision"
      | "acquisition_record",
  ): number {
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get();
    return Number(row?.count ?? 0);
  }
}
