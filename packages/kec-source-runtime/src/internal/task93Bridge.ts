import { readFile } from "node:fs/promises";

import type { SourceBlobHash, SourceRevision } from "@voltai/source-core";

import type {
  KecDurableVerifiedResult,
  KecVerifiedExecutionReceipt,
  RuntimeBindingVerdict,
  VerifiedKecExtractionInput,
} from "../types.js";

interface CapturedRequirement {
  readonly requirement: Readonly<{
    readonly id: string;
    readonly statement: string;
  }>;
  readonly provenance: Readonly<{
    readonly locators: readonly unknown[];
  }>;
}

interface CapturedObservation {
  readonly kind: string;
}

interface CapturedSnapshot {
  readonly requirementSnapshot: Readonly<{
    readonly binding: Task93Binding;
    readonly requirements: readonly CapturedRequirement[];
  }>;
  readonly captureSnapshot: Readonly<{
    readonly binding: Task93Binding;
    readonly captureContract: string;
    readonly observations: readonly CapturedObservation[];
  }>;
}

interface Task93Binding {
  readonly sourceRevision: SourceRevision;
  readonly blobHash: SourceBlobHash;
  readonly extractionContract: string;
  readonly locatorSpace: string;
}

type Task93Load =
  | Readonly<{ readonly status: "not-found" }>
  | Readonly<{
      readonly status: "capture-absent";
      readonly requirementSnapshot: CapturedSnapshot["requirementSnapshot"];
    }>
  | Readonly<{
      readonly status: "captured";
      readonly requirementSnapshot: CapturedSnapshot["requirementSnapshot"];
      readonly captureSnapshot: CapturedSnapshot["captureSnapshot"];
    }>;

interface Task93Store {
  storeCapturedSnapshot(snapshot: CapturedSnapshot): void;
  loadSnapshotWithCapture(
    binding: Task93Binding,
    captureContract: string,
  ): Task93Load;
  close(): void;
}

interface RequirementExtractionModule {
  extractKecRequirementSnapshotWithCapture(
    input: VerifiedKecExtractionInput,
    verifier: Readonly<{
      verifyObservedBinding(
        binding: Readonly<{
          sourceRevision: SourceRevision;
          blobHash: SourceBlobHash;
        }>,
      ): RuntimeBindingVerdict | Promise<RuntimeBindingVerdict>;
    }>,
  ): Promise<CapturedSnapshot>;
}

interface TechnicalExtractionResult {
  readonly byteIdentity: SourceBlobHash & Readonly<{ byteLength: number }>;
  readonly sourceContext: SourceRevision;
  readonly extractionContract: string;
  readonly locatorSpace: string;
  readonly captureContract: string;
  readonly requirements: readonly [];
  readonly observations: readonly [];
}

interface TechnicalExtractionModule {
  readonly KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID: string;
  extractKecV2Technical(
    input: Readonly<{
      exactBytes: Uint8Array;
      sourceContext: SourceRevision;
      extractionContract: string;
      mappingRegistry: Readonly<{ version: string; digest: string }>;
      resourceLimits: Readonly<{
        maxPages: number;
        maxTextItemsPerPage: number;
      }>;
    }>,
  ): Promise<TechnicalExtractionResult>;
}

interface ProjectPathModule {
  assertProjectRoot(projectRoot: string): string;
  resolveKecPdfPath(projectRoot: string, relativePath: string): string;
}

interface Task93StoreModule {
  readonly KecRequirementSnapshotStore: new (dbPath: string) => Task93Store;
}

interface LocatorCodecModule {
  encodeKecRequirementLocators(locators: readonly unknown[]): string;
}

interface CaptureCodecModule {
  encodeKecSourceCaptureObservation(observation: CapturedObservation): string;
}

interface CaptureSemanticsModule {
  readonly KEC_SOURCE_CAPTURE_CONTRACT_ID: string;
}

interface Task93Modules {
  readonly extraction: RequirementExtractionModule;
  readonly technicalExtraction: TechnicalExtractionModule;
  readonly projectPath: ProjectPathModule;
  readonly store: Task93StoreModule;
  readonly locatorCodec: LocatorCodecModule;
  readonly captureCodec: CaptureCodecModule;
  readonly captureSemantics: CaptureSemanticsModule;
}

let modulesPromise: Promise<Task93Modules> | undefined;

function mcpKecModule(path: string): string {
  const sourceTree = import.meta.url.includes("/src/");
  const tree = sourceTree ? "src" : "dist";
  const extension = sourceTree ? "ts" : "js";
  return new URL(
    `../../../mcp-kec/${tree}/${path}.${extension}`,
    import.meta.url,
  ).href;
}

