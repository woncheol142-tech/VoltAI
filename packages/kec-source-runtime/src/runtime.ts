import { createHash } from "node:crypto";

import type { AdmissionRecordReference } from "@voltai/source-admission";
import type { SourceBlobHash } from "@voltai/source-core";

import { computeKecVerifiedExtractionResultCommitment } from "./internal/resultCommitment.js";
import {
  DIAGNOSTIC_CONTEXT_REFUSAL,
  isDiagnosticSourceContext,
} from "./sourceContext.js";
import type {
  KecDurableVerifiedResult,
  KecSourceRuntimeDependencies,
  KecVerifiedExecutionCoordinates,
  KecVerifiedExecutionReceipt,
  VerifiedKecExtractionInput,
  VerifiedKecExtractionResult,
} from "./types.js";

const lowerHexSha256 = /^[0-9a-f]{64}$/u;

function sourceBlobHash(bytes: Uint8Array): SourceBlobHash {
  return Object.freeze({
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
}

function establishedInput(input: VerifiedKecExtractionInput): void {
  if (
    typeof input.sourceRevision?.sourceIdentity !== "string" ||
    input.sourceRevision.sourceIdentity.length === 0 ||
    typeof input.sourceRevision.revisionKey !== "string" ||
    input.sourceRevision.revisionKey.length === 0
  ) {
    throw new TypeError("an established source revision is required");
  }
}

function selectAuthorizingReference(
  references: readonly AdmissionRecordReference[],
): AdmissionRecordReference {
  const matching = references
    .filter(
      (reference) =>
        Number.isSafeInteger(reference.admissionSequence) &&
        reference.admissionSequence > 0,
    )
    .sort((left, right) => left.admissionSequence - right.admissionSequence);
  if (matching.length === 0) {
    throw new Error("admitted binding has no matching admission reference");
  }
  return matching[0]!;
}

function coordinatesMatch(
  receipt: KecVerifiedExecutionReceipt,
  query: KecVerifiedExecutionCoordinates,
): boolean {
  return (
    receipt.sourceIdentity === query.sourceIdentity &&
    receipt.revisionKey === query.revisionKey &&
    receipt.blobAlgorithm === query.blobAlgorithm &&
    receipt.blobDigest === query.blobDigest &&
    receipt.extractionContract === query.extractionContract &&
    receipt.locatorSpace === query.locatorSpace
  );
}

function durableResultFromLoad(
  value: unknown,
): KecDurableVerifiedResult | null {
  if (typeof value !== "object" || value === null) return null;
  const load = value as Record<string, unknown>;
  if (load.status !== "captured") return null;
  const durableResult = load.durableResult;
  if (typeof durableResult !== "object" || durableResult === null) return null;
  return durableResult as KecDurableVerifiedResult;
}

function completedBy(
  receipt: KecVerifiedExecutionReceipt,
  query: KecVerifiedExecutionCoordinates,
  loaded: unknown,
): VerifiedKecExtractionResult {
  if (
    !coordinatesMatch(receipt, query) ||
    receipt.commitmentAlgorithm !== "sha-256" ||
    receipt.commitmentCodec !== "kec:verified-extraction-result:v1" ||
    !lowerHexSha256.test(receipt.commitmentDigest)
  ) {
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_INCOMPLETE",
      realSourceObserved: false,
    });
  }
  const result = durableResultFromLoad(loaded);
  if (result === null) {
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_INCOMPLETE",
      realSourceObserved: false,
    });
  }
  if (
    result.extractionContract !== receipt.extractionContract ||
    result.locatorSpace !== receipt.locatorSpace
  ) {
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_INCOMPLETE",
      realSourceObserved: false,
    });
  }
  let recomputed;
  try {
    recomputed = computeKecVerifiedExtractionResultCommitment(result, {
      algorithm: receipt.commitmentAlgorithm,
      codec: receipt.commitmentCodec,
    });
  } catch {
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_INCOMPLETE",
      realSourceObserved: false,
    });
  }
  if (recomputed.digest !== receipt.commitmentDigest) {
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_INCOMPLETE",
      realSourceObserved: false,
    });
  }
  return Object.freeze({
    kind: "VERIFIED_EXECUTION_COMPLETE",
    receipt,
    realSourceObserved: true,
  });
}

