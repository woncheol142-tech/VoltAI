import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  bindingFixture,
  blobHashFixture,
  invoke,
  loadKecSourceRuntime,
  loadResultCommitmentCodec,
  referenceFixture,
  requiredFunction,
  requiredJson,
  requiredText,
  RESULT_COMMITMENT_ALGORITHM,
  RESULT_COMMITMENT_CODEC,
  sourceRevisionFixture,
  TASK96_RED_FAMILY_MAP,
  Task96RedContractError,
  task96Paths,
} from "./fixtures/task96ArchitectureContract.js";

type Family = keyof typeof TASK96_RED_FAMILY_MAP;
type UnknownRecord = Readonly<Record<string, unknown>>;

function family(label: Family, run: () => unknown | Promise<unknown>): void {
  const contract = TASK96_RED_FAMILY_MAP[label];
  it(`[${label}] ${contract.case}`, run);
}

const extractionContract = "kec:contract:v1";
const locatorSpace = "kec:locator:v1";
const captureContract = "kec:capture:v1";

type DurableResult = Readonly<{
  extractionContract: string;
  locatorSpace: string;
  requirements: readonly Readonly<{
    requirementId: string;
    statement: string;
    locatorsJson: string;
  }>[];
  capture: Readonly<{
    state: "present";
    captureContract: string;
    observations: readonly Readonly<{
      kindOrdinal: number;
      kind: string;
      payloadJson: string;
    }>[];
  }>;
}>;

function durableResult(changes: Partial<DurableResult> = {}): DurableResult {
  return Object.freeze({
    extractionContract,
    locatorSpace,
    requirements: Object.freeze([
      Object.freeze({
        requirementId: "kec-requirement:001",
        statement: "전선은 보호하여야 한다",
        locatorsJson:
          '[{"pageNumber":1,"startItemIndex":0,"endItemIndexExclusive":3}]',
      }),
      Object.freeze({
        requirementId: "kec-requirement:002",
        statement: "접지는 확인하여야 한다",
        locatorsJson:
          '[{"pageNumber":2,"startItemIndex":4,"endItemIndexExclusive":8}]',
      }),
    ]),
    capture: Object.freeze({
      state: "present",
      captureContract,
      observations: Object.freeze([
        Object.freeze({
          kindOrdinal: 2,
          kind: "requirement-assembly",
          payloadJson: '{"requirementId":"kec-requirement:001","text":"전선"}',
        }),
        Object.freeze({
          kindOrdinal: 2,
          kind: "requirement-assembly",
          payloadJson: '{"requirementId":"kec-requirement:002","text":"접지"}',
        }),
      ]),
    }),
    ...changes,
  });
}

function emptyDurableResult(): DurableResult {
  return durableResult({
    requirements: Object.freeze([]),
    capture: Object.freeze({
      state: "present",
      captureContract,
      observations: Object.freeze([]),
    }),
  });
}

function executionQuery(admissionSequence = 1): UnknownRecord {
  const binding = bindingFixture();
  return Object.freeze({
    sourceIdentity: binding.sourceRevision.sourceIdentity,
    revisionKey: binding.sourceRevision.revisionKey,
    blobAlgorithm: binding.blobHash.algorithm,
    blobDigest: binding.blobHash.digest,
    extractionContract,
    locatorSpace,
    admissionSequence,
  });
}

function receipt(
  commitment: UnknownRecord,
  admissionSequence = 1,
): UnknownRecord {
  return Object.freeze({
    ...executionQuery(admissionSequence),
    commitmentAlgorithm: commitment.algorithm,
    commitmentCodec: commitment.codec,
    commitmentDigest: commitment.digest,
  });
}

async function commitment(
  result: DurableResult,
  options: UnknownRecord = Object.freeze({
    algorithm: RESULT_COMMITMENT_ALGORITHM,
    codec: RESULT_COMMITMENT_CODEC,
  }),
): Promise<UnknownRecord> {
  const codec = await loadResultCommitmentCodec();
  const compute = requiredFunction(
    codec,
    "computeKecVerifiedExtractionResultCommitment",
  );
  const value = await invoke(compute, result, options);
  if (typeof value !== "object" || value === null) {
    throw new Error(
      "MISSING_TASK96_CONTRACT: commitment result is not an object",
    );
  }
  return value as UnknownRecord;
}

