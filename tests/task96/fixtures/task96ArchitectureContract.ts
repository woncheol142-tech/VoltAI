import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../../packages/source-core/src/index.js";

export type Task96RedFailureCode =
  | "MISSING_SOURCE_ADMISSION"
  | "MISSING_SOURCE_ADMISSION_SQLITE"
  | "MISSING_TASK90_VERIFIER_GATE"
  | "MISSING_KEC_SOURCE_RUNTIME"
  | "MISSING_RESULT_COMMITMENT_CODEC"
  | "MISSING_TASK96_CONTRACT";

export class Task96RedContractError extends Error {
  readonly code: Task96RedFailureCode;

  constructor(code: Task96RedFailureCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Task96RedContractError";
    this.code = code;
  }
}

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(fixtureDirectory, "../../..");

export const task96Paths = Object.freeze({
  sourceAdmissionRoot: resolve(workspaceRoot, "packages/source-admission"),
  sourceAdmissionEntrypoint: resolve(
    workspaceRoot,
    "packages/source-admission/src/index.ts",
  ),
  sourceAdmissionManifest: resolve(
    workspaceRoot,
    "packages/source-admission/package.json",
  ),
  sourceAdmissionSqliteRoot: resolve(
    workspaceRoot,
    "packages/source-admission-sqlite",
  ),
  sourceAdmissionSqliteEntrypoint: resolve(
    workspaceRoot,
    "packages/source-admission-sqlite/src/index.ts",
  ),
  sourceAdmissionSqliteManifest: resolve(
    workspaceRoot,
    "packages/source-admission-sqlite/package.json",
  ),
  task90Producer: resolve(
    workspaceRoot,
    "packages/mcp-kec/src/knowledge/requirementExtraction.ts",
  ),
  task93Schema: resolve(
    workspaceRoot,
    "packages/mcp-kec/src/requirementSnapshot/schema.ts",
  ),
  task93Store: resolve(
    workspaceRoot,
    "packages/mcp-kec/src/requirementSnapshot/store.ts",
  ),
  kecSourceRuntimeRoot: resolve(workspaceRoot, "packages/kec-source-runtime"),
  kecSourceRuntimeEntrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/index.ts",
  ),
  kecSourceRuntimeManifest: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/package.json",
  ),
  resultCommitmentModule: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/internal/resultCommitment.ts",
  ),
  receiptStoreModule: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/internal/receiptStore.ts",
  ),
  decisionSqliteManifest: resolve(
    workspaceRoot,
    "packages/decision-sqlite/package.json",
  ),
  decisionSqliteEntrypoint: resolve(
    workspaceRoot,
    "packages/decision-sqlite/src/index.ts",
  ),
});

export type SourceBindingFixture = Readonly<{
  sourceRevision: SourceRevision;
  blobHash: SourceBlobHash;
}>;

export type AdmissionRecordReferenceFixture = Readonly<{
  sourceIdentity: SourceIdentity;
  revisionKey: SourceRevisionKey;
  blobAlgorithm: "sha-256";
  blobDigest: string;
  admissionSequence: number;
}>;

export type VerifyBindingKind =
  | "BINDING_ADMITTED"
  | "BINDING_NOT_ADMITTED"
  | "BINDING_WITHDRAWN"
  | "BINDING_CONTRADICTION";

export type ResultCommitmentFixture = Readonly<{
  algorithm: "sha-256";
  codec: "kec:verified-extraction-result:v1";
  digest: string;
}>;

export const RESULT_COMMITMENT_ALGORITHM = "sha-256" as const;
export const RESULT_COMMITMENT_CODEC =
  "kec:verified-extraction-result:v1" as const;

export function sourceRevisionFixture(
  sourceIdentity = "task96:source:A",
  revisionKey = "task96:revision:1",
): SourceRevision {
  return Object.freeze({
    sourceIdentity: sourceIdentity as SourceIdentity,
    revisionKey: revisionKey as SourceRevisionKey,
  });
}

export function blobHashFixture(digest = "a".repeat(64)): SourceBlobHash {
  return Object.freeze({ algorithm: "sha-256", digest });
}

export function bindingFixture(
  sourceRevision = sourceRevisionFixture(),
  blobHash = blobHashFixture(),
): SourceBindingFixture {
  return Object.freeze({ sourceRevision, blobHash });
}