export async function loadVerifiedExecution(
  query: KecVerifiedExecutionCoordinates,
  dependencies: Pick<
    KecSourceRuntimeDependencies,
    "receiptStore" | "snapshotStore"
  >,
): Promise<VerifiedKecExtractionResult> {
  const receipts =
    await dependencies.receiptStore.findVerifiedExecutions(query);
  if (receipts.length === 0) {
    return Object.freeze({
      kind: "VERIFIED_EXECUTION_INCOMPLETE",
      realSourceObserved: false,
    });
  }
  const loaded =
    await dependencies.snapshotStore.loadSnapshotWithCapture(query);
  for (const receipt of receipts) {
    const result = completedBy(receipt, query, loaded);
    if (result.kind === "VERIFIED_EXECUTION_COMPLETE") return result;
  }
  return Object.freeze({
    kind: "VERIFIED_EXECUTION_INCOMPLETE",
    realSourceObserved: false,
  });
}

export async function findVerifiedExecutions(
  query: KecVerifiedExecutionCoordinates,
  dependencies: Pick<KecSourceRuntimeDependencies, "receiptStore">,
): Promise<readonly KecVerifiedExecutionReceipt[]> {
  return dependencies.receiptStore.findVerifiedExecutions(query);
}

export async function runVerifiedKecExtraction(
  input: VerifiedKecExtractionInput,
  dependencies: KecSourceRuntimeDependencies,
): Promise<VerifiedKecExtractionResult> {
  if (isDiagnosticSourceContext(input.sourceRevision)) {
    return Object.freeze({
      kind: "EXTRACTION_REFUSED",
      reason: DIAGNOSTIC_CONTEXT_REFUSAL,
      realSourceObserved: false,
    });
  }
  establishedInput(input);
  if (!(dependencies.exactSourceBytes instanceof Uint8Array)) {
    throw new TypeError("exactSourceBytes must be a Uint8Array");
  }
  const blobHash = sourceBlobHash(dependencies.exactSourceBytes);
  const verdict = await dependencies.verifier.verifyObservedBinding({
    sourceRevision: input.sourceRevision,
    blobHash,
  });
  if (verdict.kind !== "BINDING_ADMITTED") {
    return Object.freeze({
      kind: "EXTRACTION_REFUSED",
      verdict: verdict.kind,
      realSourceObserved: false,
    });
  }
  const references = verdict.authorizingAdmissionReference
    ? [verdict.authorizingAdmissionReference]
    : verdict.effectiveAdmissionReferences;
  const authorizing = selectAuthorizingReference(references);
  const durableResult = await dependencies.task90.extractExactBytes(
    dependencies.exactSourceBytes,
    input,
  );
  const commitment =
    computeKecVerifiedExtractionResultCommitment(durableResult);
  const receipt: KecVerifiedExecutionReceipt = Object.freeze({
    sourceIdentity: input.sourceRevision.sourceIdentity,
    revisionKey: input.sourceRevision.revisionKey,
    blobAlgorithm: blobHash.algorithm,
    blobDigest: blobHash.digest,
    extractionContract: durableResult.extractionContract,
    locatorSpace: durableResult.locatorSpace,
    admissionSequence: authorizing.admissionSequence,
    commitmentAlgorithm: commitment.algorithm,
    commitmentCodec: commitment.codec,
    commitmentDigest: commitment.digest,
  });
  await dependencies.receiptStore.appendDerivedReceipt(receipt);
  await dependencies.snapshotStore.storeCapturedSnapshot(durableResult);
  const query: KecVerifiedExecutionCoordinates = receipt;
  const loaded =
    await dependencies.snapshotStore.loadSnapshotWithCapture(query);
  return completedBy(receipt, query, loaded);
}
