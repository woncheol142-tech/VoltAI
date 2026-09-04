import type { AdmissionRecordReference } from "@voltai/source-admission";
import type {
  ExternalSourceLocator,
  SourceBlobHash,
  SourceRevision,
} from "@voltai/source-core";

export const KEC_VERIFIED_RESULT_COMMITMENT_ALGORITHM = "sha-256" as const;
export const KEC_VERIFIED_RESULT_COMMITMENT_CODEC =
  "kec:verified-extraction-result:v1" as const;

export interface KecVerifiedExtractionResultCommitment {
  readonly algorithm: typeof KEC_VERIFIED_RESULT_COMMITMENT_ALGORITHM;
  readonly codec: typeof KEC_VERIFIED_RESULT_COMMITMENT_CODEC;
  readonly digest: string;
}

export interface KecDurableRequirement {
  readonly requirementId: string;
  readonly statement: string;
  readonly locatorsJson: string;
}

export interface KecDurableCaptureObservation {
  readonly kindOrdinal: number;
  readonly kind: string;
  readonly payloadJson: string;
}

export interface KecDurableVerifiedResult {
  readonly extractionContract: string;
  readonly locatorSpace: string;
  readonly requirements: readonly KecDurableRequirement[];
  readonly capture: Readonly<{
    state: "present";
    captureContract: string;
    observations: readonly KecDurableCaptureObservation[];
  }>;
}

export interface KecVerifiedExecutionCoordinates {
  readonly sourceIdentity: string;
  readonly revisionKey: string;
  readonly blobAlgorithm: "sha-256";
  readonly blobDigest: string;
  readonly extractionContract: string;
  readonly locatorSpace: string;
}

export interface KecVerifiedExecutionReceipt extends KecVerifiedExecutionCoordinates {
  readonly admissionSequence: number;
  readonly commitmentAlgorithm: "sha-256";
  readonly commitmentCodec: "kec:verified-extraction-result:v1";
  readonly commitmentDigest: string;
}

export interface VerifiedKecExtractionInput {
  readonly projectRoot: string;
  readonly sourceLocator: ExternalSourceLocator;
  readonly sourceRevision: SourceRevision;
}

export type RuntimeBindingVerdict =
  | Readonly<{
      kind: "BINDING_ADMITTED";
      effectiveAdmissionReferences: readonly AdmissionRecordReference[];
      authorizingAdmissionReference?: AdmissionRecordReference;
    }>
  | Readonly<{ kind: "BINDING_NOT_ADMITTED" }>
  | Readonly<{ kind: "BINDING_WITHDRAWN" }>
  | Readonly<{ kind: "BINDING_CONTRADICTION" }>;

export interface KecSourceRuntimeDependencies {
  readonly exactSourceBytes: Uint8Array;
  readonly verifier: {
    verifyObservedBinding(binding: {
      readonly sourceRevision: SourceRevision;
      readonly blobHash: SourceBlobHash;
    }): RuntimeBindingVerdict | Promise<RuntimeBindingVerdict>;
  };
  readonly task90: {
    extractExactBytes(
      bytes: Uint8Array,
      input: VerifiedKecExtractionInput,
    ): KecDurableVerifiedResult | Promise<KecDurableVerifiedResult>;
  };
  readonly receiptStore: {
    appendDerivedReceipt(
      value: KecVerifiedExecutionReceipt,
    ): void | Promise<void>;
    findVerifiedExecutions(
      query: KecVerifiedExecutionCoordinates,
    ):
      | readonly KecVerifiedExecutionReceipt[]
      | Promise<readonly KecVerifiedExecutionReceipt[]>;
  };
  readonly snapshotStore: {
    storeCapturedSnapshot(
      value: KecDurableVerifiedResult,
    ): void | Promise<void>;
    loadSnapshotWithCapture(
      query: KecVerifiedExecutionCoordinates,
    ): unknown | Promise<unknown>;
  };
}

export type VerifiedKecExtractionResult =
  | Readonly<{
      kind: "EXTRACTION_REFUSED";
      reason: "DIAGNOSTIC_CONTEXT_NOT_AUTHORITATIVE";
      realSourceObserved: false;
    }>
  | Readonly<{
      kind: "EXTRACTION_REFUSED";
      verdict: Exclude<RuntimeBindingVerdict["kind"], "BINDING_ADMITTED">;
      realSourceObserved: false;
    }>
  | Readonly<{
      kind: "VERIFIED_EXECUTION_COMPLETE";
      receipt: KecVerifiedExecutionReceipt;
      realSourceObserved: true;
    }>
  | Readonly<{
      kind: "VERIFIED_EXECUTION_INCOMPLETE";
      realSourceObserved: false;
    }>;
