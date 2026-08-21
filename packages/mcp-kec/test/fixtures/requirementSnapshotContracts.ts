import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AnchorLocatorSpace,
  ExtractionContractId,
} from "../../../extraction-core/src/index.js";
import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../../source-core/src/index.js";
import type {
  ExtractKecRequirementsInput,
  KecRequirementExtraction,
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
  KecRequirementId,
  extractKecRequirementSnapshot,
} from "../../src/knowledge/requirementExtraction.js";
import type {
  KecRequirementSnapshotErrorCategory,
  KecRequirementSnapshotStore,
} from "../../src/requirementSnapshot/index.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type Expect<Value extends true> = Value;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <
        Value,
      >() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type BindingKeysAreExact = Expect<
  Equal<
    keyof KecRequirementExtractionBinding,
    "blobHash" | "extractionContract" | "locatorSpace" | "sourceRevision"
  >
>;
type BindingShapeIsExact = Expect<
  Equal<
    KecRequirementExtractionBinding,
    {
      readonly sourceRevision: SourceRevision;
      readonly blobHash: SourceBlobHash;
      readonly extractionContract: ExtractionContractId;
      readonly locatorSpace: AnchorLocatorSpace;
    }
  >
>;
type SnapshotKeysAreExact = Expect<
  Equal<keyof KecRequirementExtractionSnapshot, "binding" | "requirements">
>;
type SnapshotReusesTask90Member = Expect<
  Equal<
    KecRequirementExtractionSnapshot,
    {
      readonly binding: KecRequirementExtractionBinding;
      readonly requirements: readonly KecRequirementExtraction[];
    }
  >
>;
type ProducerSignatureIsExact = Expect<
  Equal<
    typeof extractKecRequirementSnapshot,
    (
      input: ExtractKecRequirementsInput,
    ) => Promise<KecRequirementExtractionSnapshot>
  >
>;
type StoreSnapshotSignatureIsExact = Expect<
  Equal<
    KecRequirementSnapshotStore["storeSnapshot"],
    (snapshot: KecRequirementExtractionSnapshot) => void
  >
>;
type LoadSnapshotSignatureIsExact = Expect<
  Equal<
    KecRequirementSnapshotStore["loadSnapshot"],
    (
      binding: KecRequirementExtractionBinding,
    ) => KecRequirementExtractionSnapshot | null
  >
>;
type CloseSignatureIsExact = Expect<
  Equal<KecRequirementSnapshotStore["close"], () => void>
>;
type Task91ErrorCategoriesRemain = Expect<
  Equal<
    Extract<
      KecRequirementSnapshotErrorCategory,
      | "binding-mismatch"
      | "unsupported-locator-space"
      | "snapshot-conflict"
      | "locator-encode"
      | "locator-decode"
      | "member-corruption"
      | "schema"
      | "storage"
      | "closed"
    >,
    | "binding-mismatch"
    | "unsupported-locator-space"
    | "snapshot-conflict"
    | "locator-encode"
    | "locator-decode"
    | "member-corruption"
    | "schema"
    | "storage"
    | "closed"
  >
>;

export type RequirementSnapshotContractChecks =
  | BindingKeysAreExact
  | BindingShapeIsExact
  | SnapshotKeysAreExact
  | SnapshotReusesTask90Member
  | ProducerSignatureIsExact
  | StoreSnapshotSignatureIsExact
  | LoadSnapshotSignatureIsExact
  | CloseSignatureIsExact
  | Task91ErrorCategoriesRemain;

function assertReadonlyContracts(
  binding: KecRequirementExtractionBinding,
  snapshot: KecRequirementExtractionSnapshot,
  member: KecRequirementExtraction,
): void {
  // @ts-expect-error Task91 bindings are immutable values.
  binding.blobHash = { algorithm: "sha-256", digest: "changed" };
  // @ts-expect-error Task91 snapshots are immutable values.
  snapshot.binding = binding;
  // @ts-expect-error Task91 populations are readonly.
  snapshot.requirements.push(member);
}

void assertReadonlyContracts;