export function referenceFixture(
  binding = bindingFixture(),
  admissionSequence = 1,
): AdmissionRecordReferenceFixture {
  return Object.freeze({
    sourceIdentity: binding.sourceRevision.sourceIdentity,
    revisionKey: binding.sourceRevision.revisionKey,
    blobAlgorithm: binding.blobHash.algorithm,
    blobDigest: binding.blobHash.digest,
    admissionSequence,
  });
}

export function verdictKind(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.kind === "string"
    ? candidate.kind
    : typeof candidate.status === "string"
      ? candidate.status
      : undefined;
}

export function admissionReference(
  value: unknown,
): AdmissionRecordReferenceFixture | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  const nested = candidate.reference ?? candidate.admissionReference ?? value;
  if (typeof nested !== "object" || nested === null) return undefined;
  return nested as AdmissionRecordReferenceFixture;
}

export function requiredText(path: string, code: Task96RedFailureCode): string {
  if (!existsSync(path)) {
    throw new Task96RedContractError(code, `required file is absent: ${path}`);
  }
  return readFileSync(path, "utf8");
}

export function requiredJson(
  path: string,
  code: Task96RedFailureCode,
): Readonly<Record<string, unknown>> {
  return JSON.parse(requiredText(path, code)) as Readonly<
    Record<string, unknown>
  >;
}

async function loadModule(
  path: string,
  code: Task96RedFailureCode,
): Promise<Readonly<Record<string, unknown>>> {
  if (!existsSync(path)) {
    throw new Task96RedContractError(code, `entrypoint is absent: ${path}`);
  }
  return import(/* @vite-ignore */ pathToFileURL(path).href) as Promise<
    Readonly<Record<string, unknown>>
  >;
}

export function requiredFunction(
  owner: Readonly<Record<string, unknown>>,
  name: string,
): (...args: readonly unknown[]) => unknown {
  const operation = owner[name];
  if (typeof operation !== "function") {
    throw new Task96RedContractError(
      "MISSING_TASK96_CONTRACT",
      `required operation is absent: ${name}`,
    );
  }
  return operation.bind(owner) as (...args: readonly unknown[]) => unknown;
}

export async function loadSourceAdmission(): Promise<
  Readonly<Record<string, unknown>>
> {
  return loadModule(
    task96Paths.sourceAdmissionEntrypoint,
    "MISSING_SOURCE_ADMISSION",
  );
}

export async function loadSourceAdmissionSqlite(): Promise<
  Readonly<Record<string, unknown>>
> {
  return loadModule(
    task96Paths.sourceAdmissionSqliteEntrypoint,
    "MISSING_SOURCE_ADMISSION_SQLITE",
  );
}

export async function loadKecSourceRuntime(): Promise<
  Readonly<Record<string, unknown>>
> {
  return loadModule(
    task96Paths.kecSourceRuntimeEntrypoint,
    "MISSING_KEC_SOURCE_RUNTIME",
  );
}

export async function loadResultCommitmentCodec(): Promise<
  Readonly<Record<string, unknown>>
> {
  return loadModule(
    task96Paths.resultCommitmentModule,
    "MISSING_RESULT_COMMITMENT_CODEC",
  );
}

export async function invoke(
  operation: (...args: readonly unknown[]) => unknown,
  ...args: readonly unknown[]
): Promise<unknown> {
  return operation(...args);
}

type FamilyLocation = Readonly<{ file: string; case: string }>;

