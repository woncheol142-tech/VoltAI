import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deterministicKoreanPdfBytes } from "../../../packages/mcp-kec/test/fixtures/requirementExtractionContracts.js";
import type {
  ExternalSourceLocator,
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../../packages/source-core/src/index.js";

export type Task98R0Obligation =
  | "Z"
  | "AA"
  | "AB"
  | "BG-1"
  | "BG-2"
  | "BG-3"
  | "BG-4"
  | "BG-5"
  | "BG-6"
  | "BG-7"
  | "BG-8";

export type Task98R0Contract = Readonly<{
  testName: string;
  expectedCurrentFailure: string;
  failureMeaning: string;
  targetGreenBehavior: string;
  falseRedCondition: string;
}>;

export const TASK98_R0_CONTRACTS = Object.freeze({
  Z: {
    testName: "V2 technical extraction has no production authority effects",
    expectedCurrentFailure:
      "the authority-free V2 technical extraction surface is absent",
    failureMeaning:
      "the corrected parser authority firewall is not represented by an executable boundary",
    targetGreenBehavior:
      "V2 technical extraction accepts exact bytes without a verifier and exposes no production writer",
    falseRedCondition:
      "invalid PDF bytes, fixture-path failure, missing pdfjs, or temporary-root setup failure",
  },
  AA: {
    testName: "legacy V1 extraction contracts remain frozen",
    expectedCurrentFailure:
      "none; the existing characterization control is expected to pass",
    failureMeaning: "V1 history was silently rewritten",
    targetGreenBehavior:
      "the three V1 entrypoints and exact extraction, locator, and capture IDs remain callable and unchanged",
    falseRedCondition:
      "a V2 expectation is accidentally imposed on the historical V1 entrypoints",
  },
  AB: {
    testName: "V1 and V2 contract identities cannot alias",
    expectedCurrentFailure: "V2 ID registry and dispatch do not exist",
    failureMeaning: "new extraction behavior aliases historical identity",
    targetGreenBehavior:
      "the same source/revision/blob can coexist under distinct V1/V2 extraction, locator, capture, and Requirement identities",
    falseRedCondition:
      "the test compares different bytes or different source context rather than only contract versions",
  },
  "BG-1": {
    testName: "valid bytes parse through a binding-free technical surface",
    expectedCurrentFailure:
      "extractKecV2Technical is absent from the current extraction module",
    failureMeaning: "parsing capability still depends on production authority",
    targetGreenBehavior:
      "valid exact bytes parse with explicit technical inputs and no SourceBinding admission",
    falseRedCondition:
      "the synthetic PDF is invalid, pdfjs cannot load, or a required parser dependency is missing",
  },
  "BG-2": {
    testName: "technical extraction has no authority dependency",
    expectedCurrentFailure:
      "no V2 technical root exists from which to enforce the dependency graph",
    failureMeaning: "authority exclusion is absent or leaks into capability",
    targetGreenBehavior:
      "the V2 technical root and its transitive graph contain no admission, policy, judgement, Task96, receipt, snapshot-store, or equivalent callback capability",
    falseRedCondition:
      "the graph walker misses resolvable imports, rejects pdfjs/core dependencies, or fails on an unrelated file",
  },
  "BG-3": {
    testName: "technical parser output cannot construct a verified receipt",
    expectedCurrentFailure:
      "no V2 TechnicalExtractionResult surface exists to enforce the non-authority result boundary",
    failureMeaning: "the public parser can manufacture trusted state",
    targetGreenBehavior:
      "the V2 result contains technical data only and neither exports nor returns production writers, receipts, admissions, or authorized snapshots",
    falseRedCondition:
      "a harmless technical byte identity or diagnostic source coordinate is mistaken for authority",
  },
  "BG-4": {
    testName: "Task96 refuses binding before invoking the V2 core",
    expectedCurrentFailure:
      "the concrete trusted runtime enters the V1 extraction facade before its admission callback and has no pre-call V2 adapter",
    failureMeaning:
      "the production authorization gate is late, optional, or bypassable",
    targetGreenBehavior:
      "unadmitted, withdrawn, or contradictory state returns the exact refusal before any shared V2 core call or durable write",
    falseRedCondition:
      "temporary SQLite setup fails or an invalid PDF is used to manufacture an earlier failure",
  },
  "BG-5": {
    testName: "admitted Task96 execution selects the shared V2 core",
    expectedCurrentFailure: "the concrete Task96 V2 adapter is absent",
    failureMeaning: "the trusted path can fork extraction semantics",
    targetGreenBehavior:
      "after synthetic admission, Task96 invokes the same V2 technical core once with the owned bytes and selected contract",
    falseRedCondition:
      "the synthetic admission does not match the exact fixture bytes or any store escapes the test root",
  },
  "BG-6": {
    testName: "diagnostic and trusted V2 technical results are deterministic",
    expectedCurrentFailure:
      "there is no shared V2 result or trusted adapter to compare",
    failureMeaning: "authorization context changes parser semantics",
    targetGreenBehavior:
      "identical bytes, technical source context, contract, mapping registry, and limits produce identical technical output on both paths",
    falseRedCondition:
      "the two sides use different synthetic identities, revisions, bytes, contract, registry, or resource limits",
  },
  "BG-7": {
    testName: "diagnostic context is rejected by Task96 authority boundaries",
    expectedCurrentFailure:
      "Task96 accepts non-empty diag:* values as an established revision and can continue to persistence",
    failureMeaning:
      "a fake SourceRevision can leak into durable authority state",
    targetGreenBehavior:
      "Task96 rejects diagnostic context before admission, extraction, receipt, or snapshot operations",
    falseRedCondition:
      "the test treats a diagnostic result itself as persisted state or uses a production store",
  },
  "BG-8": {
    testName: "technical and binding failure families remain disjoint",
    expectedCurrentFailure:
      "the V1 facade exposes an untyped PDFJS failure rather than a closed V2 technical failure",
    failureMeaning: "parser defects and binding defects are conflated",
    targetGreenBehavior:
      "admitted invalid PDF bytes produce a typed technical failure while rejected valid bytes produce the exact BINDING_* refusal before parsing",
    falseRedCondition:
      "the invalid bytes were not admitted, the valid bytes were admitted, or either path uses non-temporary state",
  },
}) satisfies Readonly<Record<Task98R0Obligation, Task98R0Contract>>;

export const TASK98_V2_EXTRACTION_CONTRACT_ID =
  "kec:pdfjs-geometry-semantic-requirements:v2";
export const TASK98_V2_LOCATOR_SPACE = "kec:pdfjs-raw-text-item-spans:v2";
export const TASK98_V2_CAPTURE_CONTRACT_ID =
  "kec:pdfjs-explainable-structural-capture:v2";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(fixtureDirectory, "../../..");

export const task98Paths = Object.freeze({
  requirementExtraction: resolve(
    workspaceRoot,
    "packages/mcp-kec/src/knowledge/requirementExtraction.ts",
  ),
  mcpKecSource: resolve(workspaceRoot, "packages/mcp-kec/src"),
  mcpKecManifest: resolve(workspaceRoot, "packages/mcp-kec/package.json"),
  runtimeInternal: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/index.ts",
  ),
  runtimePublic: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/public.ts",
  ),
  trustedRuntime: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/trustedRuntime.ts",
  ),
});

