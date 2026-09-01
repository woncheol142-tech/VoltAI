import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

export type Task97RedFailureCode =
  | "MISSING_KEC_SOURCE_POLICY_SQLITE"
  | "MISSING_KEC_SOURCE_POLICY_JUDGEMENT"
  | "MISSING_KEC_SOURCE_RESOLUTION"
  | "MISSING_KEC_SOURCE_PIPELINE"
  | "MISSING_TASK97_CONTRACT";

export class Task97RedContractError extends Error {
  readonly code: Task97RedFailureCode;

  constructor(code: Task97RedFailureCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Task97RedContractError";
    this.code = code;
  }
}

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(fixtureDirectory, "../../..");
export const task97Root = resolve(workspaceRoot, "tests/task97");

export const task97Paths = Object.freeze({
  policySqliteRoot: resolve(workspaceRoot, "packages/kec-source-policy-sqlite"),
  policySqliteEntrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-policy-sqlite/src/index.ts",
  ),
  policyJudgementRoot: resolve(
    workspaceRoot,
    "packages/kec-source-policy-judgement",
  ),
  policyJudgementEntrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-policy-judgement/src/index.ts",
  ),
  resolutionRoot: resolve(workspaceRoot, "packages/kec-source-resolution"),
  resolutionEntrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-resolution/src/index.ts",
  ),
  pipelineRoot: resolve(workspaceRoot, "packages/kec-source-pipeline"),
  pipelineEntrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-pipeline/src/index.ts",
  ),
  task95Entrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-policy/src/index.ts",
  ),
  sourceAdmissionEntrypoint: resolve(
    workspaceRoot,
    "packages/source-admission/src/index.ts",
  ),
  sourceAdmissionSqliteEntrypoint: resolve(
    workspaceRoot,
    "packages/source-admission-sqlite/src/index.ts",
  ),
  kecSourceRuntimeEntrypoint: resolve(
    workspaceRoot,
    "packages/kec-source-runtime/src/index.ts",
  ),
});

export const EXPECTED_TASK97_FAMILY_LABELS = Object.freeze([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "AA",
  "AB",
  "AC",
  "AD",
  "AE",
  "AF",
  "AG",
  "AH",
] as const);

export type Task97Family = (typeof EXPECTED_TASK97_FAMILY_LABELS)[number];
export type FailureCategory =
  "EXPECTED_RED" | "PREREQUISITE_PASS" | "STRUCTURAL_RED";

type FamilyContract = Readonly<{
  architectureSection: string;
  expectedFailureCategory: FailureCategory;
  tests: readonly Readonly<{ file: string; id: string; contract: string }>[];
}>;

