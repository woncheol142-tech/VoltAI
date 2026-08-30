import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

export type Task95RedFailureCode =
  | "MISSING_POLICY_MODULE"
  | "MISSING_POLICY_TYPE"
  | "MISSING_POLICY_PORT"
  | "MISSING_POLICY_OPERATION"
  | "MISSING_POLICY_BEHAVIOR"
  | "MISSING_REGISTRY_CONTRACT"
  | "MISSING_JUDGEMENT_ADAPTER_EXPORT";

export class Task95RedContractError extends Error {
  readonly code: Task95RedFailureCode;

  constructor(code: Task95RedFailureCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Task95RedContractError";
    this.code = code;
  }
}

export type SchemeCapability = "YES" | "NO" | "UNKNOWN";

export type AssertionSchemeVersionFixture = Readonly<{
  schemeId: string;
  version: string;
  assertingAuthorityReference: string;
  identifierNamespace: string;
  canonicalization: Readonly<{
    ruleId: string;
    deterministic: boolean;
    equivalencePreservingTransformations: readonly string[];
  }>;
  bindingRule: string;
  equalitySemantics: string;
  differenceSemantics: string;
  aliasesPossible: SchemeCapability;
  renumberingPossible: SchemeCapability;
  identifierReusePossible: SchemeCapability;
  originIssuanceCapability: "YES" | "NO";
  semanticApproval: Readonly<{
    policyDecisionId: string;
    evidenceReference: string;
    approvingAuthorityRole: string;
    policyEpoch: string;
  }>;
}>;

export type BoundAssertionFixture = Readonly<{
  observationId: string;
  schemeId: string;
  schemeVersion: string;
  rawValue: string;
  canonicalValue: string;
  bindingStatus: "BOUND";
}>;

export type Task95PolicyContract = Readonly<{
  evaluateOriginAuthorization(input: unknown): unknown | Promise<unknown>;
  validateSchemeActivation(input: unknown): unknown | Promise<unknown>;
  replaceOriginSchemeVersion(input: unknown): unknown | Promise<unknown>;
  interpretHistoricalClaim(input: unknown): unknown | Promise<unknown>;
  validateAssertionRelations(input: unknown): unknown | Promise<unknown>;
  canonicalizeAssertionClaims(input: unknown): unknown | Promise<unknown>;
  validateAssertionClaim(input: unknown): unknown | Promise<unknown>;
  establishIdentityAtomically(input: unknown): unknown | Promise<unknown>;
  registerIssuanceRequest(input: unknown): unknown | Promise<unknown>;
  createEvidenceSnapshot(input: unknown): unknown | Promise<unknown>;
  createReplayApplicabilityKey(input: unknown): unknown | Promise<unknown>;
  resolveJudgement(input: unknown): unknown | Promise<unknown>;
  establishRevision(input: unknown): unknown | Promise<unknown>;
  evaluateCurrentKecCase(input: unknown): unknown | Promise<unknown>;
}>;

type PolicyOperation = keyof Task95PolicyContract;

const operationNames = [
  "evaluateOriginAuthorization",
  "validateSchemeActivation",
  "replaceOriginSchemeVersion",
  "interpretHistoricalClaim",
  "validateAssertionRelations",
  "canonicalizeAssertionClaims",
  "validateAssertionClaim",
  "establishIdentityAtomically",
  "registerIssuanceRequest",
  "createEvidenceSnapshot",
  "createReplayApplicabilityKey",
  "resolveJudgement",
  "establishRevision",
  "evaluateCurrentKecCase",
] as const satisfies readonly PolicyOperation[];

