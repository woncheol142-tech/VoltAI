import {
  extractKecV2Technical as facadeExtractKecV2Technical,
  KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
  KEC_REQUIREMENT_LOCATOR_SPACE,
} from "../../packages/mcp-kec/src/knowledge/requirementExtraction.js";
import { KecRequirementSnapshotStore } from "../../packages/mcp-kec/src/requirementSnapshot/store.js";
import * as technical from "../../packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.js";
import { SqliteVerifiedExecutionReceiptStore } from "../../packages/kec-source-runtime/src/internal/receiptStore.js";
import { openKecSourceRuntime } from "../../packages/kec-source-runtime/src/public.js";
import { admitBinding } from "../../packages/source-admission/src/index.js";
import { SqliteBindingRepository } from "../../packages/source-admission-sqlite/src/index.js";
import type { SourceRevision } from "../../packages/source-core/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSyntheticAuthorityFixture,
  diagnosticSourceContext,
  sourceBlobHash,
} from "./fixtures/task98R0ArchitectureContract.js";

async function admit(
  fixture: ReturnType<typeof createSyntheticAuthorityFixture>,
): Promise<void> {
  const repository = new SqliteBindingRepository(
    fixture.sourceAdmissionDatabasePath,
  );
  try {
    await admitBinding(
      repository,
      {
        sourceRevision: fixture.sourceRevision,
        blobHash: sourceBlobHash(fixture.bytes),
      },
      "synthetic:test-only:task98:authority",
      "synthetic:test-only:task98:basis",
    );
  } finally {
    repository.close();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Task98 R0 concrete GREEN behavior", () => {
  it("uses one shared V2 declaration for diagnostic and trusted execution", () => {
    expect(facadeExtractKecV2Technical).toBe(technical.extractKecV2Technical);
  });

  it("runs the shared V2 core once after concrete synthetic admission", async () => {
    const fixture = createSyntheticAuthorityFixture();
    await admit(fixture);
    const verifierCall = vi.spyOn(
      SqliteBindingRepository.prototype,
      "verifyBinding",
    );
    const coreCall = vi.spyOn(technical, "extractKecV2Technical");
    const receiptWrite = vi.spyOn(
      SqliteVerifiedExecutionReceiptStore.prototype,
      "appendDerivedReceipt",
    );
    const snapshotWrite = vi.spyOn(
      KecRequirementSnapshotStore.prototype,
      "storeCapturedSnapshot",
    );
    try {
      const runtime = await openKecSourceRuntime({
        sourceAdmissionDatabasePath: fixture.sourceAdmissionDatabasePath,
        receiptDatabasePath: fixture.receiptDatabasePath,
        task93DatabasePath: fixture.task93DatabasePath,
      });
      const result = await runtime.runVerifiedKecExtraction({
        projectRoot: fixture.root,
        sourceLocator: fixture.sourceLocator,
        sourceRevision: fixture.sourceRevision,
      });
      runtime.close();

      expect(result).toMatchObject({
        kind: "VERIFIED_EXECUTION_COMPLETE",
        receipt: {
          extractionContract: KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
          locatorSpace: KEC_REQUIREMENT_LOCATOR_SPACE,
        },
      });
      expect(verifierCall).toHaveBeenCalledTimes(1);
      expect(coreCall).toHaveBeenCalledTimes(1);
      expect(receiptWrite).toHaveBeenCalledTimes(1);
      expect(snapshotWrite).toHaveBeenCalledTimes(1);
      const verificationOrder = verifierCall.mock.invocationCallOrder[0]!;
      const coreOrder = coreCall.mock.invocationCallOrder[0]!;
      const firstDurableWrite = Math.min(
        receiptWrite.mock.invocationCallOrder[0]!,
        snapshotWrite.mock.invocationCallOrder[0]!,
      );
      expect(verificationOrder).toBeLessThan(coreOrder);
      expect(coreOrder).toBeLessThan(firstDurableWrite);
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps core and durable writes at zero for unadmitted and diagnostic contexts", async () => {
    const unadmitted = createSyntheticAuthorityFixture();
    const diagnostic = createSyntheticAuthorityFixture();
    const verifierCall = vi.spyOn(
      SqliteBindingRepository.prototype,
      "verifyBinding",
    );
    const coreCall = vi.spyOn(technical, "extractKecV2Technical");
    const receiptWrite = vi.spyOn(
      SqliteVerifiedExecutionReceiptStore.prototype,
      "appendDerivedReceipt",
    );
    const snapshotWrite = vi.spyOn(
      KecRequirementSnapshotStore.prototype,
      "storeCapturedSnapshot",
    );
    try {
      const runtime = await openKecSourceRuntime({
        sourceAdmissionDatabasePath: unadmitted.sourceAdmissionDatabasePath,
        receiptDatabasePath: unadmitted.receiptDatabasePath,
        task93DatabasePath: unadmitted.task93DatabasePath,
      });
      await expect(
        runtime.runVerifiedKecExtraction({
          projectRoot: unadmitted.root,
          sourceLocator: unadmitted.sourceLocator,
          sourceRevision: unadmitted.sourceRevision,
        }),
      ).resolves.toMatchObject({
        kind: "EXTRACTION_REFUSED",
        verdict: "BINDING_NOT_ADMITTED",
      });
      runtime.close();
      expect(verifierCall).toHaveBeenCalledTimes(1);
      expect(coreCall).toHaveBeenCalledTimes(0);
      expect(receiptWrite).toHaveBeenCalledTimes(0);
      expect(snapshotWrite).toHaveBeenCalledTimes(0);

      verifierCall.mockClear();
      const diagnosticRuntime = await openKecSourceRuntime({
        sourceAdmissionDatabasePath: diagnostic.sourceAdmissionDatabasePath,
        receiptDatabasePath: diagnostic.receiptDatabasePath,
        task93DatabasePath: diagnostic.task93DatabasePath,
      });
      await expect(
        diagnosticRuntime.runVerifiedKecExtraction({
          projectRoot: diagnostic.root,
          sourceLocator: diagnostic.sourceLocator,
          sourceRevision: diagnosticSourceContext as SourceRevision,
        }),
      ).resolves.toEqual({
        kind: "EXTRACTION_REFUSED",
        reason: "DIAGNOSTIC_CONTEXT_NOT_AUTHORITATIVE",
        realSourceObserved: false,
      });
      diagnosticRuntime.close();
      expect(verifierCall).toHaveBeenCalledTimes(0);
      expect(coreCall).toHaveBeenCalledTimes(0);
      expect(receiptWrite).toHaveBeenCalledTimes(0);
      expect(snapshotWrite).toHaveBeenCalledTimes(0);
    } finally {
      unadmitted.cleanup();
      diagnostic.cleanup();
    }
  });

  it("preserves the PDFJS cause on an admitted technical failure", async () => {
    const fixture = createSyntheticAuthorityFixture(
      new TextEncoder().encode("not a PDF; synthetic Task98 invalid bytes"),
    );
    const receiptWrite = vi.spyOn(
      SqliteVerifiedExecutionReceiptStore.prototype,
      "appendDerivedReceipt",
    );
    const snapshotWrite = vi.spyOn(
      KecRequirementSnapshotStore.prototype,
      "storeCapturedSnapshot",
    );
    try {
      await admit(fixture);
      const runtime = await openKecSourceRuntime({
        sourceAdmissionDatabasePath: fixture.sourceAdmissionDatabasePath,
        receiptDatabasePath: fixture.receiptDatabasePath,
        task93DatabasePath: fixture.task93DatabasePath,
      });
      let observed: unknown;
      try {
        await runtime.runVerifiedKecExtraction({
          projectRoot: fixture.root,
          sourceLocator: fixture.sourceLocator,
          sourceRevision: fixture.sourceRevision,
        });
      } catch (failure) {
        observed = failure;
      } finally {
        runtime.close();
      }
      expect(observed).toBeInstanceOf(technical.KecTechnicalExtractionFailure);
      expect(observed).toMatchObject({
        code: "PDF_PARSE_FAILURE",
        name: "PDF_PARSE_FAILURE",
      });
      const typed = observed as technical.KecTechnicalExtractionFailure;
      expect(typed.cause).toBeInstanceOf(Error);
      expect(typed.message).toBe((typed.cause as Error).message);
      expect(receiptWrite).toHaveBeenCalledTimes(0);
      expect(snapshotWrite).toHaveBeenCalledTimes(0);
    } finally {
      fixture.cleanup();
    }
  });
});