export const TASK96_RED_FAMILY_MAP = Object.freeze({
  A: {
    file: "task96SourceAdmission.red.test.ts",
    case: "unknown identity cannot admit",
  },
  B: {
    file: "task96SourceAdmission.red.test.ts",
    case: "unestablished revision cannot admit",
  },
  C: {
    file: "task96SourceAdmission.red.test.ts",
    case: "exact revision required",
  },
  D: { file: "task96SourceAdmission.red.test.ts", case: "exact blob required" },
  E: {
    file: "task96SourceAdmission.red.test.ts",
    case: "many-to-many admitted",
  },
  F: {
    file: "task96SourceAdmission.red.test.ts",
    case: "blob does not imply identity",
  },
  G: {
    file: "task96SourceAdmission.red.test.ts",
    case: "locator does not imply identity",
  },
  H: {
    file: "task96SourceAdmission.red.test.ts",
    case: "absence differs from nonexistence",
  },
  I: {
    file: "task96SourceAdmission.red.test.ts",
    case: "mismatch differs from store failure",
  },
  J: {
    file: "task96SourceAdmission.red.test.ts",
    case: "admission idempotency",
  },
  K: {
    file: "task96SourceAdmission.red.test.ts",
    case: "controlled concurrent admission",
  },
  L: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "changed bytes refused",
  },
  M: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "TOCTOU path forbidden",
  },
  N: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "all Task90 paths gated",
  },
  O: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "Task93 provenance tuple prerequisite",
  },
  P: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "no retroactive blessing",
  },
  Q: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "current KEC auto issuance remains zero",
  },
  R: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "non-citability firewall",
  },
  S: {
    file: "task96SourceAdmission.red.test.ts",
    case: "no proper-subset uniqueness",
  },
  T: {
    file: "task96SourceAdmission.red.test.ts",
    case: "admission public export surface",
  },
  U: {
    file: "task96SourceAdmission.red.test.ts",
    case: "admission dependency direction",
  },
  V: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "Task90 heuristics unchanged",
  },
  W: {
    file: "task96SourceAdmission.red.test.ts",
    case: "verifyBinding locator blind",
  },
  X: { file: "task96SourceAdmission.red.test.ts", case: "no SourceBindingId" },
  Y: {
    file: "task96SourceAdmission.red.test.ts",
    case: "per-admission withdrawal",
  },
  Z: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "exact byte invariant",
  },
  AA: {
    file: "task96Task90VerifierGate.red.test.ts",
    case: "decision-sqlite exports preserved",
  },
  AB: {
    file: "task96SourceAdmission.red.test.ts",
    case: "withdrawn plus active admitted",
  },
  AC: {
    file: "task96SourceAdmission.red.test.ts",
    case: "all withdrawn distinct from never admitted",
  },
  AD: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "late admission does not verify",
  },
  AE: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "verified execution records receipt",
  },
  AF: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "readmission preserves historical proof",
  },
  AG: {
    file: "task96SourceAdmission.red.test.ts",
    case: "store failure outside semantic four",
  },
  AH: {
    file: "task96SourceAdmission.red.test.ts",
    case: "admission excludes extraction-core",
  },
  AI: {
    file: "task96SourceAdmission.red.test.ts",
    case: "citability not required",
  },
  AJ: {
    file: "task96SourceAdmission.red.test.ts",
    case: "semantic dependency inversion",
  },
  AK: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "receipt without snapshot incomplete",
  },
  AL: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "snapshot without receipt incomplete",
  },
  AM: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "cross-store crash fail closed",
  },
  AN: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "orphan receipt retry converges",
  },
  AO: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "receiptless snapshot retry converges",
  },
  AP: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "caller cannot forge receipt",
  },
  AQ: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "legacy snapshot creation unchanged",
  },
  AR: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "concurrent duplicate receipt safe",
  },
  AS: {
    file: "task96SourceAdmission.red.test.ts",
    case: "admission API has no receipt writer",
  },
  AT: {
    file: "task96SourceAdmission.red.test.ts",
    case: "admission schema has no receipt data",
  },
  AU: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "runtime owns extraction receipt concepts",
  },
  AV: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "receipt requires admitted verdict",
  },
  AW: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "caller admission ref cannot authorize",
  },
  AX: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "no raw receipt export",
  },
  AY: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "receipt NEW snapshot OLD incomplete",
  },
  AZ: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "durable commitment recomputed exactly",
  },
  BA: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "identical legacy snapshot completes later execution",
  },
  BB: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "zero requirements valid",
  },
  BC: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "tuple cannot satisfy mismatched receipt",
  },
  BD: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "conflict retry remains fail closed",
  },
  BE: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "present empty capture valid for zero requirements",
  },
  BF: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "absent capture differs from present empty",
  },
  BG: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "execution commitment collision",
  },
  BH: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "same commitment distinct execution keys",
  },
  BI: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "historical codec immutable",
  },
  BJ: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "unsupported codec fails closed",
  },
  BK: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "commitment covers full result",
  },
  BL: {
    file: "task96KecSourceRuntime.red.test.ts",
    case: "blob hash differs from result commitment",
  },
} satisfies Readonly<Record<string, FamilyLocation>>);

export const EXPECTED_TASK96_FAMILY_LABELS = Object.freeze([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((suffix) => `A${suffix}`),
  ..."ABCDEFGHIJKL".split("").map((suffix) => `B${suffix}`),
]);