export type PolicyHarness = Readonly<{
  dependencies: Readonly<{
    opaqueIdentityIssuer: Readonly<{
      issue(): Promise<string>;
    }>;
    opaqueRevisionKeyIssuer: Readonly<{
      issue(sourceIdentity: string): Promise<string>;
    }>;
    assertionClaimRegistry: Readonly<{
      identityFor(canonicalClaim: string): string | undefined;
      associateAtomically(canonicalClaim: string, identity: string): string;
    }>;
    sourceRevisionRegistry: Readonly<{
      register(sourceIdentity: string, revisionKey: string): void;
    }>;
    issuanceRequestRegistry: Readonly<{
      outcomeFor(requestKey: string): unknown;
      register(requestKey: string, content: unknown, outcome: unknown): unknown;
    }>;
  }>;
  issuedIdentities: readonly string[];
  issuedRevisionKeys: readonly string[];
  registeredRevisions: readonly Readonly<{
    sourceIdentity: string;
    revisionKey: string;
  }>[];
}>;

export function createPolicyHarness(): PolicyHarness {
  const issuedIdentities: string[] = [];
  const issuedRevisionKeys: string[] = [];
  const registeredRevisions: Array<{
    sourceIdentity: string;
    revisionKey: string;
  }> = [];
  const claims = new Map<string, string>();
  const requests = new Map<string, { content: string; outcome: unknown }>();

  return {
    dependencies: {
      opaqueIdentityIssuer: {
        issue: async () => {
          const identity = `opaque-source-identity-${issuedIdentities.length + 1}`;
          issuedIdentities.push(identity);
          return identity;
        },
      },
      opaqueRevisionKeyIssuer: {
        issue: async () => {
          const revisionKey = `opaque-source-revision-${issuedRevisionKeys.length + 1}`;
          issuedRevisionKeys.push(revisionKey);
          return revisionKey;
        },
      },
      assertionClaimRegistry: {
        identityFor: (canonicalClaim) => claims.get(canonicalClaim),
        associateAtomically: (canonicalClaim, identity) => {
          const established = claims.get(canonicalClaim);
          if (established !== undefined) {
            return established;
          }
          claims.set(canonicalClaim, identity);
          return identity;
        },
      },
      sourceRevisionRegistry: {
        register: (sourceIdentity, revisionKey) => {
          registeredRevisions.push({ sourceIdentity, revisionKey });
        },
      },
      issuanceRequestRegistry: {
        outcomeFor: (requestKey) => requests.get(requestKey)?.outcome,
        register: (requestKey, content, outcome) => {
          const encoded = JSON.stringify(content);
          const established = requests.get(requestKey);
          if (established !== undefined) {
            if (established.content !== encoded) {
              return { kind: "ISSUANCE_REQUEST_COLLISION" };
            }
            return established.outcome;
          }
          requests.set(requestKey, { content: encoded, outcome });
          return outcome;
        },
      },
    },
    issuedIdentities,
    issuedRevisionKeys,
    registeredRevisions,
  };
}

function missingContract(
  code: "MISSING_POLICY_MODULE" | "MISSING_POLICY_OPERATION",
  detail: string,
): Task95PolicyContract {
  const contract = Object.fromEntries(
    operationNames.map((operation) => [
      operation,
      () => {
        throw new Task95RedContractError(code, `${operation}: ${detail}`);
      },
    ]),
  );
  return contract as unknown as Task95PolicyContract;
}

function bindContract(value: unknown): Task95PolicyContract {
  if (typeof value !== "object" || value === null) {
    return missingContract(
      "MISSING_POLICY_OPERATION",
      "createKecSourcePolicy did not return a policy contract",
    );
  }

  const candidate = value as Record<string, unknown>;
  const bound = Object.fromEntries(
    operationNames.map((operation) => {
      const implementation = candidate[operation];
      if (typeof implementation !== "function") {
        return [
          operation,
          () => {
            throw new Task95RedContractError(
              "MISSING_POLICY_OPERATION",
              operation,
            );
          },
        ];
      }
      return [operation, implementation.bind(value)];
    }),
  );
  return bound as Task95PolicyContract;
}

