import type { SourceBlobHash, SourceRevision } from "@voltai/source-core";

import type {
  Acquisition,
  AdmissionAuthorityRef,
  AdmissionBasisRef,
  AdmissionEvent,
  AdmissionRecordReference,
  SourceBinding,
  SourceBindingKey,
  VerifyBindingSemanticResult,
} from "./types.js";

const lowerHexSha256 = /^[0-9a-f]{64}$/u;

function nonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export abstract class BindingRepository {
  abstract admitBinding(
    binding: SourceBinding,
    authority: AdmissionAuthorityRef,
    basis: AdmissionBasisRef,
  ): AdmissionRecordReference | Promise<AdmissionRecordReference>;

  abstract withdrawAdmission(
    reference: AdmissionRecordReference,
    authority: AdmissionAuthorityRef,
    basis: AdmissionBasisRef,
  ): AdmissionRecordReference | Promise<AdmissionRecordReference>;

  abstract verifyBinding(
    binding: SourceBinding,
  ): VerifyBindingSemanticResult | Promise<VerifyBindingSemanticResult>;

  abstract findBindingsByBlob(
    blobHash: SourceBlobHash,
  ): readonly SourceBinding[] | Promise<readonly SourceBinding[]>;

  abstract findBindingsByRevision(
    sourceRevision: SourceRevision,
  ): readonly SourceBinding[] | Promise<readonly SourceBinding[]>;

  abstract findAcquisitionsByBlob(
    blobHash: SourceBlobHash,
  ): readonly Acquisition[] | Promise<readonly Acquisition[]>;

  protected validateSourceBinding(binding: SourceBinding): void {
    if (typeof binding !== "object" || binding === null) {
      throw new TypeError("binding must be an object");
    }
    if (
      typeof binding.sourceRevision !== "object" ||
      binding.sourceRevision === null
    ) {
      throw new TypeError("sourceRevision must be established");
    }
    nonEmptyString(
      binding.sourceRevision.sourceIdentity,
      "sourceRevision.sourceIdentity",
    );
    nonEmptyString(
      binding.sourceRevision.revisionKey,
      "sourceRevision.revisionKey",
    );
    if (typeof binding.blobHash !== "object" || binding.blobHash === null) {
      throw new TypeError("blobHash must be an object");
    }
    if (binding.blobHash.algorithm !== "sha-256") {
      throw new TypeError("blobHash.algorithm must be sha-256");
    }
    if (!lowerHexSha256.test(binding.blobHash.digest)) {
      throw new TypeError("blobHash.digest must be lowercase sha-256 hex");
    }
  }

  protected sourceBindingKey(binding: SourceBinding): SourceBindingKey {
    this.validateSourceBinding(binding);
    return Object.freeze({
      sourceIdentity: binding.sourceRevision.sourceIdentity,
      revisionKey: binding.sourceRevision.revisionKey,
      blobAlgorithm: binding.blobHash.algorithm,
      blobDigest: binding.blobHash.digest,
    });
  }

  protected admissionRecordReference(
    event: AdmissionEvent,
  ): AdmissionRecordReference {
    return Object.freeze({
      sourceIdentity: event.sourceIdentity,
      revisionKey: event.revisionKey,
      blobAlgorithm: event.blobAlgorithm,
      blobDigest: event.blobDigest,
      admissionSequence: event.admissionSequence,
    });
  }

  protected evaluateAdmissionEvents(
    events: readonly AdmissionEvent[],
  ): VerifyBindingSemanticResult {
    const admissions = new Map<number, AdmissionEvent>();
    const withdrawn = new Set<number>();
    let contradiction = false;

    for (const event of events) {
      if (
        !Number.isSafeInteger(event.admissionSequence) ||
        event.admissionSequence <= 0 ||
        admissions.has(event.admissionSequence)
      ) {
        contradiction = true;
        continue;
      }
      if (event.eventKind === "ADMIT") {
        if (event.withdrawsSequence !== undefined) contradiction = true;
        admissions.set(event.admissionSequence, event);
        continue;
      }
      const target = event.withdrawsSequence;
      const targetEvent =
        target === undefined ? undefined : admissions.get(target);
      if (
        target === undefined ||
        target >= event.admissionSequence ||
        targetEvent?.eventKind !== "ADMIT" ||
        withdrawn.has(target)
      ) {
        contradiction = true;
        continue;
      }
      withdrawn.add(target);
      admissions.set(event.admissionSequence, event);
    }

    if (contradiction) {
      return Object.freeze({ kind: "BINDING_CONTRADICTION" });
    }
    const admitted = [...admissions.values()].filter(
      (event) => event.eventKind === "ADMIT",
    );
    if (admitted.length === 0) {
      return Object.freeze({ kind: "BINDING_NOT_ADMITTED" });
    }
    const effective = admitted.filter(
      (event) => !withdrawn.has(event.admissionSequence),
    );
    if (effective.length === 0) {
      return Object.freeze({
        kind: "BINDING_WITHDRAWN",
        admissionReferences: Object.freeze(
          admitted.map((event) => this.admissionRecordReference(event)),
        ),
      });
    }
    effective.sort(
      (left, right) => left.admissionSequence - right.admissionSequence,
    );
    const references = Object.freeze(
      effective.map((event) => this.admissionRecordReference(event)),
    );
    return Object.freeze({
      kind: "BINDING_ADMITTED",
      effectiveAdmissionReferences: references,
      authorizingAdmissionReference: references[0]!,
      effectiveAdmissions: Object.freeze(effective),
    });
  }
}