export const TASK97_RED_FAMILY_MAP = Object.freeze({
  A: family("§20 A / §7", "resolutionIdentity.red.test.ts", [
    [
      "unresolved-does-not-mint",
      "unresolved candidates mint or advance nothing",
    ],
  ]),
  B: family("§20 B / §2.2", "resolutionIdentity.red.test.ts", [
    ["blob-firewall", "equal blobs do not imply equal identities"],
  ]),
  C: family("§20 C, C′ / §13.1", "resolutionIdentity.red.test.ts", [
    ["locator-firewall", "equal locators do not imply equal identities"],
    [
      "no-blob-locator-identity-index",
      "no identity lookup is keyed by blob or locator",
    ],
  ]),
  D: family("§20 D / §11.4", "resolutionIdentity.red.test.ts", [
    ["exact-claim-hit", "an exact registered claim reuses without minting"],
  ]),
  E: family("§20 E / §11.1", "resolutionIdentity.red.test.ts", [
    ["opaque-authorized-mint", "only authorization mints an opaque identity"],
  ]),
  F: family("§20 F / §13.4", "resolutionIdentity.red.test.ts", [
    ["identity-concurrency", "same-claim concurrency converges durably"],
  ]),
  G: family("§20 G / §13.2", "resolutionIdentity.red.test.ts", [
    ["claim-collision", "claim collisions fail closed without rewriting"],
  ]),
  H: family("§20 H / §11.4", "judgementReplay.red.test.ts", [
    ["same-identity-scope", "SAME_IDENTITY reuses only its scoped identity"],
  ]),
  I: family("§20 I / §11.4", "judgementReplay.red.test.ts", [
    [
      "different-is-not-mint",
      "DIFFERENT_IDENTITY prevents reuse and does not mint",
    ],
  ]),
  J: family("§20 J / §10.5", "judgementReplay.red.test.ts", [
    ["unknown-is-not-decision", "UNKNOWN_RELATIONSHIP establishes nothing"],
  ]),
  K: family("§20 K, K′ / §10.4", "judgementReplay.red.test.ts", [
    ["conflicting-heads", "conflicting active judgements fail closed"],
    ["judgement-scope-violation", "a decision cannot cross question scope"],
  ]),
  L: family("§20 L / §10.4", "judgementReplay.red.test.ts", [
    ["ledger-lifecycle", "supersession and withdrawn heads follow V2.2"],
  ]),
  M: family("§20 M / §14", "revisionPersistence.red.test.ts", [
    [
      "historical-scheme-stability",
      "S1 history is not recanonicalized under S2",
    ],
  ]),
  N: family("§20 N / §14", "revisionPersistence.red.test.ts", [
    ["cross-version-fail-closed", "non-total correspondence fails closed"],
  ]),
  O: family("§20 O, O′ / §12", "revisionPersistence.red.test.ts", [
    [
      "revision-evidence-firewall",
      "incidental metadata cannot establish revision",
    ],
    [
      "revision-scheme-authority",
      "caller-forged revision schemes are rejected",
    ],
  ]),
  P: family("§20 P, P′ / §12", "revisionPersistence.red.test.ts", [
    ["revision-unknown", "unknown revision relation invents no key"],
    ["revision-concurrency", "same revision claim converges durably"],
  ]),
  Q: family("§20 Q / §13.3", "revisionPersistence.red.test.ts", [
    ["resolution-idempotency", "retries reuse identity and revision"],
  ]),
  R: family("§20 R / §13.1", "revisionPersistence.red.test.ts", [
    ["durable-reload", "established revisions reload after restart"],
  ]),
  S: family("§20 S / §16.4", "pipelineBoundary.red.test.ts", [
    [
      "revision-is-not-admission",
      "resolution has no implicit admission side effect",
    ],
  ]),
  T: family("§20 T / §16.1", "pipelineBoundary.red.test.ts", [
    [
      "handoff-has-no-blob",
      "the resolution handoff cannot construct a binding",
    ],
  ]),
  U: family("§20 U / §17", "pipelineBoundary.red.test.ts", [
    [
      "unresolved-stops-pipeline",
      "incomplete resolution reaches no Task96 operation",
    ],
  ]),
  V: family("§20 V / §6.1, §10.1", "pipelineBoundary.red.test.ts", [
    [
      "authority-and-citability-firewall",
      "input and questions carry no trust or citability",
    ],
  ]),
  W: family("§20 W / §8", "pipelineBoundary.red.test.ts", [
    [
      "zero-kec-auto-origin",
      "fresh production configuration activates no KEC scheme",
    ],
  ]),
  X: family(
    "§20 X / §2.2",
    "pipelineBoundary.red.test.ts",
    [["case4-many-to-many", "one blob remains admissible for two revisions"]],
    "PREREQUISITE_PASS",
  ),
  Y: family("§20 Y / §19.2", "revisionPersistence.red.test.ts", [
    [
      "infrastructure-is-not-domain",
      "store and ledger failures are thrown typed failures",
    ],
  ]),
  Z: family("§20 Z / §21", "judgementReplay.red.test.ts", [
    ["explicit-first-bootstrap", "B2 mints once and never generalizes"],
  ]),
  AA: family("§20 AA / §11.3", "judgementReplay.red.test.ts", [
    [
      "p1-authenticity",
      "authoritative judgement is reloaded and applicability recomputed",
    ],
  ]),
  AB: family("§20 AB / §18.1", "pipelineBoundary.red.test.ts", [
    [
      "trusted-principal-surface",
      "ordinary callers cannot inject authorities or policy",
    ],
  ]),
  AC: family("§20 AC / §15", "pipelineBoundary.red.test.ts", [
    [
      "package-direction",
      "four-package ownership and dependency direction hold",
    ],
  ]),
  AD: family("§20 AD / §16.3", "pipelineBoundary.red.test.ts", [
    [
      "acquisition-attestation",
      "only exact acquisition attestation can basis admission",
    ],
  ]),
  AE: family("§20 AE / §6.1", "judgementReplay.red.test.ts", [
    ["metadata-not-authority", "metadata enters no authorizing coordinate"],
  ]),
  AF: family("§20 AF / §7", "resolutionIdentity.red.test.ts", [
    [
      "registry-absence",
      "registry miss remains policy lookup and preserves observation",
    ],
  ]),
  AG: family("§20 AG / §17", "pipelineBoundary.red.test.ts", [
    [
      "no-late-blessing",
      "legacy Task93 data requires a fresh verified receipt",
    ],
  ]),
  AH: family("§20 AH / §9", "pipelineBoundary.red.test.ts", [
    ["atomic-sealed-epoch", "activation is atomic and sealed epochs immutable"],
  ]),
} satisfies Record<Task97Family, FamilyContract>);

function family(
  architectureSection: string,
  file: string,
  tests: readonly (readonly [id: string, contract: string])[],
  expectedFailureCategory: FailureCategory = "EXPECTED_RED",
): FamilyContract {
  return Object.freeze({
    architectureSection,
    expectedFailureCategory,
    tests: Object.freeze(
      tests.map(([id, contract]) => Object.freeze({ file, id, contract })),
    ),
  });
}

export function typescriptFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory()
      ? typescriptFiles(path)
      : extname(entry.name) === ".ts"
        ? [path]
        : [];
  });
}

export function requiredProductionSources(
  root: string,
  code: Task97RedFailureCode,
): readonly string[] {
  const files = typescriptFiles(resolve(root, "src"));
  if (files.length === 0) {
    throw new Task97RedContractError(
      code,
      `production surface is absent: ${root}`,
    );
  }
  return files;
}

export function productionText(
  root: string,
  code: Task97RedFailureCode,
): string {
  return requiredProductionSources(root, code)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

export async function loadFutureModule(
  path: string,
  code: Task97RedFailureCode,
): Promise<Readonly<Record<string, unknown>>> {
  if (!existsSync(path)) {
    throw new Task97RedContractError(code, `entrypoint is absent: ${path}`);
  }
  return import(/* @vite-ignore */ pathToFileURL(path).href) as Promise<
    Readonly<Record<string, unknown>>
  >;
}

export function requiredFunction(
  owner: Readonly<Record<string, unknown>>,
  name: string,
): (...args: readonly unknown[]) => unknown {
  const value = owner[name];
  if (typeof value !== "function") {
    throw new Task97RedContractError(
      "MISSING_TASK97_CONTRACT",
      `required operation is absent: ${name}`,
    );
  }
  return value.bind(owner) as (...args: readonly unknown[]) => unknown;
}

export async function invoke(
  operation: (...args: readonly unknown[]) => unknown,
  ...args: readonly unknown[]
): Promise<unknown> {
  return operation(...args);
}
