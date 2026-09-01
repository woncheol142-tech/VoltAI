import type {
  AdmissionRecordReference,
  VerifyBindingSemanticResult,
} from "@voltai/source-admission";
import { SqliteBindingRepository } from "@voltai/source-admission-sqlite";

import { SqliteVerifiedExecutionReceiptStore } from "./internal/receiptStore.js";
import { computeKecVerifiedExtractionResultCommitment } from "./internal/resultCommitment.js";
import {
  Task93Bridge,
  type CapturedSnapshot,
  type Task93Load,
} from "./internal/task93Bridge.js";
import type {
  KecVerifiedExecutionCoordinates,
  KecVerifiedExecutionReceipt,
  RuntimeBindingVerdict,
  VerifiedKecExtractionInput,
  VerifiedKecExtractionResult,
} from "./types.js";

export interface KecSourceRuntimeOpenOptions {
  readonly sourceAdmissionDatabasePath: string;
  readonly receiptDatabasePath: string;
  readonly task93DatabasePath: string;
}

export interface KecSourceRuntime {
  runVerifiedKecExtraction(
    input: VerifiedKecExtractionInput,
  ): Promise<VerifiedKecExtractionResult>;
  loadVerifiedExecution(
    query: KecVerifiedExecutionCoordinates,
  ): Promise<VerifiedKecExtractionResult>;
  findVerifiedExecutions(
    query?: KecVerifiedExecutionCoordinates,
  ): Promise<readonly CompletedVerifiedKecExecution[]>;
  close(): void;
}

export type CompletedVerifiedKecExecution = Extract<
  VerifiedKecExtractionResult,
  { readonly kind: "VERIFIED_EXECUTION_COMPLETE" }
>;