export type Task98R0FailureCode =
  | "MISSING_V2_TECHNICAL_SURFACE"
  | "MISSING_V2_CONTRACT_IDENTITY"
  | "MISSING_TASK96_V2_ADAPTER"
  | "INVALID_SYNTHETIC_FIXTURE";

export class Task98R0ContractError extends Error {
  readonly code: Task98R0FailureCode;

  constructor(code: Task98R0FailureCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Task98R0ContractError";
    this.code = code;
  }
}

export type UnknownModule = Readonly<Record<string, unknown>>;

export async function loadModule(path: string): Promise<UnknownModule> {
  return import(
    /* @vite-ignore */ pathToFileURL(path).href
  ) as Promise<UnknownModule>;
}

export function requiredOperation(
  owner: UnknownModule,
  name: string,
  code: Task98R0FailureCode,
): (...args: readonly unknown[]) => unknown {
  const operation = owner[name];
  if (typeof operation !== "function") {
    throw new Task98R0ContractError(
      code,
      `required operation is absent: ${name}`,
    );
  }
  return operation.bind(owner) as (...args: readonly unknown[]) => unknown;
}

export function requiredV2TechnicalOperation(
  owner: UnknownModule,
): (...args: readonly unknown[]) => unknown {
  return requiredOperation(
    owner,
    "extractKecV2Technical",
    "MISSING_V2_TECHNICAL_SURFACE",
  );
}

