import type { SourceIdentity, SourceRevisionKey } from "@voltai/source-core";

declare const evidenceSnapshotIdBrand: unique symbol;
declare const issuanceRequestKeyBrand: unique symbol;
declare const policyCaseIdBrand: unique symbol;
declare const policyReplayApplicabilityKeyBrand: unique symbol;

export type EvidenceSnapshotId = string & {
  readonly [evidenceSnapshotIdBrand]: true;
};

export type IssuanceRequestKey = string & {
  readonly [issuanceRequestKeyBrand]: true;
};

export type PolicyCaseId = string & {
  readonly [policyCaseIdBrand]: true;
};

export type PolicyReplayApplicabilityKey = string & {
  readonly [policyReplayApplicabilityKeyBrand]: true;
};

export type IdentityRelation =
  | "SAME_IDENTITY"
  | "DIFFERENT_IDENTITY"
  | "UNKNOWN_RELATIONSHIP"
  | "NOT_APPLICABLE";

export type SchemeCapability = "YES" | "NO" | "UNKNOWN";

export type AssertionCanonicalizationRule = Readonly<{
  ruleId: string;
  deterministic: boolean;
  equivalencePreservingTransformations: readonly string[];
}>;

export type AssertionSchemeVersion = Readonly<{
  schemeId: string;
  version: string;
  assertingAuthorityReference: string;
  identifierNamespace: string;
  canonicalization: AssertionCanonicalizationRule;
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

export type SourceRevisionAssertionScheme = Readonly<{
  kind: "SOURCE_REVISION_ASSERTION_SCHEME";
  schemeId: string;
  schemeVersion: string;
  assertingAuthorityReference: string;
  revisionStateNamespace: string;
}>;

export type BoundIdentityAssertion = Readonly<{
  observationId: string;
  schemeId: string;
  schemeVersion: string;
  rawValue: string;
  canonicalValue: string;
  bindingStatus: "BOUND";
}>;

export type EvidenceSnapshot = Readonly<{
  snapshotId: EvidenceSnapshotId;
  members: readonly string[];
  integrityDigest?: string;
}>;

export type IdentityEstablishmentOutcome =
  | Readonly<{
      kind: "AUTO_ESTABLISH_NEW_IDENTITY";
      sourceIdentity: SourceIdentity;
      canonicalAssertionClaim: Readonly<{
        schemeId: string;
        schemeVersion: string;
        canonicalValue: string;
      }>;
    }>
  | Readonly<{
      kind: "REUSE_ESTABLISHED_IDENTITY";
      sourceIdentity: SourceIdentity;
    }>
  | Readonly<{
      kind: "NOT_ESTABLISHED";
      reason: string;
    }>;

export interface AssertionClaimRegistry {
  identityFor(canonicalClaim: string): string | undefined;
  associateAtomically(canonicalClaim: string, identity: string): string;
}

export interface IssuanceRequestRegistry {
  outcomeFor(requestKey: string): unknown;
  register(requestKey: string, content: unknown, outcome: unknown): unknown;
}

export interface OpaqueSourceIdentityIssuer {
  issue(): Promise<SourceIdentity>;
}

export interface OpaqueSourceRevisionKeyIssuer {
  issue(sourceIdentity: SourceIdentity): Promise<SourceRevisionKey>;
}

export interface SourceRevisionRegistry {
  register(
    sourceIdentity: SourceIdentity,
    revisionKey: SourceRevisionKey,
  ): void | Promise<void>;
}

export interface JudgementEscalationPort {
  resolvePolicyQuestion(
    input: Readonly<{
      policyCaseId: PolicyCaseId;
      evidenceSnapshotId: EvidenceSnapshotId;
      questionKey: string;
    }>,
  ): Promise<unknown>;
}

export interface ReplayApplicabilityKeyFactory {
  create(
    input: Readonly<{
      questionKey: string;
      subject: PolicyCaseId;
      context: Readonly<{
        evidenceSnapshotId: EvidenceSnapshotId;
        candidateCoordinate?: string;
      }>;
      policyEpoch: string;
    }>,
  ): PolicyReplayApplicabilityKey;
}

export type KecSourcePolicyDependencies = Readonly<{
  opaqueIdentityIssuer: OpaqueSourceIdentityIssuer;
  assertionClaimRegistry: AssertionClaimRegistry;
  issuanceRequestRegistry: IssuanceRequestRegistry;
  opaqueRevisionKeyIssuer?: OpaqueSourceRevisionKeyIssuer;
  sourceRevisionRegistry?: SourceRevisionRegistry;
  judgementEscalation?: JudgementEscalationPort;
}>;

export type PolicyOperationInput = Readonly<Record<string, unknown>>;
export type PolicyOperationResult = unknown | Promise<unknown>;

export interface SourceIdentityPolicy {
  evaluateOriginAuthorization(
    input: PolicyOperationInput,
  ): PolicyOperationResult;
  validateSchemeActivation(input: PolicyOperationInput): PolicyOperationResult;
  replaceOriginSchemeVersion(
    input: PolicyOperationInput,
  ): PolicyOperationResult;
  interpretHistoricalClaim(input: PolicyOperationInput): PolicyOperationResult;
  validateAssertionRelations(
    input: PolicyOperationInput,
  ): PolicyOperationResult;
  canonicalizeAssertionClaims(
    input: PolicyOperationInput,
  ): PolicyOperationResult;
  validateAssertionClaim(input: PolicyOperationInput): PolicyOperationResult;
  establishIdentityAtomically(
    input: PolicyOperationInput,
  ): PolicyOperationResult;
  registerIssuanceRequest(input: PolicyOperationInput): PolicyOperationResult;
  createEvidenceSnapshot(input: PolicyOperationInput): PolicyOperationResult;
  createReplayApplicabilityKey(
    input: PolicyOperationInput,
  ): PolicyOperationResult;
  resolveJudgement(input: PolicyOperationInput): PolicyOperationResult;
  establishRevision(input: PolicyOperationInput): PolicyOperationResult;
  evaluateCurrentKecCase(input: PolicyOperationInput): PolicyOperationResult;
}
