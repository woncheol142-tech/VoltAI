import { createHash } from "node:crypto";

import type {
  KecSourceResolutionRuntime,
  ObservedSourceCandidate,
} from "@voltai/kec-source-resolution";
import {
  openKecSourceRuntime,
  type KecVerifiedExecutionCoordinates,
} from "@voltai/kec-source-runtime";
import { admitBinding, type SourceBinding } from "@voltai/source-admission";
import { SqliteBindingRepository } from "@voltai/source-admission-sqlite";
import type { SourceBlobHash, SourceRevision } from "@voltai/source-core";

type UnknownRecord = Readonly<Record<string, unknown>>;

type PipelineInstrumentation = Readonly<{
  admitBinding?: (...args: readonly unknown[]) => unknown;
  runVerifiedKecExtraction?: (...args: readonly unknown[]) => unknown;
}>;

const acquisitionQuestionKey = "kec.source.acquisition.content/v1";
const admissionAuthority = "kec:acquisition-admission-authority:v1";

function admissionBasis(values: readonly string[]): string {
  return values.map((value) => `${value.length}:${value}`).join("|");
}

function hash(bytes: Uint8Array): SourceBlobHash {
  return Object.freeze({
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
}

export class KecSourcePipeline {
  private closed = false;

  constructor(
    private readonly options: Readonly<{
      resolution: KecSourceResolutionRuntime;
      sourceAdmissionDatabasePath: string;
      receiptDatabasePath: string;
      task93DatabasePath: string;
      testInstrumentation?: PipelineInstrumentation;
    }>,
  ) {
    void options;
  }

  attestAcquisitionContent(
    input: Readonly<{
      sourceRevision: SourceRevision;
      blobHash: SourceBlobHash;
      locator: unknown;
      decision: string;
      actor: string;
    }>,
  ): UnknownRecord {
    this.assertOpen();
    if (
      input.decision !== "ADMIT_BINDING" ||
      typeof input.actor !== "string" ||
      input.actor.length === 0
    ) {
      return {
        kind: "ACQUISITION_ATTESTATION_REJECTED",
        questionKey: acquisitionQuestionKey,
      };
    }
    const recorded =
      this.options.resolution.recordAcquisitionAttestation(input);
    return {
      kind: "ACQUISITION_CONTENT_ATTESTED",
      questionKey: acquisitionQuestionKey,
      basis: admissionBasis([
        "kec:admission-basis:v1",
        String(recorded.recordId),
        String(recorded.evidenceSnapshotId),
      ]),
      judgementRecordId: recorded.recordId,
    };
  }

  async runPreBoundKecExtraction(
    input: Readonly<{
      candidate: ObservedSourceCandidate;
      bytes: Uint8Array;
      projectRoot: string;
    }>,
  ): Promise<UnknownRecord> {
    this.assertOpen();
    const resolution =
      (await this.options.resolution.resolveSourceIdentityAndRevision(
        input.candidate,
      )) as unknown as UnknownRecord;
    if (resolution.kind !== "IDENTITY_AND_REVISION_ESTABLISHED")
      return { kind: "RESOLUTION_INCOMPLETE", resolution };
    const established = resolution.established as UnknownRecord;
    const sourceRevision = established.sourceRevision as SourceRevision;
    const actualHash = hash(input.bytes);
    const observedHash = input.candidate.acquisition.observedBlobHash;
    if (
      actualHash.algorithm !== observedHash.algorithm ||
      actualHash.digest !== observedHash.digest
    ) {
      return {
        kind: "BINDING_NOT_ESTABLISHED",
        reason: "OBSERVED_BYTES_HASH_MISMATCH",
      };
    }
    const attestation = this.options.resolution.replayAcquisitionAttestation({
      sourceRevision,
      blobHash: actualHash,
      locator: input.candidate.acquisition.locator,
    });
    if (
      attestation.kind !== "SINGLE_ACTIVE_JUDGEMENT" ||
      attestation.decision !== "ADMIT_BINDING" ||
      typeof attestation.recordId !== "string"
    )
      return {
        kind: "BINDING_NOT_ESTABLISHED",
        reason: "ACQUISITION_ATTESTATION_ABSENT",
      };
    const basis = admissionBasis([
      "kec:admission-basis:v1",
      String(established.resolutionRecordRef),
      String(attestation.evidenceSnapshotId),
      `acquisition:${input.candidate.observationId}`,
      attestation.recordId,
    ]);
    const binding: SourceBinding = Object.freeze({
      sourceRevision,
      blobHash: actualHash,
    });
    const repository = new SqliteBindingRepository(
      this.options.sourceAdmissionDatabasePath,
    );
    try {
      await admitBinding(repository, binding, admissionAuthority, basis);
    } finally {
      repository.close();
    }
    this.options.testInstrumentation?.admitBinding?.(
      binding,
      admissionAuthority,
      basis,
    );
    const task96Input = Object.freeze({
      projectRoot: input.projectRoot,
      sourceLocator: input.candidate.acquisition.locator,
      sourceRevision,
    });
    this.options.testInstrumentation?.runVerifiedKecExtraction?.(
      task96Input,
      input.bytes,
    );
    const runtime = await openKecSourceRuntime({
      sourceAdmissionDatabasePath: this.options.sourceAdmissionDatabasePath,
      receiptDatabasePath: this.options.receiptDatabasePath,
      task93DatabasePath: this.options.task93DatabasePath,
    });
    try {
      return await runtime.runVerifiedKecExtraction(task96Input);
    } finally {
      runtime.close();
    }
  }

  probeReadiness(): UnknownRecord {
    const readiness = this.options.resolution.probeConfigurationReadiness();
    return {
      task97CodeComplete: true,
      bootstrapConfigured: readiness.bootstrapConfigured,
      realProbeReady: readiness.realProbeReady,
      bootstrapClassification: "PROBE_SETUP",
    };
  }

  async loadVerifiedExecution(
    input: KecVerifiedExecutionCoordinates,
  ): Promise<UnknownRecord> {
    const runtime = await openKecSourceRuntime({
      sourceAdmissionDatabasePath: this.options.sourceAdmissionDatabasePath,
      receiptDatabasePath: this.options.receiptDatabasePath,
      task93DatabasePath: this.options.task93DatabasePath,
    });
    try {
      return (await runtime.loadVerifiedExecution(input)) as UnknownRecord;
    } finally {
      runtime.close();
    }
  }

  async countVerifiedExecutionReceipts(): Promise<number> {
    const runtime = await openKecSourceRuntime({
      sourceAdmissionDatabasePath: this.options.sourceAdmissionDatabasePath,
      receiptDatabasePath: this.options.receiptDatabasePath,
      task93DatabasePath: this.options.task93DatabasePath,
    });
    try {
      return (await runtime.findVerifiedExecutions()).length;
    } finally {
      runtime.close();
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("source pipeline is closed");
  }
}

export function openKecSourcePipeline(
  input: ConstructorParameters<typeof KecSourcePipeline>[0],
): KecSourcePipeline {
  return new KecSourcePipeline(input);
}