function validatePath(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function incomplete(): VerifiedKecExtractionResult {
  return Object.freeze({
    kind: "VERIFIED_EXECUTION_INCOMPLETE",
    realSourceObserved: false,
  });
}

function referenceFrom(
  verdict: Extract<VerifyBindingSemanticResult, { kind: "BINDING_ADMITTED" }>,
): AdmissionRecordReference {
  return verdict.authorizingAdmissionReference;
}

function exactBindingMatches(
  receipt: KecVerifiedExecutionReceipt,
  snapshot: CapturedSnapshot,
): boolean {
  const binding = snapshot.requirementSnapshot.binding;
  return (
    binding.sourceRevision.sourceIdentity === receipt.sourceIdentity &&
    binding.sourceRevision.revisionKey === receipt.revisionKey &&
    binding.blobHash.algorithm === receipt.blobAlgorithm &&
    binding.blobHash.digest === receipt.blobDigest &&
    binding.extractionContract === receipt.extractionContract &&
    binding.locatorSpace === receipt.locatorSpace &&
    snapshot.captureSnapshot.binding.sourceRevision.sourceIdentity ===
      receipt.sourceIdentity &&
    snapshot.captureSnapshot.binding.sourceRevision.revisionKey ===
      receipt.revisionKey &&
    snapshot.captureSnapshot.binding.blobHash.algorithm ===
      receipt.blobAlgorithm &&
    snapshot.captureSnapshot.binding.blobHash.digest === receipt.blobDigest &&
    snapshot.captureSnapshot.binding.extractionContract ===
      receipt.extractionContract &&
    snapshot.captureSnapshot.binding.locatorSpace === receipt.locatorSpace
  );
}

function capturedSnapshot(load: Task93Load): CapturedSnapshot | null {
  if (load.status !== "captured") return null;
  return Object.freeze({
    requirementSnapshot: load.requirementSnapshot,
    captureSnapshot: load.captureSnapshot,
  });
}

class ConcreteKecSourceRuntime implements KecSourceRuntime {
  readonly #admissionRepository: SqliteBindingRepository;
  readonly #receiptStore: SqliteVerifiedExecutionReceiptStore;
  readonly #task93: Task93Bridge;
  #closed = false;

  constructor(
    admissionRepository: SqliteBindingRepository,
    receiptStore: SqliteVerifiedExecutionReceiptStore,
    task93: Task93Bridge,
  ) {
    this.#admissionRepository = admissionRepository;
    this.#receiptStore = receiptStore;
    this.#task93 = task93;
  }

  async runVerifiedKecExtraction(
    input: VerifiedKecExtractionInput,
  ): Promise<VerifiedKecExtractionResult> {
    this.assertOpen();
    let bindingVerdict: VerifyBindingSemanticResult | undefined;
    let extracted: CapturedSnapshot;
    try {
      extracted = await this.#task93.extract(input, {
        verifyObservedBinding: async (binding) => {
          bindingVerdict =
            await this.#admissionRepository.verifyBinding(binding);
          return { kind: bindingVerdict.kind } as RuntimeBindingVerdict;
        },
      });
    } catch (failure) {
      if (
        bindingVerdict !== undefined &&
        bindingVerdict.kind !== "BINDING_ADMITTED" &&
        failure instanceof Error &&
        failure.name === "KecSourceBindingVerificationError"
      ) {
        return Object.freeze({
          kind: "EXTRACTION_REFUSED",
          verdict: bindingVerdict.kind,
          realSourceObserved: false,
        });
      }
      throw failure;
    }
    if (bindingVerdict?.kind !== "BINDING_ADMITTED") {
      throw new TypeError(
        "Task90 completed without an admitted binding verdict",
      );
    }
    const binding = extracted.requirementSnapshot.binding;
    const authorizing = referenceFrom(bindingVerdict);
    if (
      authorizing.sourceIdentity !== binding.sourceRevision.sourceIdentity ||
      authorizing.revisionKey !== binding.sourceRevision.revisionKey ||
      authorizing.blobAlgorithm !== binding.blobHash.algorithm ||
      authorizing.blobDigest !== binding.blobHash.digest
    ) {
      throw new TypeError(
        "authorizing admission does not match extracted bytes",
      );
    }
    const durableResult = this.#task93.durableResult(extracted);
    const commitment =
      computeKecVerifiedExtractionResultCommitment(durableResult);
    const receipt: KecVerifiedExecutionReceipt = Object.freeze({
      sourceIdentity: binding.sourceRevision.sourceIdentity,
      revisionKey: binding.sourceRevision.revisionKey,
      blobAlgorithm: binding.blobHash.algorithm,
      blobDigest: binding.blobHash.digest,
      extractionContract: binding.extractionContract,
      locatorSpace: binding.locatorSpace,
      admissionSequence: authorizing.admissionSequence,
      commitmentAlgorithm: commitment.algorithm,
      commitmentCodec: commitment.codec,
      commitmentDigest: commitment.digest,
    });
    this.#receiptStore.appendDerivedReceipt(receipt);
    this.#task93.storeCapturedSnapshot(extracted);
    return (
      (await this.resolveCompletedVerifiedExecution(receipt)) ?? incomplete()
    );
  }

  async loadVerifiedExecution(
    query: KecVerifiedExecutionCoordinates,
  ): Promise<VerifiedKecExtractionResult> {
    this.assertOpen();
    const candidates = this.#receiptStore.findVerifiedExecutions(query);
    for (const receipt of candidates) {
      const completed = await this.resolveCompletedVerifiedExecution(receipt);
      if (completed !== null) return completed;
    }
    return incomplete();
  }

  async findVerifiedExecutions(
    query?: KecVerifiedExecutionCoordinates,
  ): Promise<readonly CompletedVerifiedKecExecution[]> {
    this.assertOpen();
    const completed: CompletedVerifiedKecExecution[] = [];
    for (const receipt of this.#receiptStore.findVerifiedExecutions(query)) {
      const result = await this.resolveCompletedVerifiedExecution(receipt);
      if (result !== null) completed.push(result);
    }
    return Object.freeze(completed);
  }

  close(): void {
    if (this.#closed) return;
    let firstFailure: unknown;
    for (const close of [
      () => this.#task93.close(),
      () => this.#receiptStore.close(),
      () => this.#admissionRepository.close(),
    ]) {
      try {
        close();
      } catch (failure) {
        firstFailure ??= failure;
      }
    }
    this.#closed = true;
    if (firstFailure !== undefined) throw firstFailure;
  }

  private async resolveCompletedVerifiedExecution(
    receipt: KecVerifiedExecutionReceipt,
  ): Promise<CompletedVerifiedKecExecution | null> {
    const loaded = this.#task93.loadSnapshotWithCapture(receipt);
    const snapshot = capturedSnapshot(loaded);
    if (snapshot === null || !exactBindingMatches(receipt, snapshot)) {
      return null;
    }
    const durableResult = this.#task93.durableResult(snapshot);
    if (
      durableResult.extractionContract !== receipt.extractionContract ||
      durableResult.locatorSpace !== receipt.locatorSpace
    ) {
      return null;
    }
    const recomputed = computeKecVerifiedExtractionResultCommitment(
      durableResult,
      {
        algorithm: receipt.commitmentAlgorithm,
        codec: receipt.commitmentCodec,
      },
    );
    if (recomputed.digest !== receipt.commitmentDigest) return null;
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_COMPLETE",
      receipt,
      realSourceObserved: true,
    });
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error("KEC source runtime is closed");
  }
}

export async function openKecSourceRuntime(
  options: KecSourceRuntimeOpenOptions,
): Promise<KecSourceRuntime> {
  validatePath(
    options.sourceAdmissionDatabasePath,
    "sourceAdmissionDatabasePath",
  );
  validatePath(options.receiptDatabasePath, "receiptDatabasePath");
  validatePath(options.task93DatabasePath, "task93DatabasePath");

  const admissionRepository = new SqliteBindingRepository(
    options.sourceAdmissionDatabasePath,
  );
  let receiptStore: SqliteVerifiedExecutionReceiptStore | undefined;
  let task93: Task93Bridge | undefined;
  try {
    receiptStore = new SqliteVerifiedExecutionReceiptStore(
      options.receiptDatabasePath,
    );
    task93 = await Task93Bridge.open(options.task93DatabasePath);
    return Object.freeze(
      new ConcreteKecSourceRuntime(admissionRepository, receiptStore, task93),
    );
  } catch (failure) {
    try {
      task93?.close();
    } catch {
      // Preserve the composition failure.
    }
    try {
      receiptStore?.close();
    } catch {
      // Preserve the composition failure.
    }
    try {
      admissionRepository.close();
    } catch {
      // Preserve the composition failure.
    }
    throw failure;
  }
}
