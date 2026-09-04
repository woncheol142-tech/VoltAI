import * as extractionV1 from "../../packages/mcp-kec/src/knowledge/requirementExtraction.js";
import { KEC_SOURCE_CAPTURE_CONTRACT_ID } from "../../packages/mcp-kec/src/knowledge/sourceCapture.js";
import { deterministicKoreanPdfBytes } from "../../packages/mcp-kec/test/fixtures/requirementExtractionContracts.js";
import * as runtimeInternal from "../../packages/kec-source-runtime/src/index.js";
import { openKecSourceRuntime } from "../../packages/kec-source-runtime/src/public.js";
import { admitBinding } from "../../packages/source-admission/src/index.js";
import { SqliteBindingRepository } from "../../packages/source-admission-sqlite/src/index.js";
import type {
  SourceBlobHash,
  SourceRevision,
} from "../../packages/source-core/src/index.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  createSyntheticAuthorityFixture,
  diagnosticSourceContext,
  loadModule,
  ownKeysDeep,
  requiredV2TechnicalOperation,
  sourceBlobHash,
  sourceText,
  syntheticSourceRevision,
  TASK98_R0_CONTRACTS,
  TASK98_V2_CAPTURE_CONTRACT_ID,
  TASK98_V2_EXTRACTION_CONTRACT_ID,
  TASK98_V2_LOCATOR_SPACE,
  task98Paths,
  technicalInput,
  type Task98R0Obligation,
} from "./fixtures/task98R0ArchitectureContract.js";

type UnknownRecord = Readonly<Record<string, unknown>>;

function contract(
  id: Exclude<Task98R0Obligation, "BG-2">,
  run: () => unknown | Promise<unknown>,
): void {
  it(`[${id}] ${TASK98_R0_CONTRACTS[id].testName}`, run);
}

async function validatePdf(bytes: Uint8Array): Promise<void> {
  const requireFromMcpKec = createRequire(
    pathToFileURL(task98Paths.mcpKecManifest),
  );
  const pdfjsPath = requireFromMcpKec.resolve(
    "pdfjs-dist/legacy/build/pdf.mjs",
  );
  const pdfjs = await import(/* @vite-ignore */ pathToFileURL(pdfjsPath).href);
  const loading = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loading.promise;
  try {
    expect(document.numPages).toBe(1);
  } finally {
    await document.cleanup();
    await loading.destroy();
  }
}

async function technicalOperation() {
  return requiredV2TechnicalOperation(
    await loadModule(task98Paths.requirementExtraction),
  );
}

function failureCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as UnknownRecord;
  if (typeof record.code === "string") return record.code;
  if (typeof record.kind === "string") return record.kind;
  if (typeof record.name === "string") return record.name;
  return undefined;
}

async function captureFailure(
  run: () => unknown | Promise<unknown>,
): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (failure) {
    return failure;
  }
}

function admittedReference(
  sourceRevision: SourceRevision,
  blobHash: SourceBlobHash,
) {
  return Object.freeze({
    sourceIdentity: sourceRevision.sourceIdentity,
    revisionKey: sourceRevision.revisionKey,
    blobAlgorithm: blobHash.algorithm,
    blobDigest: blobHash.digest,
    admissionSequence: 1,
  });
}

function technicalDurableResult() {
  return Object.freeze({
    extractionContract: TASK98_V2_EXTRACTION_CONTRACT_ID,
    locatorSpace: TASK98_V2_LOCATOR_SPACE,
    requirements: Object.freeze([]),
    capture: Object.freeze({
      state: "present" as const,
      captureContract: TASK98_V2_CAPTURE_CONTRACT_ID,
      observations: Object.freeze([]),
    }),
  });
}

function inMemoryRuntimeDependencies(
  sourceRevision: SourceRevision,
  bytes: Uint8Array,
) {
  const blobHash = sourceBlobHash(bytes);
  const durableResult = technicalDurableResult();
  return {
    exactSourceBytes: bytes,
    verifier: {
      verifyObservedBinding: vi.fn(async () => ({
        kind: "BINDING_ADMITTED" as const,
        effectiveAdmissionReferences: [
          admittedReference(sourceRevision, blobHash),
        ],
      })),
    },
    task90: {
      extractExactBytes: vi.fn(
        async (
          _bytes: Uint8Array,
          _input: Readonly<{ sourceRevision: SourceRevision }>,
        ) => {
          void _bytes;
          void _input;
          return durableResult;
        },
      ),
    },
    receiptStore: {
      appendDerivedReceipt: vi.fn(),
      findVerifiedExecutions: vi.fn(() => []),
    },
    snapshotStore: {
      storeCapturedSnapshot: vi.fn(),
      loadSnapshotWithCapture: vi.fn(() => ({
        status: "captured",
        durableResult,
      })),
    },
  };
}