function isComplete(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const result = value as UnknownRecord;
  return (
    result.kind === "VERIFIED_EXECUTION_COMPLETE" ||
    result.status === "COMPLETE" ||
    result.realSourceObserved === true
  );
}

async function loadExecution(
  receipts: readonly UnknownRecord[],
  snapshotLoad: unknown,
): Promise<unknown> {
  const runtime = await loadKecSourceRuntime();
  return invoke(
    requiredFunction(runtime, "loadVerifiedExecution"),
    executionQuery(),
    {
      receiptStore: {
        findVerifiedExecutions: vi.fn(() => receipts),
      },
      snapshotStore: {
        loadSnapshotWithCapture: vi.fn(() => snapshotLoad),
      },
    },
  );
}

function runtimeDependencies(
  options: Readonly<{
    verdict?: unknown;
    result?: DurableResult;
    appendReceipt?: (value: unknown) => unknown;
    storeSnapshot?: (value: unknown) => unknown;
  }> = {},
) {
  const reference = referenceFixture();
  const result = options.result ?? durableResult();
  return {
    exactSourceBytes: new TextEncoder().encode("synthetic Task96 source bytes"),
    verifier: {
      verifyObservedBinding: vi.fn(async () =>
        options.verdict === undefined
          ? {
              kind: "BINDING_ADMITTED",
              effectiveAdmissionReferences: [reference],
            }
          : options.verdict,
      ),
    },
    task90: {
      extractExactBytes: vi.fn(async () => result),
    },
    receiptStore: {
      appendDerivedReceipt: vi.fn(options.appendReceipt ?? (() => undefined)),
      findVerifiedExecutions: vi.fn(() => []),
    },
    snapshotStore: {
      storeCapturedSnapshot: vi.fn(options.storeSnapshot ?? (() => undefined)),
      loadSnapshotWithCapture: vi.fn(() => ({
        status: "captured",
        durableResult: result,
      })),
    },
  };
}

async function runVerified(
  dependencies: ReturnType<typeof runtimeDependencies>,
  inputChanges: UnknownRecord = {},
): Promise<unknown> {
  const runtime = await loadKecSourceRuntime();
  return invoke(
    requiredFunction(runtime, "runVerifiedKecExtraction"),
    {
      projectRoot: "/synthetic/task96",
      sourceLocator: { scheme: "file", value: "fixture.pdf" },
      sourceRevision: sourceRevisionFixture(),
      ...inputChanges,
    },
    dependencies,
  );
}

async function failureOf(run: () => unknown | Promise<unknown>) {
  try {
    await run();
    return undefined;
  } catch (failure) {
    return failure;
  }
}