export function sourceText(path: string): string {
  return readFileSync(path, "utf8");
}

export function syntheticSourceRevision(
  sourceIdentity = "synthetic:test-only:task98:source:A",
  revisionKey = "synthetic:test-only:task98:revision:1",
): SourceRevision {
  return Object.freeze({
    sourceIdentity: sourceIdentity as SourceIdentity,
    revisionKey: revisionKey as SourceRevisionKey,
  });
}

export const diagnosticSourceContext = Object.freeze({
  sourceIdentity:
    "diag:kec:task98:synthetic-test-only:nonproduction" as SourceIdentity,
  revisionKey:
    "diag:kec:task98:revision:synthetic-test-only:nonproduction" as SourceRevisionKey,
});

export function sourceBlobHash(bytes: Uint8Array): SourceBlobHash {
  return Object.freeze({
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
}

export type SyntheticAuthorityFixture = Readonly<{
  root: string;
  bytes: Uint8Array;
  sourceLocator: ExternalSourceLocator;
  sourceRevision: SourceRevision;
  sourceAdmissionDatabasePath: string;
  receiptDatabasePath: string;
  task93DatabasePath: string;
  cleanup: () => void;
}>;

export function assertPathUnderTemporaryRoot(root: string, path: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const withinRoot = relative(resolvedRoot, resolvedPath);
  const temporaryPrefix = `${resolve(tmpdir())}/`;
  if (
    !resolvedRoot.startsWith(temporaryPrefix) ||
    withinRoot === "" ||
    withinRoot.startsWith("..") ||
    isAbsolute(withinRoot) ||
    resolvedPath.includes(`${join("", ".volt-ai")}`)
  ) {
    throw new Task98R0ContractError(
      "INVALID_SYNTHETIC_FIXTURE",
      `path is not isolated under the test temporary root: ${resolvedPath}`,
    );
  }
}

export function createSyntheticAuthorityFixture(
  bytes = deterministicKoreanPdfBytes("합성 시험 설비는 보호하여야 한다"),
): SyntheticAuthorityFixture {
  const root = mkdtempSync(join(tmpdir(), "task98-r0-synthetic-authority-"));
  const sourceLocator = Object.freeze({
    scheme: "file",
    value: "source/synthetic-kec.pdf",
  }) satisfies ExternalSourceLocator;
  const sourcePath = join(root, sourceLocator.value);
  const sourceAdmissionDatabasePath = join(root, "stores/admission.sqlite");
  const receiptDatabasePath = join(root, "stores/receipt.sqlite");
  const task93DatabasePath = join(root, "stores/snapshot.sqlite");

  for (const path of [
    sourcePath,
    sourceAdmissionDatabasePath,
    receiptDatabasePath,
    task93DatabasePath,
  ]) {
    assertPathUnderTemporaryRoot(root, path);
  }
  mkdirSync(dirname(sourcePath), { recursive: true });
  mkdirSync(dirname(sourceAdmissionDatabasePath), { recursive: true });
  writeFileSync(sourcePath, bytes);

  return Object.freeze({
    root,
    bytes,
    sourceLocator,
    sourceRevision: syntheticSourceRevision(),
    sourceAdmissionDatabasePath,
    receiptDatabasePath,
    task93DatabasePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  });
}

export function technicalInput(
  bytes: Uint8Array,
  sourceContext: SourceRevision = diagnosticSourceContext,
) {
  return Object.freeze({
    exactBytes: bytes,
    sourceContext,
    extractionContract: TASK98_V2_EXTRACTION_CONTRACT_ID,
    mappingRegistry: Object.freeze({
      version: "task98:test-only:mapping:v1",
      digest: "0".repeat(64),
    }),
    resourceLimits: Object.freeze({
      maxPages: 4,
      maxTextItemsPerPage: 10_000,
    }),
  });
}

export function ownKeysDeep(value: unknown): readonly string[] {
  const keys = new Set<string>();
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const [key, member] of Object.entries(current)) {
      keys.add(key);
      pending.push(member);
    }
  }
  return [...keys].sort();
}