export const TASK91_APPLICATION_ID = 0x56524831;
export const TASK91_V1_USER_VERSION = 1;
export const TASK93_USER_VERSION = 2;
// Retain the predecessor name for Task91 tests that intentionally freeze v1.
export const TASK91_USER_VERSION = TASK91_V1_USER_VERSION;
export const TASK91_EXTRACTION_CONTRACT_ID =
  "kec:pdfjs-structural-normative-paragraphs:v1";
export const TASK91_LOCATOR_SPACE = "kec:pdf-text-item-span:v1";
export const TASK91_ERROR_CATEGORIES = [
  "binding-mismatch",
  "unsupported-locator-space",
  "snapshot-conflict",
  "locator-encode",
  "locator-decode",
  "member-corruption",
  "schema",
  "storage",
  "closed",
] as const;
export const TASK93_ERROR_CATEGORIES = [
  ...TASK91_ERROR_CATEGORIES,
  "capture-invalid",
  "capture-conflict",
  "capture-corruption",
  "capture-unsupported-schema",
] as const;
export const TASK91_V1_TABLES = [
  "kec_requirement_snapshots",
  "kec_requirement_snapshot_members",
] as const;
export const TASK93_V2_TABLES = [
  ...TASK91_V1_TABLES,
  "kec_requirement_snapshot_captures",
  "kec_requirement_snapshot_capture_observations",
] as const;

export const tempSnapshotRoots: string[] = [];

export function createTempSnapshotDatabase(prefix = "voltai-task91-red-"): {
  readonly root: string;
  readonly dbPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(root, "requirements.sqlite");
  tempSnapshotRoots.push(root);
  return { root, dbPath };
}

