export type {
  Acquisition,
  AdmissionAuthorityRef,
  AdmissionBasisRef,
  AdmissionEvent,
  AdmissionRecord,
  AdmissionRecordReference,
  ContentObservation,
  SourceBinding,
  SourceBindingKey,
  VerifyBindingSemanticResult,
} from "./types.js";
export { BindingRepository } from "./repository.js";

import type {
  Acquisition,
  AdmissionAuthorityRef,
  AdmissionBasisRef,
  AdmissionRecordReference,
  SourceBinding,
  VerifyBindingSemanticResult,
} from "./types.js";
import type { BindingRepository } from "./repository.js";
import type { SourceBlobHash, SourceRevision } from "@voltai/source-core";

export function admitBinding(
  repository: BindingRepository,
  binding: SourceBinding,
  authority: AdmissionAuthorityRef,
  basis: AdmissionBasisRef,
): AdmissionRecordReference | Promise<AdmissionRecordReference> {
  return repository.admitBinding(binding, authority, basis);
}

export function withdrawAdmission(
  repository: BindingRepository,
  reference: AdmissionRecordReference,
  authority: AdmissionAuthorityRef,
  basis: AdmissionBasisRef,
): AdmissionRecordReference | Promise<AdmissionRecordReference> {
  return repository.withdrawAdmission(reference, authority, basis);
}

export function verifyBinding(
  repository: BindingRepository,
  binding: SourceBinding,
): VerifyBindingSemanticResult | Promise<VerifyBindingSemanticResult> {
  return repository.verifyBinding(binding);
}

export function findBindingsByBlob(
  repository: BindingRepository,
  blobHash: SourceBlobHash,
): readonly SourceBinding[] | Promise<readonly SourceBinding[]> {
  return repository.findBindingsByBlob(blobHash);
}

export function findBindingsByRevision(
  repository: BindingRepository,
  sourceRevision: SourceRevision,
): readonly SourceBinding[] | Promise<readonly SourceBinding[]> {
  return repository.findBindingsByRevision(sourceRevision);
}

export function findAcquisitionsByBlob(
  repository: BindingRepository,
  blobHash: SourceBlobHash,
): readonly Acquisition[] | Promise<readonly Acquisition[]> {
  return repository.findAcquisitionsByBlob(blobHash);
}
