import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteBindingRepository } from "@voltai/source-admission-sqlite";
import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "@voltai/source-core";
import { describe, expect, it, vi } from "vitest";

import {
  createRequirementPdfFixture,
  deterministicKoreanPdfBytes,
  explicitSourceRevision,
} from "../../mcp-kec/test/fixtures/requirementExtractionContracts.js";
import {
  extractKecRequirementSnapshotWithCapture,
  KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
  KEC_REQUIREMENT_LOCATOR_SPACE,
  type KecRequirementExtractionBinding,
} from "../../mcp-kec/src/knowledge/requirementExtraction.js";
import {
  KEC_SOURCE_CAPTURE_CONTRACT_ID,
  type KecCapturedRequirementSnapshot,
} from "../../mcp-kec/src/knowledge/sourceCapture.js";
import { KecRequirementSnapshotStore } from "../../mcp-kec/src/requirementSnapshot/store.js";
import { SqliteVerifiedExecutionReceiptStore } from "../src/internal/receiptStore.js";
import { computeKecVerifiedExtractionResultCommitment } from "../src/internal/resultCommitment.js";
import {
  openKecSourceRuntime,
  type KecSourceRuntimeOpenOptions,
} from "../src/public.js";
import type {
  KecDurableVerifiedResult,
  KecVerifiedExecutionCoordinates,
  KecVerifiedExecutionReceipt,
  VerifiedKecExtractionInput,
} from "../src/types.js";

interface StorePaths extends KecSourceRuntimeOpenOptions {
  readonly root: string;
}

function storePaths(prefix: string): StorePaths {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    sourceAdmissionDatabasePath: join(root, "admission.sqlite"),
    receiptDatabasePath: join(root, "receipts.sqlite"),
    task93DatabasePath: join(root, "task93.sqlite"),
  };
}

function cleanup(paths: StorePaths): void {
  rmSync(paths.root, { recursive: true, force: true });
}