export function cleanupTempSnapshotDatabases(): void {
  for (const root of tempSnapshotRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function initializeExactTask91V1Database(dbPath: string): void {
  const database = new DatabaseSync(dbPath);
  try {
    database.exec(`
      CREATE TABLE kec_requirement_snapshots (
        snapshot_id INTEGER PRIMARY KEY,
        source_identity TEXT COLLATE BINARY NOT NULL,
        revision_key TEXT COLLATE BINARY NOT NULL,
        blob_algorithm TEXT COLLATE BINARY NOT NULL,
        blob_digest TEXT COLLATE BINARY NOT NULL,
        extraction_contract TEXT COLLATE BINARY NOT NULL,
        locator_space TEXT COLLATE BINARY NOT NULL,
        UNIQUE (
          source_identity,
          revision_key,
          blob_algorithm,
          blob_digest,
          extraction_contract,
          locator_space
        )
      ) STRICT;

      CREATE TABLE kec_requirement_snapshot_members (
        snapshot_id INTEGER NOT NULL,
        population_index INTEGER NOT NULL,
        requirement_id TEXT COLLATE BINARY NOT NULL,
        statement TEXT NOT NULL,
        locators_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, population_index),
        UNIQUE (snapshot_id, requirement_id)
      ) STRICT;

      PRAGMA application_id = ${TASK91_APPLICATION_ID};
      PRAGMA user_version = ${TASK91_V1_USER_VERSION};
    `);
  } finally {
    database.close();
  }
}

export function seedTask91V1Snapshot(
  dbPath: string,
  snapshot = task91Snapshot(),
  snapshotId = 41,
): void {
  const database = new DatabaseSync(dbPath);
  try {
    const binding = snapshot.binding;
    database
      .prepare(
        `INSERT INTO kec_requirement_snapshots (
           snapshot_id, source_identity, revision_key, blob_algorithm,
           blob_digest, extraction_contract, locator_space
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshotId,
        binding.sourceRevision.sourceIdentity,
        binding.sourceRevision.revisionKey,
        binding.blobHash.algorithm,
        binding.blobHash.digest,
        binding.extractionContract,
        binding.locatorSpace,
      );
    const insertMember = database.prepare(
      `INSERT INTO kec_requirement_snapshot_members (
         snapshot_id, population_index, requirement_id, statement, locators_json
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [populationIndex, member] of snapshot.requirements.entries()) {
      insertMember.run(
        snapshotId,
        populationIndex,
        member.requirement.id,
        member.requirement.statement,
        canonicalLocators(member.provenance.locators),
      );
    }
  } finally {
    database.close();
  }
}

export function schemaObjects(
  dbPath: string,
): readonly Record<string, unknown>[] {
  const database = new DatabaseSync(dbPath);
  try {
    return database
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
      )
      .all() as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

export function task91SourceRevision(
  sourceIdentity = "kec:official-standard",
  revisionKey = "2026-08-19-approved",
): SourceRevision {
  return {
    sourceIdentity: sourceIdentity as SourceIdentity,
    revisionKey: revisionKey as SourceRevisionKey,
  };
}

export function task91BlobHash(seed = "task91-source-bytes"): SourceBlobHash {
  return {
    algorithm: "sha-256",
    digest: createHash("sha256").update(seed).digest("hex"),
  };
}

export function task91Binding(
  overrides: Partial<{
    readonly sourceRevision: SourceRevision;
    readonly blobHash: SourceBlobHash;
    readonly extractionContract: ExtractionContractId;
    readonly locatorSpace: AnchorLocatorSpace;
  }> = {},
): KecRequirementExtractionBinding {
  return {
    sourceRevision: overrides.sourceRevision ?? task91SourceRevision(),
    blobHash: overrides.blobHash ?? task91BlobHash(),
    extractionContract:
      overrides.extractionContract ??
      (TASK91_EXTRACTION_CONTRACT_ID as ExtractionContractId),
    locatorSpace:
      overrides.locatorSpace ?? (TASK91_LOCATOR_SPACE as AnchorLocatorSpace),
  };
}

export function task91Requirement(
  binding: KecRequirementExtractionBinding,
  options: {
    readonly id?: string;
    readonly statement?: string;
    readonly locators?: readonly [
      {
        readonly pageNumber: number;
        readonly startItemIndex: number;
        readonly endItemIndexExclusive: number;
      },
      ...{
        readonly pageNumber: number;
        readonly startItemIndex: number;
        readonly endItemIndexExclusive: number;
      }[],
    ];
  } = {},
): KecRequirementExtraction {
  return {
    requirement: {
      id: (options.id ?? "z-extraction-first") as KecRequirementId,
      statement: options.statement ?? "전기설비는 시설하여야 한다",
    },
    provenance: {
      sourceRevision: binding.sourceRevision,
      lineage: {
        input: binding.blobHash,
        contract: binding.extractionContract,
      },
      locatorSpace: binding.locatorSpace,
      locators: options.locators ?? [
        { pageNumber: 1, startItemIndex: 7, endItemIndexExclusive: 9 },
      ],
    },
  };
}

export function task91Snapshot(
  binding = task91Binding(),
): KecRequirementExtractionSnapshot {
  return {
    binding,
    requirements: [
      task91Requirement(binding, {
        id: "z-extraction-first",
        statement: "첫 번째 요구사항은 시설하여야 한다",
        locators: [
          { pageNumber: 2, startItemIndex: 8, endItemIndexExclusive: 10 },
          { pageNumber: 2, startItemIndex: 12, endItemIndexExclusive: 13 },
        ],
      }),
      task91Requirement(binding, {
        id: "a-extraction-second",
        statement: "두 번째 요구사항은 점검하여야 한다",
        locators: [
          { pageNumber: 1, startItemIndex: 3, endItemIndexExclusive: 4 },
        ],
      }),
    ],
  };
}

export function canonicalLocators(
  locators: KecRequirementExtraction["provenance"]["locators"],
): string {
  return JSON.stringify(
    locators.map((locator) => [
      locator.pageNumber,
      locator.startItemIndex,
      locator.endItemIndexExclusive,
    ]),
  );
}

export function semanticRows(dbPath: string): {
  readonly snapshots: readonly Record<string, unknown>[];
  readonly members: readonly Record<string, unknown>[];
} {
  const database = new DatabaseSync(dbPath);
  try {
    return {
      snapshots: database
        .prepare("SELECT * FROM kec_requirement_snapshots ORDER BY snapshot_id")
        .all() as Record<string, unknown>[],
      members: database
        .prepare(
          "SELECT * FROM kec_requirement_snapshot_members ORDER BY snapshot_id, population_index",
        )
        .all() as Record<string, unknown>[],
    };
  } finally {
    database.close();
  }
}

export { DatabaseSync };
