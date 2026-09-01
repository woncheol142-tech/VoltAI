import {
  BindingRepository,
  verifyBinding,
  type Acquisition,
  type AdmissionAuthorityRef,
  type AdmissionBasisRef,
  type AdmissionEvent,
  type AdmissionRecordReference,
  type SourceBinding,
  type VerifyBindingSemanticResult,
} from "@voltai/source-admission";
import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "@voltai/source-core";
import { describe, expect, it } from "vitest";

const sourceRevision: SourceRevision = Object.freeze({
  sourceIdentity: "task96:final-gate:source" as SourceIdentity,
  revisionKey: "task96:final-gate:revision" as SourceRevisionKey,
});

const blobHash: SourceBlobHash = Object.freeze({
  algorithm: "sha-256",
  digest: "8".repeat(64),
});

const binding: SourceBinding = Object.freeze({ sourceRevision, blobHash });

function event(
  admissionSequence: number,
  eventKind: AdmissionEvent["eventKind"],
  withdrawsSequence?: number,
): AdmissionEvent {
  return Object.freeze({
    sourceIdentity: sourceRevision.sourceIdentity,
    revisionKey: sourceRevision.revisionKey,
    blobAlgorithm: blobHash.algorithm,
    blobDigest: blobHash.digest,
    admissionSequence,
    eventKind,
    authority: `task96:authority:${admissionSequence}`,
    basis: `task96:basis:${admissionSequence}`,
    ...(withdrawsSequence === undefined ? {} : { withdrawsSequence }),
  });
}

class ControlledHistoryRepository extends BindingRepository {
  constructor(private readonly events: readonly AdmissionEvent[]) {
    super();
  }

  admitBinding(
    _binding: SourceBinding,
    _authority: AdmissionAuthorityRef,
    _basis: AdmissionBasisRef,
  ): AdmissionRecordReference {
    void _binding;
    void _authority;
    void _basis;
    throw new Error("not used by this semantic fixture");
  }

  withdrawAdmission(
    _reference: AdmissionRecordReference,
    _authority: AdmissionAuthorityRef,
    _basis: AdmissionBasisRef,
  ): AdmissionRecordReference {
    void _reference;
    void _authority;
    void _basis;
    throw new Error("not used by this semantic fixture");
  }

  verifyBinding(_binding: SourceBinding): VerifyBindingSemanticResult {
    void _binding;
    return this.evaluateAdmissionEvents(this.events);
  }

  findBindingsByBlob(_blobHash: SourceBlobHash): readonly SourceBinding[] {
    void _blobHash;
    return [];
  }

  findBindingsByRevision(
    _sourceRevision: SourceRevision,
  ): readonly SourceBinding[] {
    void _sourceRevision;
    return [];
  }

  findAcquisitionsByBlob(_blobHash: SourceBlobHash): readonly Acquisition[] {
    void _blobHash;
    return [];
  }
}

function verdict(
  events: readonly AdmissionEvent[],
): VerifyBindingSemanticResult {
  return verifyBinding(new ControlledHistoryRepository(events), binding);
}

describe("Task96 Final Gate admission lifecycle remediation", () => {
  it("classifies WITHDRAW targeting a prior WITHDRAW as contradiction", () => {
    expect(
      verdict([
        event(1, "ADMIT"),
        event(2, "WITHDRAW", 1),
        event(3, "WITHDRAW", 2),
      ]),
    ).toEqual({ kind: "BINDING_CONTRADICTION" });
  });

  it("keeps one valid withdrawal of an ADMIT ordinarily withdrawn", () => {
    expect(verdict([event(1, "ADMIT"), event(2, "WITHDRAW", 1)]).kind).toBe(
      "BINDING_WITHDRAWN",
    );
  });

  it("keeps withdrawn A plus active B admitted", () => {
    expect(
      verdict([event(1, "ADMIT"), event(2, "WITHDRAW", 1), event(3, "ADMIT")])
        .kind,
    ).toBe("BINDING_ADMITTED");
  });

  it("does not treat multiple valid withdrawals as contradictory", () => {
    expect(
      verdict([
        event(1, "ADMIT"),
        event(2, "ADMIT"),
        event(3, "WITHDRAW", 1),
        event(4, "WITHDRAW", 2),
        event(5, "ADMIT"),
      ]).kind,
    ).toBe("BINDING_ADMITTED");
  });
});