function blobHash(bytes: Uint8Array): SourceBlobHash {
  return {
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

function input(
  projectRoot: string,
  sourceLocator: VerifiedKecExtractionInput["sourceLocator"],
  sourceRevision = explicitSourceRevision(),
): VerifiedKecExtractionInput {
  return { projectRoot, sourceLocator, sourceRevision };
}

async function initializeStores(paths: StorePaths): Promise<void> {
  const runtime = await openKecSourceRuntime(paths);
  runtime.close();
}

function sourceRevision(label: string): SourceRevision {
  return {
    sourceIdentity: `task96:remediation:${label}` as SourceIdentity,
    revisionKey: "revision:v1" as SourceRevisionKey,
  };
}

function binding(
  label: string,
  digestCharacter: string,
): KecRequirementExtractionBinding {
  return {
    sourceRevision: sourceRevision(label),
    blobHash: {
      algorithm: "sha-256",
      digest: digestCharacter.repeat(64),
    },
    extractionContract: KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
    locatorSpace: KEC_REQUIREMENT_LOCATOR_SPACE,
  };
}

function emptyCaptured(
  value: KecRequirementExtractionBinding,
): KecCapturedRequirementSnapshot {
  return {
    requirementSnapshot: { binding: value, requirements: [] },
    captureSnapshot: {
      binding: value,
      captureContract: KEC_SOURCE_CAPTURE_CONTRACT_ID,
      observations: [],
    },
  };
}

function emptyDurable(): KecDurableVerifiedResult {
  return {
    extractionContract: KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
    locatorSpace: KEC_REQUIREMENT_LOCATOR_SPACE,
    requirements: [],
    capture: {
      state: "present",
      captureContract: KEC_SOURCE_CAPTURE_CONTRACT_ID,
      observations: [],
    },
  };
}

function receiptFor(
  value: KecRequirementExtractionBinding,
  result: KecDurableVerifiedResult,
  admissionSequence = 1,
): KecVerifiedExecutionReceipt {
  const commitment = computeKecVerifiedExtractionResultCommitment(result);
  return {
    sourceIdentity: value.sourceRevision.sourceIdentity,
    revisionKey: value.sourceRevision.revisionKey,
    blobAlgorithm: value.blobHash.algorithm,
    blobDigest: value.blobHash.digest,
    extractionContract: value.extractionContract,
    locatorSpace: value.locatorSpace,
    admissionSequence,
    commitmentAlgorithm: commitment.algorithm,
    commitmentCodec: commitment.codec,
    commitmentDigest: commitment.digest,
  };
}

function queryFor(
  value: KecRequirementExtractionBinding,
): KecVerifiedExecutionCoordinates {
  return {
    sourceIdentity: value.sourceRevision.sourceIdentity,
    revisionKey: value.sourceRevision.revisionKey,
    blobAlgorithm: value.blobHash.algorithm,
    blobDigest: value.blobHash.digest,
    extractionContract: value.extractionContract,
    locatorSpace: value.locatorSpace,
  };
}

async function admitFixture(
  paths: StorePaths,
  fixture: ReturnType<typeof createRequirementPdfFixture>,
): Promise<void> {
  const repository = new SqliteBindingRepository(
    paths.sourceAdmissionDatabasePath,
  );
  try {
    repository.admitBinding(
      {
        sourceRevision: explicitSourceRevision(),
        blobHash: blobHash(fixture.bytes),
      },
      "task96:trusted-authority",
      "task96:green-remediation",
    );
  } finally {
    repository.close();
  }
}

describe("Task96 trusted runtime GREEN remediation", () => {
  it("does not accept caller-supplied always-admit verifier authority", async () => {
    const paths = storePaths("voltai-task96-fake-verifier-");
    const fixture = createRequirementPdfFixture(deterministicKoreanPdfBytes());
    const fakeVerifier = {
      verifyBinding: vi.fn(() => ({ kind: "BINDING_ADMITTED" })),
      verifyObservedBinding: vi.fn(() => ({ kind: "BINDING_ADMITTED" })),
    };
    const maliciousOptions = { ...paths, verifier: fakeVerifier };
    try {
      const runtime = await openKecSourceRuntime(maliciousOptions);
      expect(Reflect.set(runtime, "verifier", fakeVerifier)).toBe(false);
      expect(Reflect.set(runtime, "admissionRepository", fakeVerifier)).toBe(
        false,
      );
      const result = await runtime.runVerifiedKecExtraction(
        input(fixture.projectRoot, fixture.firstLocator),
      );
      runtime.close();

      expect(result.kind).toBe("EXTRACTION_REFUSED");
      expect(fakeVerifier.verifyBinding).not.toHaveBeenCalled();
      expect(fakeVerifier.verifyObservedBinding).not.toHaveBeenCalled();
      const receipts = new SqliteVerifiedExecutionReceiptStore(
        paths.receiptDatabasePath,
      );
      expect(receipts.findVerifiedExecutions()).toEqual([]);
      receipts.close();
    } finally {
      fixture.cleanup();
      cleanup(paths);
    }
  });

  it("does not accept a caller-owned receipt writer", async () => {
    const paths = storePaths("voltai-task96-fake-receipt-");
    const fixture = createRequirementPdfFixture(deterministicKoreanPdfBytes());
    const fakeReceiptStore = {
      appendDerivedReceipt: vi.fn(),
      findVerifiedExecutions: vi.fn(() => []),
    };
    const maliciousOptions = { ...paths, receiptStore: fakeReceiptStore };
    try {
      await admitFixture(paths, fixture);
      const runtime = await openKecSourceRuntime(maliciousOptions);
      expect(Reflect.set(runtime, "receiptStore", fakeReceiptStore)).toBe(
        false,
      );
      expect(
        (
          await runtime.runVerifiedKecExtraction(
            input(fixture.projectRoot, fixture.firstLocator),
          )
        ).kind,
      ).toBe("VERIFIED_EXECUTION_COMPLETE");
      runtime.close();

      expect(fakeReceiptStore.appendDerivedReceipt).not.toHaveBeenCalled();
      expect(fakeReceiptStore.findVerifiedExecutions).not.toHaveBeenCalled();
      const receipts = new SqliteVerifiedExecutionReceiptStore(
        paths.receiptDatabasePath,
      );
      expect(receipts.findVerifiedExecutions()).toHaveLength(1);
      receipts.close();
    } finally {
      fixture.cleanup();
      cleanup(paths);
    }
  });

  it("keeps a durable orphan receipt incomplete after reopen", async () => {
    const paths = storePaths("voltai-task96-orphan-load-");
    const orphanBinding = binding("orphan-load", "1");
    try {
      await initializeStores(paths);
      const receipts = new SqliteVerifiedExecutionReceiptStore(
        paths.receiptDatabasePath,
      );
      receipts.appendDerivedReceipt(receiptFor(orphanBinding, emptyDurable()));
      receipts.close();

      const reopened = await openKecSourceRuntime(paths);
      expect(
        (await reopened.loadVerifiedExecution(queryFor(orphanBinding))).kind,
      ).toBe("VERIFIED_EXECUTION_INCOMPLETE");
      reopened.close();
    } finally {
      cleanup(paths);
    }
  });

  it("excludes a durable orphan receipt from collection results", async () => {
    const paths = storePaths("voltai-task96-orphan-find-");
    const orphanBinding = binding("orphan-find", "2");
    try {
      await initializeStores(paths);
      const receipts = new SqliteVerifiedExecutionReceiptStore(
        paths.receiptDatabasePath,
      );
      receipts.appendDerivedReceipt(receiptFor(orphanBinding, emptyDurable()));
      receipts.close();

      const reopened = await openKecSourceRuntime(paths);
      expect(await reopened.findVerifiedExecutions()).toEqual([]);
      reopened.close();
    } finally {
      cleanup(paths);
    }
  });

  it("excludes receipt-NEW plus snapshot-OLD after durable conflict", async () => {
    const paths = storePaths("voltai-task96-conflict-");
    const fixture = createRequirementPdfFixture(deterministicKoreanPdfBytes());
    try {
      const extracted = await extractKecRequirementSnapshotWithCapture(
        input(fixture.projectRoot, fixture.firstLocator),
        { verifyObservedBinding: () => ({ kind: "BINDING_ADMITTED" }) },
      );
      const task93 = new KecRequirementSnapshotStore(paths.task93DatabasePath);
      task93.storeCapturedSnapshot(
        emptyCaptured(extracted.requirementSnapshot.binding),
      );
      task93.close();
      await admitFixture(paths, fixture);

      const runtime = await openKecSourceRuntime(paths);
      await expect(
        runtime.runVerifiedKecExtraction(
          input(fixture.projectRoot, fixture.firstLocator),
        ),
      ).rejects.toMatchObject({ category: "snapshot-conflict" });
      runtime.close();

      const reopened = await openKecSourceRuntime(paths);
      const query = queryFor(extracted.requirementSnapshot.binding);
      expect((await reopened.loadVerifiedExecution(query)).kind).toBe(
        "VERIFIED_EXECUTION_INCOMPLETE",
      );
      expect(await reopened.findVerifiedExecutions(query)).toEqual([]);
      reopened.close();
    } finally {
      fixture.cleanup();
      cleanup(paths);
    }
  });

  it("includes a matching durable receipt and captured snapshot", async () => {
    const paths = storePaths("voltai-task96-complete-find-");
    const completeBinding = binding("complete-control", "3");
    try {
      await initializeStores(paths);
      const task93 = new KecRequirementSnapshotStore(paths.task93DatabasePath);
      task93.storeCapturedSnapshot(emptyCaptured(completeBinding));
      task93.close();
      const receipts = new SqliteVerifiedExecutionReceiptStore(
        paths.receiptDatabasePath,
      );
      receipts.appendDerivedReceipt(
        receiptFor(completeBinding, emptyDurable()),
      );
      receipts.close();

      const reopened = await openKecSourceRuntime(paths);
      const found = await reopened.findVerifiedExecutions(
        queryFor(completeBinding),
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        kind: "VERIFIED_EXECUTION_COMPLETE",
        realSourceObserved: true,
      });
      reopened.close();
    } finally {
      cleanup(paths);
    }
  });

  it("filters mixed durable candidates and preserves deterministic order", async () => {
    const paths = storePaths("voltai-task96-mixed-find-");
    const bindings = {
      A: binding("A-complete", "4"),
      B: binding("B-orphan", "5"),
      C: binding("C-conflict", "6"),
      D: binding("D-complete", "7"),
    };
    const conflictingNew: KecDurableVerifiedResult = {
      ...emptyDurable(),
      requirements: [
        {
          requirementId: "kec-requirement:new",
          statement: "NEW",
          locatorsJson: "[[1,0,1]]",
        },
      ],
      capture: {
        state: "present",
        captureContract: KEC_SOURCE_CAPTURE_CONTRACT_ID,
        observations: [
          {
            kindOrdinal: 2,
            kind: "requirement-assembly",
            payloadJson: '{"kind":"requirement-assembly"}',
          },
        ],
      },
    };
    try {
      await initializeStores(paths);
      const task93 = new KecRequirementSnapshotStore(paths.task93DatabasePath);
      for (const key of ["A", "C", "D"] as const) {
        task93.storeCapturedSnapshot(emptyCaptured(bindings[key]));
      }
      task93.close();
      const receipts = new SqliteVerifiedExecutionReceiptStore(
        paths.receiptDatabasePath,
      );
      receipts.appendDerivedReceipt(receiptFor(bindings.A, emptyDurable()));
      receipts.appendDerivedReceipt(receiptFor(bindings.B, emptyDurable()));
      receipts.appendDerivedReceipt(receiptFor(bindings.C, conflictingNew));
      receipts.appendDerivedReceipt(receiptFor(bindings.D, emptyDurable()));
      receipts.close();

      const reopened = await openKecSourceRuntime(paths);
      expect(
        (await reopened.findVerifiedExecutions()).map(
          ({ receipt }) => receipt.sourceIdentity,
        ),
      ).toEqual([
        bindings.A.sourceRevision.sourceIdentity,
        bindings.D.sourceRevision.sourceIdentity,
      ]);
      reopened.close();
    } finally {
      cleanup(paths);
    }
  });

  it("proper trusted composition completes with a real active admission", async () => {
    const paths = storePaths("voltai-task96-trusted-positive-");
    const fixture = createRequirementPdfFixture(deterministicKoreanPdfBytes());
    try {
      await admitFixture(paths, fixture);
      const runtime = await openKecSourceRuntime(paths);
      const completed = await runtime.runVerifiedKecExtraction(
        input(fixture.projectRoot, fixture.firstLocator),
      );
      expect(completed.kind).toBe("VERIFIED_EXECUTION_COMPLETE");
      expect(await runtime.findVerifiedExecutions()).toHaveLength(1);
      runtime.close();
    } finally {
      fixture.cleanup();
      cleanup(paths);
    }
  });
});