async function loadTask93Modules(): Promise<Task93Modules> {
  modulesPromise ??= Promise.all([
    import(mcpKecModule("knowledge/requirementExtraction")),
    import(mcpKecModule("technicalExtractionV2/technicalExtraction")),
    import(mcpKecModule("knowledge/projectPath")),
    import(mcpKecModule("requirementSnapshot/store")),
    import(mcpKecModule("requirementSnapshot/locatorCodec")),
    import(mcpKecModule("requirementSnapshot/captureCodec")),
    import(mcpKecModule("knowledge/sourceCapture")),
  ]).then(
    ([
      extraction,
      technicalExtraction,
      projectPath,
      store,
      locatorCodec,
      captureCodec,
      captureSemantics,
    ]) =>
      ({
        extraction,
        technicalExtraction,
        projectPath,
        store,
        locatorCodec,
        captureCodec,
        captureSemantics,
      }) as Task93Modules,
  );
  return modulesPromise;
}

function observationKindOrdinal(kind: string): number {
  switch (kind) {
    case "column-gap-region-excluded":
      return 0;
    case "suppressed-assembly":
      return 1;
    case "requirement-assembly":
      return 2;
    default:
      throw new TypeError(`unsupported capture observation kind: ${kind}`);
  }
}

function bindingFromReceipt(
  receipt: KecVerifiedExecutionReceipt,
): Task93Binding {
  return Object.freeze({
    sourceRevision: Object.freeze({
      sourceIdentity: receipt.sourceIdentity,
      revisionKey: receipt.revisionKey,
    }) as SourceRevision,
    blobHash: Object.freeze({
      algorithm: receipt.blobAlgorithm,
      digest: receipt.blobDigest,
    }),
    extractionContract: receipt.extractionContract,
    locatorSpace: receipt.locatorSpace,
  });
}

export class Task93Bridge {
  private constructor(
    private readonly modules: Task93Modules,
    private readonly store: Task93Store,
  ) {}

  static async open(dbPath: string): Promise<Task93Bridge> {
    const modules = await loadTask93Modules();
    return new Task93Bridge(
      modules,
      new modules.store.KecRequirementSnapshotStore(dbPath),
    );
  }

  async extract(
    input: VerifiedKecExtractionInput,
    verifier: Parameters<
      RequirementExtractionModule["extractKecRequirementSnapshotWithCapture"]
    >[1],
  ): Promise<CapturedSnapshot> {
    return this.modules.extraction.extractKecRequirementSnapshotWithCapture(
      input,
      verifier,
    );
  }

  async acquireExactBytes(
    input: VerifiedKecExtractionInput,
  ): Promise<Uint8Array> {
    if (input.sourceLocator.scheme !== "file") {
      throw new Error("Task96 supports only file source locators");
    }
    const projectRoot = this.modules.projectPath.assertProjectRoot(
      input.projectRoot,
    );
    const absolutePath = this.modules.projectPath.resolveKecPdfPath(
      projectRoot,
      input.sourceLocator.value,
    );
    return new Uint8Array(await readFile(absolutePath));
  }

  async extractKecV2Technical(
    exactBytes: Uint8Array,
    input: VerifiedKecExtractionInput,
  ): Promise<TechnicalExtractionResult> {
    return this.modules.technicalExtraction.extractKecV2Technical({
      exactBytes,
      sourceContext: input.sourceRevision,
      extractionContract:
        this.modules.technicalExtraction
          .KEC_V2_TECHNICAL_EXTRACTION_CONTRACT_ID,
      mappingRegistry: Object.freeze({
        version: "task98:r0:identity-mapping:v1",
        digest: "0".repeat(64),
      }),
      resourceLimits: Object.freeze({
        maxPages: 10_000,
        maxTextItemsPerPage: 1_000_000,
      }),
    });
  }

  storeCapturedSnapshot(snapshot: CapturedSnapshot): void {
    this.store.storeCapturedSnapshot(snapshot);
  }

  loadSnapshotWithCapture(receipt: KecVerifiedExecutionReceipt): Task93Load {
    return this.store.loadSnapshotWithCapture(
      bindingFromReceipt(receipt),
      this.modules.captureSemantics.KEC_SOURCE_CAPTURE_CONTRACT_ID,
    );
  }

  durableResult(snapshot: CapturedSnapshot): KecDurableVerifiedResult {
    return Object.freeze({
      extractionContract:
        snapshot.requirementSnapshot.binding.extractionContract,
      locatorSpace: snapshot.requirementSnapshot.binding.locatorSpace,
      requirements: Object.freeze(
        snapshot.requirementSnapshot.requirements.map((member) =>
          Object.freeze({
            requirementId: member.requirement.id,
            statement: member.requirement.statement,
            locatorsJson:
              this.modules.locatorCodec.encodeKecRequirementLocators(
                member.provenance.locators,
              ),
          }),
        ),
      ),
      capture: Object.freeze({
        state: "present" as const,
        captureContract: snapshot.captureSnapshot.captureContract,
        observations: Object.freeze(
          snapshot.captureSnapshot.observations.map((observation) =>
            Object.freeze({
              kindOrdinal: observationKindOrdinal(observation.kind),
              kind: observation.kind,
              payloadJson:
                this.modules.captureCodec.encodeKecSourceCaptureObservation(
                  observation,
                ),
            }),
          ),
        ),
      }),
    });
  }

  close(): void {
    this.store.close();
  }
}

export type { CapturedSnapshot, Task93Load, TechnicalExtractionResult };