async function admitSyntheticFixture(
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

async function withConcreteRuntime<Result>(
  fixture: ReturnType<typeof createSyntheticAuthorityFixture>,
  run: (
    runtime: Awaited<ReturnType<typeof openKecSourceRuntime>>,
  ) => Result | Promise<Result>,
): Promise<Result> {
  const runtime = await openKecSourceRuntime({
    sourceAdmissionDatabasePath: fixture.sourceAdmissionDatabasePath,
    receiptDatabasePath: fixture.receiptDatabasePath,
    task93DatabasePath: fixture.task93DatabasePath,
  });
  try {
    return await run(runtime);
  } finally {
    runtime.close();
  }
}

describe("Task98 Approach C R0 RED contracts", () => {
  contract("Z", async () => {
    const fixture = createSyntheticAuthorityFixture();
    try {
      await validatePdf(fixture.bytes);
      const operation = await technicalOperation();
      const result = await operation(technicalInput(fixture.bytes));
      expect(ownKeysDeep(result)).not.toEqual(
        expect.arrayContaining([
          "admissionReference",
          "authorizingAdmissionReference",
          "receipt",
          "receiptStore",
          "snapshotStore",
          "verifiedExecution",
        ]),
      );
    } finally {
      fixture.cleanup();
    }
  });

  contract("AA", async () => {
    expect(extractionV1.KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID).toBe(
      "kec:pdfjs-structural-normative-paragraphs:v1",
    );
    expect(extractionV1.KEC_REQUIREMENT_LOCATOR_SPACE).toBe(
      "kec:pdf-text-item-span:v1",
    );
    expect(KEC_SOURCE_CAPTURE_CONTRACT_ID).toBe(
      "kec:pdfjs-structural-capture-observations:v1",
    );
    for (const name of [
      "extractKecRequirementSnapshot",
      "extractKecRequirementSnapshotWithCapture",
      "extractKecRequirements",
    ] as const) {
      expect(extractionV1[name]).toBeTypeOf("function");
      expect(extractionV1[name].length).toBe(2);
    }

    const fixture = createSyntheticAuthorityFixture();
    const verifier = {
      verifyObservedBinding: vi.fn(async () => ({
        kind: "BINDING_ADMITTED" as const,
      })),
    };
    try {
      const result =
        await extractionV1.extractKecRequirementSnapshotWithCapture(
          {
            projectRoot: fixture.root,
            sourceLocator: fixture.sourceLocator,
            sourceRevision: fixture.sourceRevision,
          },
          verifier,
        );
      expect(result.requirementSnapshot.binding).toMatchObject({
        extractionContract: "kec:pdfjs-structural-normative-paragraphs:v1",
        locatorSpace: "kec:pdf-text-item-span:v1",
      });
      expect(result.captureSnapshot.captureContract).toBe(
        "kec:pdfjs-structural-capture-observations:v1",
      );
      expect(verifier.verifyObservedBinding).toHaveBeenCalledTimes(1);
    } finally {
      fixture.cleanup();
    }
  });

  contract("AB", async () => {
    const fixture = createSyntheticAuthorityFixture();
    const verifier = {
      verifyObservedBinding: vi.fn(async () => ({
        kind: "BINDING_ADMITTED" as const,
      })),
    };
    try {
      const v1 = await extractionV1.extractKecRequirementSnapshotWithCapture(
        {
          projectRoot: fixture.root,
          sourceLocator: fixture.sourceLocator,
          sourceRevision: fixture.sourceRevision,
        },
        verifier,
      );
      const v2 = (await technicalOperation())(technicalInput(fixture.bytes));
      const resolvedV2 = (await v2) as UnknownRecord;
      expect(resolvedV2.extractionContract).toBe(
        TASK98_V2_EXTRACTION_CONTRACT_ID,
      );
      expect(resolvedV2.locatorSpace).toBe(TASK98_V2_LOCATOR_SPACE);
      expect(resolvedV2.captureContract).toBe(TASK98_V2_CAPTURE_CONTRACT_ID);
      expect(resolvedV2.extractionContract).not.toBe(
        v1.requirementSnapshot.binding.extractionContract,
      );
      expect(resolvedV2.locatorSpace).not.toBe(
        v1.requirementSnapshot.binding.locatorSpace,
      );
      expect(sourceBlobHash(fixture.bytes)).toEqual(
        v1.requirementSnapshot.binding.blobHash,
      );
    } finally {
      fixture.cleanup();
    }
  });

  contract("BG-1", async () => {
    const bytes = deterministicKoreanPdfBytes("합성 바이트는 시설하여야 한다");
    await validatePdf(bytes);
    const operation = await technicalOperation();
    await expect(operation(technicalInput(bytes))).resolves.toBeDefined();
  });

  contract("BG-3", async () => {
    const bytes = deterministicKoreanPdfBytes("합성 결과는 보호하여야 한다");
    await validatePdf(bytes);
    const module = await loadModule(task98Paths.requirementExtraction);
    const result = await requiredV2TechnicalOperation(module)(
      technicalInput(bytes),
    );
    expect(Object.keys(module)).not.toEqual(
      expect.arrayContaining([
        "appendVerificationReceipt",
        "createVerifiedReceipt",
        "persistAuthorizedSnapshot",
        "recordVerifiedExtraction",
      ]),
    );
    const keys = ownKeysDeep(result);
    expect(keys).not.toEqual(
      expect.arrayContaining([
        "admissionReference",
        "authorityEnvelope",
        "receipt",
        "verified",
      ]),
    );
  });

  contract("BG-4", async () => {
    const fixture = createSyntheticAuthorityFixture();
    try {
      const result = await withConcreteRuntime(fixture, (runtime) =>
        runtime.runVerifiedKecExtraction({
          projectRoot: fixture.root,
          sourceLocator: fixture.sourceLocator,
          sourceRevision: fixture.sourceRevision,
        }),
      );
      expect(result).toMatchObject({
        kind: "EXTRACTION_REFUSED",
        verdict: "BINDING_NOT_ADMITTED",
        realSourceObserved: false,
      });

      for (const kind of [
        "BINDING_NOT_ADMITTED",
        "BINDING_WITHDRAWN",
        "BINDING_CONTRADICTION",
      ] as const) {
        const dependencies = inMemoryRuntimeDependencies(
          fixture.sourceRevision,
          fixture.bytes,
        );
        dependencies.verifier.verifyObservedBinding.mockResolvedValueOnce({
          kind,
        } as never);
        const refusal = await runtimeInternal.runVerifiedKecExtraction(
          {
            projectRoot: fixture.root,
            sourceLocator: fixture.sourceLocator,
            sourceRevision: fixture.sourceRevision,
          },
          dependencies,
        );
        expect(refusal).toMatchObject({
          kind: "EXTRACTION_REFUSED",
          verdict: kind,
        });
        expect(dependencies.task90.extractExactBytes).not.toHaveBeenCalled();
        expect(
          dependencies.receiptStore.appendDerivedReceipt,
        ).not.toHaveBeenCalled();
        expect(
          dependencies.snapshotStore.storeCapturedSnapshot,
        ).not.toHaveBeenCalled();
      }

      const trustedSource = sourceText(task98Paths.trustedRuntime);
      const verifyIndex = trustedSource.indexOf(
        "this.#admissionRepository.verifyBinding",
      );
      const v2CoreIndex = trustedSource.indexOf("extractKecV2Technical");
      expect(
        verifyIndex,
        "Task96 must own an explicit admission check",
      ).toBeGreaterThanOrEqual(0);
      expect(
        v2CoreIndex,
        "MISSING_TASK96_V2_ADAPTER: shared V2 core call is absent",
      ).toBeGreaterThanOrEqual(0);
      expect(verifyIndex).toBeLessThan(v2CoreIndex);
    } finally {
      fixture.cleanup();
    }
  });

  contract("BG-5", async () => {
    const fixture = createSyntheticAuthorityFixture();
    try {
      await admitSyntheticFixture(fixture);
      const result = await withConcreteRuntime(fixture, (runtime) =>
        runtime.runVerifiedKecExtraction({
          projectRoot: fixture.root,
          sourceLocator: fixture.sourceLocator,
          sourceRevision: fixture.sourceRevision,
        }),
      );
      expect(result.kind).toBe("VERIFIED_EXECUTION_COMPLETE");

      const dependencies = inMemoryRuntimeDependencies(
        fixture.sourceRevision,
        fixture.bytes,
      );
      const sharedCore = dependencies.task90.extractExactBytes;
      await runtimeInternal.runVerifiedKecExtraction(
        {
          projectRoot: fixture.root,
          sourceLocator: fixture.sourceLocator,
          sourceRevision: fixture.sourceRevision,
        },
        dependencies,
      );
      expect(sharedCore).toHaveBeenCalledTimes(1);
      expect(sharedCore.mock.calls[0]?.[0]).toBe(fixture.bytes);

      const trustedSource = sourceText(task98Paths.trustedRuntime);
      const coreReferences =
        trustedSource.match(/extractKecV2Technical/gu) ?? [];
      expect(
        coreReferences.length,
        "MISSING_TASK96_V2_ADAPTER: admitted trusted execution does not select the shared V2 core",
      ).toBeGreaterThanOrEqual(1);
      expect(trustedSource).toContain(TASK98_V2_EXTRACTION_CONTRACT_ID);
    } finally {
      fixture.cleanup();
    }
  });

  contract("BG-6", async () => {
    const fixture = createSyntheticAuthorityFixture();
    try {
      const sourceContext = syntheticSourceRevision(
        "synthetic:test-only:task98:bg6:source",
        "synthetic:test-only:task98:bg6:revision",
      );
      const input = technicalInput(fixture.bytes, sourceContext);
      const operation = await technicalOperation();
      const diagnosticResult = await operation(input);
      let trustedTechnicalResult: unknown;
      const stopBeforePersistence = new Error(
        "task98:test-only:stop-after-technical-core",
      );
      const dependencies = inMemoryRuntimeDependencies(
        sourceContext,
        fixture.bytes,
      );
      dependencies.task90.extractExactBytes.mockImplementationOnce(
        async (receivedBytes, receivedInput) => {
          expect(receivedBytes).toBe(fixture.bytes);
          expect(receivedInput.sourceRevision).toEqual(sourceContext);
          trustedTechnicalResult = await operation({
            ...input,
            exactBytes: receivedBytes,
          });
          throw stopBeforePersistence;
        },
      );
      const failure = await captureFailure(() =>
        runtimeInternal.runVerifiedKecExtraction(
          {
            projectRoot: fixture.root,
            sourceLocator: fixture.sourceLocator,
            sourceRevision: sourceContext,
          },
          dependencies,
        ),
      );
      expect(failure).toBe(stopBeforePersistence);
      expect(trustedTechnicalResult).toEqual(diagnosticResult);
      expect(
        dependencies.receiptStore.appendDerivedReceipt,
      ).not.toHaveBeenCalled();
      expect(
        dependencies.snapshotStore.storeCapturedSnapshot,
      ).not.toHaveBeenCalled();

      const trustedSource = sourceText(task98Paths.trustedRuntime);
      expect(
        trustedSource,
        "MISSING_TASK96_V2_ADAPTER: Task96 does not invoke the diagnostic technical core",
      ).toMatch(/extractKecV2Technical/u);
      expect(trustedSource).toContain(TASK98_V2_EXTRACTION_CONTRACT_ID);
    } finally {
      fixture.cleanup();
    }
  });

  contract("BG-7", async () => {
    const bytes = deterministicKoreanPdfBytes("진단 문맥은 권한이 아니다");
    const sourceRevision = diagnosticSourceContext as SourceRevision;
    const dependencies = inMemoryRuntimeDependencies(sourceRevision, bytes);
    const result = await runtimeInternal.runVerifiedKecExtraction(
      {
        projectRoot: "/synthetic/test-only/task98",
        sourceLocator: { scheme: "file", value: "synthetic.pdf" },
        sourceRevision,
      },
      dependencies,
    );
    expect(result).toMatchObject({
      kind: "EXTRACTION_REFUSED",
      realSourceObserved: false,
    });
    expect(dependencies.verifier.verifyObservedBinding).not.toHaveBeenCalled();
    expect(dependencies.task90.extractExactBytes).not.toHaveBeenCalled();
    expect(
      dependencies.receiptStore.appendDerivedReceipt,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.snapshotStore.storeCapturedSnapshot,
    ).not.toHaveBeenCalled();
  });

  contract("BG-8", async () => {
    const invalidFixture = createSyntheticAuthorityFixture(
      new TextEncoder().encode("not a PDF; synthetic Task98 invalid bytes"),
    );
    const validFixture = createSyntheticAuthorityFixture();
    try {
      await admitSyntheticFixture(invalidFixture);
      const parserFailure = await withConcreteRuntime(
        invalidFixture,
        async (runtime) =>
          captureFailure(() =>
            runtime.runVerifiedKecExtraction({
              projectRoot: invalidFixture.root,
              sourceLocator: invalidFixture.sourceLocator,
              sourceRevision: invalidFixture.sourceRevision,
            }),
          ),
      );
      const bindingResult = await withConcreteRuntime(validFixture, (runtime) =>
        runtime.runVerifiedKecExtraction({
          projectRoot: validFixture.root,
          sourceLocator: validFixture.sourceLocator,
          sourceRevision: validFixture.sourceRevision,
        }),
      );

      expect([
        "PDF_PARSE_FAILURE",
        "GEOMETRY_FAILURE",
        "EXTRACTION_FAILURE",
        "RESOURCE_FAILURE",
      ]).toContain(failureCode(parserFailure));
      expect(String(failureCode(parserFailure))).not.toMatch(/^BINDING_/u);
      expect(bindingResult).toMatchObject({
        kind: "EXTRACTION_REFUSED",
        verdict: "BINDING_NOT_ADMITTED",
      });
    } finally {
      invalidFixture.cleanup();
      validFixture.cleanup();
    }
  });
});
