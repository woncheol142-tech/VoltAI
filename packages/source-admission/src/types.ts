import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "@voltai/source-core";

export type AdmissionAuthorityRef = string;
export type AdmissionBasisRef = string;

export interface SourceBinding {
  readonly sourceRevision: SourceRevision;
  readonly blobHash: SourceBlobHash;
}

export interface SourceBindingKey {
  readonly sourceIdentity: SourceIdentity;
  readonly revisionKey: SourceRevisionKey;
  readonly blobAlgorithm: "sha-256";
  readonly blobDigest: string;
}

export interface AdmissionRecordReference extends SourceBindingKey {
  readonly admissionSequence: number;
}

export interface AdmissionEvent extends AdmissionRecordReference {
  readonly eventKind: "ADMIT" | "WITHDRAW";
  readonly authority: AdmissionAuthorityRef;
  readonly basis: AdmissionBasisRef;
  readonly withdrawsSequence?: number;
}

export interface AdmissionRecord extends AdmissionEvent {
  readonly reference: AdmissionRecordReference;
}

export interface Acquisition {
  readonly binding: SourceBinding;
  readonly authority: AdmissionAuthorityRef;
  readonly basis: AdmissionBasisRef;
}

export interface ContentObservation {
  readonly binding: SourceBinding;
  readonly authority: AdmissionAuthorityRef;
  readonly basis: AdmissionBasisRef;
}

export type VerifyBindingSemanticResult =
  | Readonly<{
      kind: "BINDING_ADMITTED";
      effectiveAdmissionReferences: readonly AdmissionRecordReference[];
      authorizingAdmissionReference: AdmissionRecordReference;
      effectiveAdmissions: readonly AdmissionEvent[];
    }>
  | Readonly<{ kind: "BINDING_NOT_ADMITTED" }>
  | Readonly<{
      kind: "BINDING_WITHDRAWN";
      admissionReferences: readonly AdmissionRecordReference[];
    }>
  | Readonly<{ kind: "BINDING_CONTRADICTION" }>;