export async function loadPolicyUnderTest(
  dependencies: PolicyHarness["dependencies"],
): Promise<Task95PolicyContract> {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const entrypoint = resolve(packageRoot, "src/index.ts");
  if (!existsSync(entrypoint)) {
    return missingContract(
      "MISSING_POLICY_MODULE",
      "packages/kec-source-policy/src/index.ts is absent",
    );
  }

  const module = (await import(pathToFileURL(entrypoint).href)) as Record<
    string,
    unknown
  >;
  const factory = module.createKecSourcePolicy;
  if (typeof factory !== "function") {
    return missingContract(
      "MISSING_POLICY_OPERATION",
      "createKecSourcePolicy export is absent",
    );
  }

  return bindContract(await factory(dependencies));
}

export function validOriginScheme(
  overrides: Partial<AssertionSchemeVersionFixture> = {},
): AssertionSchemeVersionFixture {
  return {
    schemeId: "synthetic-kec-origin",
    version: "S1",
    assertingAuthorityReference: "synthetic-authority:alpha",
    identifierNamespace: "synthetic-kec-origin:v1",
    canonicalization: {
      ruleId: "identity-v1",
      deterministic: true,
      equivalencePreservingTransformations: [],
    },
    bindingRule: "synthetic-observation-field:asserted-id",
    equalitySemantics: "canonical values equal implies SAME_IDENTITY",
    differenceSemantics: "canonical values differ implies DIFFERENT_IDENTITY",
    aliasesPossible: "NO",
    renumberingPossible: "NO",
    identifierReusePossible: "NO",
    originIssuanceCapability: "YES",
    semanticApproval: {
      policyDecisionId: "policy-decision:synthetic-origin-s1",
      evidenceReference: "evidence:synthetic-origin-contract",
      approvingAuthorityRole: "KEC_SOURCE_POLICY_APPROVER",
      policyEpoch: "kec-policy-epoch:95-v4",
    },
    ...overrides,
  };
}

export function nonOriginScheme(): AssertionSchemeVersionFixture {
  return validOriginScheme({
    schemeId: "synthetic-kec-relation",
    identifierNamespace: "synthetic-kec-relation:v1",
    originIssuanceCapability: "NO",
  });
}

export const boundOriginAssertion: BoundAssertionFixture = Object.freeze({
  observationId: "observation:task95-fixed-1",
  schemeId: "synthetic-kec-origin",
  schemeVersion: "S1",
  rawValue: "SYN-0001",
  canonicalValue: "SYN-0001",
  bindingStatus: "BOUND",
});

export const validObservation = Object.freeze({
  observationId: "observation:task95-fixed-1",
  validity: "VALID_SOURCE_OBSERVATION",
  publisherMetadata: "non-authoritative-fixture-metadata",
});

export function automaticOriginInput(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    requestKey: "issuance-request:task95-fixed-1",
    immutableRequestContent: Object.freeze({
      observationId: validObservation.observationId,
      assertion: boundOriginAssertion,
    }),
    observation: validObservation,
    assertion: boundOriginAssertion,
    registeredSchemes: Object.freeze([validOriginScheme()]),
    activeAutomaticOriginSchemeVersions: Object.freeze([
      Object.freeze({ schemeId: "synthetic-kec-origin", version: "S1" }),
    ]),
    candidates: Object.freeze([]),
    relationAssessments: Object.freeze([]),
    existingClaimMapping: undefined,
    relationConflict: false,
    canonicalizationCollision: false,
    ...overrides,
  });
}

export const policyCaseId = "policy-case:task95-fixed-kec-source";
export const evidenceSnapshotE1 = Object.freeze({
  snapshotId: "evidence-snapshot:E1",
  members: Object.freeze(["evidence:ministry-observation"]),
  integrityDigest: "sha256:e1-integrity-only",
});
export const evidenceSnapshotE2 = Object.freeze({
  snapshotId: "evidence-snapshot:E2",
  members: Object.freeze([
    "evidence:ministry-observation",
    "evidence:later-policy-reference",
  ]),
  integrityDigest: "sha256:e2-integrity-only",
});
