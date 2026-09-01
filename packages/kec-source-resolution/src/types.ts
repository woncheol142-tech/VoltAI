import type { SourceBlobHash, SourceRevision } from "@voltai/source-core";

export type ExternalSourceLocator = Readonly<{ scheme: string; value: string }>;
export type AcquisitionObservation = Readonly<{
  locator: ExternalSourceLocator;
  observedBlobHash: SourceBlobHash;
  observedByteLength: number;
}>;
export type RawIdentityAssertion = Readonly<{
  schemeId: string;
  schemeVersion: string;
  rawValue: string;
  bindingStatus: string;
  bindingEvidenceRef?: string;
}>;
export type RawRevisionAssertion = Readonly<{
  schemeId: string;
  schemeVersion: string;
  rawRevisionState: string;
  bindingStatus: string;
  bindingEvidenceRef?: string;
}>;
export type ObservedMetadata = Readonly<{ key: string; value: string }>;

export interface ObservedSourceCandidate {
  readonly observationId: string;
  readonly acquisition: AcquisitionObservation;
  readonly rawIdentityAssertions: readonly RawIdentityAssertion[];
  readonly rawRevisionAssertions: readonly RawRevisionAssertion[];
  readonly observedMetadata: readonly ObservedMetadata[];
}

export interface EstablishedSourceRevision {
  readonly sourceRevision: SourceRevision;
  readonly identityBasis: unknown;
  readonly revisionBasis: unknown;
  readonly resolutionRecordRef: string;
}

export type ResolutionQuestion = Readonly<{
  questionKey: string;
  applicabilityKey: string;
  policyCaseId: string;
  evidenceSnapshotId: string;
  candidateCoordinate: string;
  allowedDecisions: readonly string[];
}>;

export type Task97ResolutionOutcome =
  | Readonly<{
      kind: "IDENTITY_AND_REVISION_ESTABLISHED";
      established: EstablishedSourceRevision;
    }>
  | Readonly<{
      kind: "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED";
      sourceIdentity: string;
      identityBasis: unknown;
      revisionOutcome: string;
      reason: string;
    }>
  | Readonly<{
      kind: "POLICY_LOOKUP_REQUIRED";
      stage: "POLICY_CONFIGURATION" | "IDENTITY" | "REVISION";
      reason: string;
    }>
  | Readonly<{
      kind: "HUMAN_JUDGEMENT_REQUIRED";
      stage: "IDENTITY" | "REVISION";
      reason: string;
      question: ResolutionQuestion;
    }>
  | Readonly<{
      kind: "UNRESOLVED";
      stage: "IDENTITY" | "REVISION";
      reason: string;
    }>
  | Readonly<{
      kind: "POLICY_CONTRADICTION";
      stage: "POLICY_CONFIGURATION" | "IDENTITY" | "REVISION";
      reason: string;
    }>
  | Readonly<{ kind: "IDENTITY_ISSUANCE_CONFLICT"; reason: string }>
  | Readonly<{ kind: "REVISION_ESTABLISHMENT_CONFLICT"; reason: string }>;

export type ResolutionInstrumentation = Readonly<{
  issueIdentity?: (...args: readonly unknown[]) => unknown;
  issueRevision?: (...args: readonly unknown[]) => unknown;
  associateIdentity?: (...args: readonly unknown[]) => unknown;
  associateRevision?: (...args: readonly unknown[]) => unknown;
}>;