describe("Task96 V4 kec-source-runtime RED contracts", () => {
  family("P", async () => {
    const result = await loadExecution([], {
      status: "captured",
      durableResult: durableResult(),
    });
    expect(isComplete(result)).toBe(false);
  });

  family("AD", async () => {
    const result = await loadExecution([], {
      status: "captured",
      durableResult: durableResult(),
      currentAdmission: "BINDING_ADMITTED",
    });
    expect(isComplete(result)).toBe(false);
  });

  family("AE", async () => {
    const dependencies = runtimeDependencies();
    const result = await runVerified(dependencies);
    expect(isComplete(result)).toBe(true);
    expect(
      dependencies.receiptStore.appendDerivedReceipt,
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.snapshotStore.storeCapturedSnapshot,
    ).toHaveBeenCalledTimes(1);
    const written =
      dependencies.receiptStore.appendDerivedReceipt.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      sourceIdentity: sourceRevisionFixture().sourceIdentity,
      revisionKey: sourceRevisionFixture().revisionKey,
      admissionSequence: 1,
      commitmentAlgorithm: RESULT_COMMITMENT_ALGORITHM,
      commitmentCodec: RESULT_COMMITMENT_CODEC,
    });
  });

  family("AF", async () => {
    const committed = await commitment(durableResult());
    const historical = receipt(committed, 1);
    const verifyNow = vi.fn(() => ({
      kind: "BINDING_ADMITTED",
      effectiveAdmissionReferences: [referenceFixture(bindingFixture(), 2)],
    }));
    const result = await loadExecution([historical], {
      status: "captured",
      durableResult: durableResult(),
      verifyNow,
    });
    expect(isComplete(result)).toBe(true);
    expect(verifyNow).not.toHaveBeenCalled();
    expect(historical.admissionSequence).toBe(1);
  });

  family("AK", async () => {
    const committed = await commitment(durableResult());
    expect(
      isComplete(
        await loadExecution([receipt(committed)], { status: "not-found" }),
      ),
    ).toBe(false);
  });

  family("AL", async () => {
    expect(
      isComplete(
        await loadExecution([], {
          status: "captured",
          durableResult: durableResult(),
        }),
      ),
    ).toBe(false);
  });

  family("AM", async () => {
    const dependencies = runtimeDependencies({
      storeSnapshot: () => {
        throw new Error("simulated Task93 crash");
      },
    });
    const failure = await failureOf(() => runVerified(dependencies));
    if (failure instanceof Task96RedContractError) throw failure;
    expect(failure).toBeInstanceOf(Error);
    expect(
      dependencies.receiptStore.appendDerivedReceipt,
    ).toHaveBeenCalledTimes(1);
    expect(isComplete(await loadExecution([], { status: "not-found" }))).toBe(
      false,
    );
  });

  family("AN", async () => {
    const receipts: unknown[] = [];
    let snapshotPresent = false;
    const dependencies = runtimeDependencies({
      appendReceipt: (value) => {
        if (receipts.length === 0) receipts.push(value);
      },
      storeSnapshot: () => {
        snapshotPresent = true;
      },
    });
    await runVerified(dependencies);
    await runVerified(dependencies);
    expect(receipts).toHaveLength(1);
    expect(snapshotPresent).toBe(true);
  });

  family("AO", async () => {
    const legacy = Object.freeze({ creationEvent: "legacy-unverified" });
    const dependencies = runtimeDependencies({
      storeSnapshot: () => legacy,
    });
    const result = await runVerified(dependencies);
    expect(isComplete(result)).toBe(true);
    expect(
      dependencies.receiptStore.appendDerivedReceipt,
    ).toHaveBeenCalledTimes(1);
    expect(legacy).toEqual({ creationEvent: "legacy-unverified" });
  });

  family("AP", async () => {
    const runtime = await loadKecSourceRuntime();
    for (const writer of [
      "recordVerifiedExtraction",
      "appendVerificationReceipt",
      "saveVerifiedExecution",
      "appendReceipt",
    ]) {
      expect(runtime).not.toHaveProperty(writer);
    }
    const source = requiredText(
      task96Paths.kecSourceRuntimeEntrypoint,
      "MISSING_KEC_SOURCE_RUNTIME",
    );
    expect(source).not.toMatch(
      /export[\s\S]{0,100}(?:recordVerifiedExtraction|appendVerificationReceipt|saveVerifiedExecution|appendReceipt)/u,
    );
  });

  family("AQ", async () => {
    const creation = Object.freeze({ writer: "legacy", verified: false });
    const dependencies = runtimeDependencies({ storeSnapshot: () => creation });
    const result = await runVerified(dependencies);
    expect(isComplete(result)).toBe(true);
    expect(creation).toEqual({ writer: "legacy", verified: false });
  });

  family("AR", async () => {
    const semanticReceipts = new Map<string, unknown>();
    const dependencies = runtimeDependencies({
      appendReceipt: (value) => {
        const encoded = JSON.stringify(value);
        semanticReceipts.set(encoded, value);
      },
    });
    await Promise.all([runVerified(dependencies), runVerified(dependencies)]);
    expect(semanticReceipts.size).toBe(1);
  });

  family("AU", () => {
    const runtimeSource = requiredText(
      task96Paths.kecSourceRuntimeEntrypoint,
      "MISSING_KEC_SOURCE_RUNTIME",
    );
    const admissionSource = requiredText(
      task96Paths.sourceAdmissionEntrypoint,
      "MISSING_SOURCE_ADMISSION",
    );
    expect(runtimeSource).toMatch(
      /ExtractionContract|LocatorSpace|Receipt|Commitment/u,
    );
    expect(admissionSource).not.toMatch(
      /ExtractionContract|LocatorSpace|Requirement|Task9[03]|KEC|Receipt|Commitment/u,
    );
  });

  family("AV", async () => {
    for (const kind of [
      "BINDING_NOT_ADMITTED",
      "BINDING_WITHDRAWN",
      "BINDING_CONTRADICTION",
    ]) {
      const dependencies = runtimeDependencies({ verdict: { kind } });
      const result = await runVerified(dependencies);
      expect(result).toMatchObject({
        kind: "EXTRACTION_REFUSED",
        verdict: kind,
      });
      expect(
        dependencies.receiptStore.appendDerivedReceipt,
      ).not.toHaveBeenCalled();
      expect(
        dependencies.snapshotStore.storeCapturedSnapshot,
      ).not.toHaveBeenCalled();
    }

    const failed = runtimeDependencies();
    failed.verifier.verifyObservedBinding.mockRejectedValueOnce(
      new Error("repository unavailable"),
    );
    await expect(runVerified(failed)).rejects.toThrow("repository unavailable");
    expect(failed.receiptStore.appendDerivedReceipt).not.toHaveBeenCalled();
  });

  family("AW", async () => {
    const dependencies = runtimeDependencies({
      verdict: { kind: "BINDING_NOT_ADMITTED" },
    });
    const result = await runVerified(dependencies, {
      admissionReference: referenceFixture(bindingFixture(), 999),
    });
    expect(result).toMatchObject({
      kind: "EXTRACTION_REFUSED",
      verdict: "BINDING_NOT_ADMITTED",
    });
    expect(
      dependencies.receiptStore.appendDerivedReceipt,
    ).not.toHaveBeenCalled();
  });

  family("AX", () => {
    const manifest = requiredJson(
      task96Paths.kecSourceRuntimeManifest,
      "MISSING_KEC_SOURCE_RUNTIME",
    );
    expect(Object.keys((manifest.exports ?? {}) as object)).toEqual(["."]);
    expect(JSON.stringify(manifest.exports)).not.toMatch(
      /receiptStore|appendReceipt|internal/iu,
    );
  });

  family("AY", async () => {
    const newer = durableResult({
      requirements: [
        { ...durableResult().requirements[0]!, statement: "NEW statement" },
      ],
    });
    const old = durableResult({
      requirements: [
        { ...durableResult().requirements[0]!, statement: "OLD statement" },
      ],
    });
    const result = await loadExecution([receipt(await commitment(newer))], {
      status: "captured",
      durableResult: old,
    });
    expect(await commitment(old)).not.toEqual(await commitment(newer));
    expect(isComplete(result)).toBe(false);
  });

  family("AZ", async () => {
    const state = durableResult();
    const committed = await commitment(state);
    const result = await loadExecution([receipt(committed)], {
      status: "captured",
      durableResult: state,
    });
    expect(committed).toMatchObject({
      algorithm: RESULT_COMMITMENT_ALGORITHM,
      codec: RESULT_COMMITMENT_CODEC,
    });
    expect(isComplete(result)).toBe(true);
  });

  family("BA", async () => {
    const state = durableResult();
    const legacyCreation = Object.freeze({ writer: "legacy", verified: false });
    const dependencies = runtimeDependencies({
      result: state,
      storeSnapshot: () => legacyCreation,
    });
    expect(isComplete(await runVerified(dependencies))).toBe(true);
    expect(legacyCreation).toEqual({ writer: "legacy", verified: false });
  });

  family("BB", async () => {
    const committed = await commitment(emptyDurableResult());
    expect(committed).toMatchObject({
      algorithm: RESULT_COMMITMENT_ALGORITHM,
      codec: RESULT_COMMITMENT_CODEC,
    });
    expect(typeof committed.digest).toBe("string");
    expect((committed.digest as string).length).toBe(64);
  });

  family("BC", async () => {
    const expected = durableResult();
    const persisted = durableResult({
      requirements: [...durableResult().requirements].reverse(),
    });
    const result = await loadExecution([receipt(await commitment(expected))], {
      status: "captured",
      durableResult: persisted,
    });
    expect(isComplete(result)).toBe(false);
  });

  family("BD", async () => {
    const old = durableResult();
    const newer = durableResult({
      requirements: [
        { ...durableResult().requirements[0]!, statement: "NEW conflict" },
      ],
    });
    const newReceipt = receipt(await commitment(newer));
    const snapshotConflict = new Error("snapshot-conflict");
    const dependencies = runtimeDependencies({
      result: newer,
      storeSnapshot: () => {
        throw snapshotConflict;
      },
    });
    await expect(runVerified(dependencies)).rejects.toBe(snapshotConflict);
    await expect(runVerified(dependencies)).rejects.toBe(snapshotConflict);
    expect(
      isComplete(
        await loadExecution([newReceipt], {
          status: "captured",
          durableResult: old,
        }),
      ),
    ).toBe(false);
    expect(old.requirements[0]?.statement).not.toBe("NEW conflict");
  });

  family("BE", async () => {
    const empty = emptyDurableResult();
    const committed = await commitment(empty);
    expect(
      isComplete(
        await loadExecution([receipt(committed)], {
          status: "captured",
          durableResult: empty,
        }),
      ),
    ).toBe(true);
  });

  family("BF", async () => {
    const empty = emptyDurableResult();
    const committed = await commitment(empty);
    expect(
      isComplete(
        await loadExecution([receipt(committed)], {
          status: "capture-absent",
          durableResult: empty,
        }),
      ),
    ).toBe(false);
    expect(
      isComplete(
        await loadExecution([receipt(committed)], {
          status: "captured",
          durableResult: empty,
        }),
      ),
    ).toBe(true);
  });

  family("BG", async () => {
    const receiptModule = await import(
      /* @vite-ignore */ task96Paths.receiptStoreModule
    ).catch(() => undefined);
    if (receiptModule === undefined) {
      requiredText(
        task96Paths.receiptStoreModule,
        "MISSING_KEC_SOURCE_RUNTIME",
      );
      return;
    }
    const Constructor = receiptModule.SqliteVerifiedExecutionReceiptStore;
    expect(Constructor).toBeTypeOf("function");
    const directory = mkdtempSync(join(tmpdir(), "task96-receipt-"));
    try {
      const store = new Constructor(join(directory, "receipt.sqlite"));
      const first = receipt(await commitment(durableResult()));
      const second = { ...first, commitmentDigest: "f".repeat(64) };
      store.appendDerivedReceipt(first);
      expect(() => store.appendDerivedReceipt(second)).toThrow(/collision/iu);
      expect(store.findVerifiedExecutions(executionQuery())).toEqual([first]);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  family("BH", async () => {
    const receiptModule = await import(
      /* @vite-ignore */ task96Paths.receiptStoreModule
    ).catch(() => undefined);
    if (receiptModule === undefined) {
      requiredText(
        task96Paths.receiptStoreModule,
        "MISSING_KEC_SOURCE_RUNTIME",
      );
      return;
    }
    const directory = mkdtempSync(join(tmpdir(), "task96-receipt-"));
    try {
      const store = new receiptModule.SqliteVerifiedExecutionReceiptStore(
        join(directory, "receipt.sqlite"),
      );
      const committed = await commitment(durableResult());
      store.appendDerivedReceipt(receipt(committed, 1));
      store.appendDerivedReceipt(receipt(committed, 2));
      expect(store.findVerifiedExecutions(executionQuery())).toHaveLength(2);
      store.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  family("BI", async () => {
    const state = durableResult();
    const historical = await commitment(state, {
      algorithm: RESULT_COMMITMENT_ALGORITHM,
      codec: RESULT_COMMITMENT_CODEC,
      runtimeDefaultCodec: "kec:verified-extraction-result:v2",
    });
    expect(historical.codec).toBe(RESULT_COMMITMENT_CODEC);
    expect(historical).toEqual(await commitment(state));
  });

  family("BJ", async () => {
    await expect(
      commitment(durableResult(), {
        algorithm: "sha-512",
        codec: RESULT_COMMITMENT_CODEC,
      }),
    ).rejects.toThrow();
    await expect(
      commitment(durableResult(), {
        algorithm: RESULT_COMMITMENT_ALGORITHM,
        codec: "kec:verified-extraction-result:v999",
      }),
    ).rejects.toThrow();

    const malformedReceipt = {
      ...receipt(await commitment(durableResult())),
      commitmentDigest: "NOT-LOWERCASE-HEX",
    };
    expect(
      isComplete(
        await loadExecution([malformedReceipt], {
          status: "captured",
          durableResult: durableResult(),
        }),
      ),
    ).toBe(false);
  });

  family("BK", async () => {
    const base = durableResult();
    const variants = [
      durableResult({ requirements: [...base.requirements].reverse() }),
      durableResult({
        requirements: [
          {
            ...base.requirements[0]!,
            requirementId: "kec-requirement:changed",
          },
          base.requirements[1]!,
        ],
      }),
      durableResult({
        requirements: [
          { ...base.requirements[0]!, statement: "같은 ID, 다른 문장" },
          base.requirements[1]!,
        ],
      }),
      durableResult({
        requirements: [
          {
            ...base.requirements[0]!,
            locatorsJson:
              '[{"pageNumber":99,"startItemIndex":0,"endItemIndexExclusive":3}]',
          },
          base.requirements[1]!,
        ],
      }),
      durableResult({
        capture: {
          ...base.capture,
          captureContract: "kec:capture:v2",
        },
      }),
      durableResult({
        capture: {
          ...base.capture,
          observations: [...base.capture.observations].reverse(),
        },
      }),
      durableResult({
        capture: {
          ...base.capture,
          observations: [
            {
              ...base.capture.observations[0]!,
              kind: "suppressed-assembly",
              kindOrdinal: 1,
            },
            base.capture.observations[1]!,
          ],
        },
      }),
      durableResult({
        capture: {
          ...base.capture,
          observations: [
            {
              ...base.capture.observations[0]!,
              payloadJson: '{"text":"다른 payload"}',
            },
            base.capture.observations[1]!,
          ],
        },
      }),
    ];
    const baseline = await commitment(base);
    for (const variant of variants) {
      expect(await commitment(variant)).not.toEqual(baseline);
    }
  });

  family("BL", async () => {
    const sourceBlob = blobHashFixture();
    const resultCommitment = await commitment(durableResult());
    const otherContract = await commitment(
      durableResult({ extractionContract: "kec:contract:v2" }),
    );
    const otherLocatorSpace = await commitment(
      durableResult({ locatorSpace: "kec:locator:v2" }),
    );
    expect(resultCommitment.digest).not.toBe(sourceBlob.digest);
    expect(otherContract).not.toEqual(resultCommitment);
    expect(otherLocatorSpace).not.toEqual(resultCommitment);
  });

  it("[VECTOR] v1 commitment uses UTF-8 byte lengths and the frozen Korean vector", async () => {
    const committed = await commitment(durableResult());
    expect(Buffer.byteLength("전선은 보호하여야 한다", "utf8")).toBe(32);
    expect("전선은 보호하여야 한다".length).toBe(12);
    expect(committed).toEqual({
      algorithm: RESULT_COMMITMENT_ALGORITHM,
      codec: RESULT_COMMITMENT_CODEC,
      digest:
        "bf8558d24096790b550d6541ef76f4c5abfff3caffc08143e45261ecaa64c61e",
    });
  });

  it("[DETERMINISM] commitment ignores object insertion order and non-semantic runtime fields", async () => {
    const base = durableResult();
    const reordered = {
      capture: base.capture,
      requirements: base.requirements,
      locatorSpace: base.locatorSpace,
      extractionContract: base.extractionContract,
      snapshotId: 999,
      createdAt: "2099-01-01T00:00:00Z",
      randomNonce: "must-not-enter-the-payload",
    } as DurableResult;
    expect(await commitment(reordered)).toEqual(await commitment(base));
  });
});
