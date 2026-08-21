import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  TASK90_EXTRACTION_CONTRACT_ID,
  TASK90_LOCATOR_SPACE,
  TASK93_CAPTURE_CONTRACT_ID,
} from "./fixtures/sourceCaptureContracts.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceCapturePath = join(
  packageRoot,
  "src",
  "knowledge",
  "sourceCapture.ts",
);
const producerPath = join(
  packageRoot,
  "src",
  "knowledge",
  "requirementExtraction.ts",
);
const storeIndexPath = join(
  packageRoot,
  "src",
  "requirementSnapshot",
  "index.ts",
);
const productionTypesExist =
  existsSync(sourceCapturePath) &&
  /extractKecRequirementSnapshotWithCapture\b/u.test(
    readFileSync(producerPath, "utf8"),
  );

function importSpecifier(path: string): string {
  return JSON.stringify(path.replace(/\.ts$/u, ".js"));
}

function diagnosticsText(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    )
    .join("\n");
}

describe("Task93 source capture type RED gate", () => {
  it("fails explicitly until the branded production capture types exist", () => {
    expect(
      productionTypesExist,
      "Task93 branded source-capture types and producer are missing",
    ).toBe(true);
  });
});

describe.runIf(productionTypesExist)(
  "Task93 exact source capture type surface",
  () => {
    it("type-checks the discriminated union and future APIs exactly", () => {
      const root = mkdtempSync(join(tmpdir(), "voltai-task93-types-"));
      const fixturePath = join(root, "task93-contract.ts");
      const source = `
      import type {
        KecCapturedRequirementSnapshot,
        KecColumnGapRegionExcludedObservation,
        KecContextSearchTermination,
        KecRequirementAssemblyObservation,
        KecSourceCaptureContractId,
        KecSourceCaptureDetector,
        KecSourceCaptureFragment,
        KecSourceCaptureFragmentRole,
        KecSourceCaptureObservation,
        KecSourceCaptureSnapshot,
        KecSourceTextItemSpan,
        KecSuppressedAssemblyBlock,
        KecSuppressedAssemblyObservation,
      } from ${importSpecifier(sourceCapturePath)};
      import {
        extractKecRequirementSnapshotWithCapture,
        type ExtractKecRequirementsInput,
        type KecRequirementExtractionBinding,
        type KecRequirementExtractionSnapshot,
        type KecRequirementId,
      } from ${importSpecifier(producerPath)};
      import {
        KecRequirementSnapshotStore,
        migrateRequirementSnapshotSchemaToV2,
        type KecRequirementSnapshotErrorCategory,
      } from ${importSpecifier(storeIndexPath)};

      type Expect<Value extends true> = Value;
      type Equal<Left, Right> =
        (<Value>() => Value extends Left ? 1 : 2) extends
        (<Value>() => Value extends Right ? 1 : 2)
          ? ((<Value>() => Value extends Right ? 1 : 2) extends
              (<Value>() => Value extends Left ? 1 : 2) ? true : false)
          : false;

      type ContractIsOpaque = Expect<Equal<KecSourceCaptureContractId extends string ? true : false, true>>;
      type PlainStringIsNotContract = Expect<Equal<string extends KecSourceCaptureContractId ? true : false, false>>;
      type SpanIsExact = Expect<Equal<KecSourceTextItemSpan, {
        readonly pageNumber: number;
        readonly startItemIndex: number;
        readonly endItemIndexExclusive: number;
      }>>;
      type DetectorsAreExact = Expect<Equal<KecSourceCaptureDetector,
        "normative-sentence-ending" | "explicit-context-lead" | "short-heading-adjacent">>;
      type RolesAreExact = Expect<Equal<KecSourceCaptureFragmentRole,
        "normative-pattern-fragment" | "attached-context-fragment" | "unattached-context-candidate">>;
      type TerminationsAreExact = Expect<Equal<KecContextSearchTermination,
        "page-start" | "structural-region-boundary" | "preceding-normative-paragraph" | "preceding-non-context-candidate">>;
      type BlocksAreExact = Expect<Equal<KecSuppressedAssemblyBlock,
        "gap-not-positive" | "gap-above-window">>;
      type FragmentKeysAreExact = Expect<Equal<keyof KecSourceCaptureFragment,
        "role" | "span" | "observedText" | "detectors">>;
      type DetectorIsArray = Expect<Equal<KecSourceCaptureFragment["detectors"], readonly KecSourceCaptureDetector[]>>;
      type NoSingularDetector = Expect<Equal<Extract<keyof KecSourceCaptureFragment, "detector">, never>>;
      type ColumnKeys = Expect<Equal<keyof KecColumnGapRegionExcludedObservation,
        "kind" | "span" | "observedText">>;
      type SuppressedKeys = Expect<Equal<keyof KecSuppressedAssemblyObservation,
        "kind" | "fragments" | "blockingCandidate" | "blockedBy">>;
      type AssemblyKeys = Expect<Equal<keyof KecRequirementAssemblyObservation,
        "kind" | "requirementId" | "fragments" | "contextSearchTermination">>;
      type AssemblyUsesRequirementId = Expect<Equal<KecRequirementAssemblyObservation["requirementId"], KecRequirementId>>;
      type ObservationUnion = Expect<Equal<KecSourceCaptureObservation,
        KecColumnGapRegionExcludedObservation | KecSuppressedAssemblyObservation | KecRequirementAssemblyObservation>>;
      type ObservationKinds = Expect<Equal<KecSourceCaptureObservation["kind"],
        "column-gap-region-excluded" | "suppressed-assembly" | "requirement-assembly">>;
      type CaptureKeys = Expect<Equal<keyof KecSourceCaptureSnapshot,
        "binding" | "captureContract" | "observations">>;
      type CaptureBinding = Expect<Equal<KecSourceCaptureSnapshot["binding"], KecRequirementExtractionBinding>>;
      type PairedKeys = Expect<Equal<keyof KecCapturedRequirementSnapshot,
        "requirementSnapshot" | "captureSnapshot">>;
      type PairedRequirement = Expect<Equal<KecCapturedRequirementSnapshot["requirementSnapshot"], KecRequirementExtractionSnapshot>>;
      type Producer = Expect<Equal<typeof extractKecRequirementSnapshotWithCapture,
        (input: ExtractKecRequirementsInput) => Promise<KecCapturedRequirementSnapshot>>>;
      type Migration = Expect<Equal<typeof migrateRequirementSnapshotSchemaToV2,
        (dbPath: string) => void>>;
      type StoreWrite = Expect<Equal<KecRequirementSnapshotStore["storeCapturedSnapshot"],
        (snapshot: KecCapturedRequirementSnapshot) => void>>;
      type PairedLoad = Expect<Equal<KecRequirementSnapshotStore["loadSnapshotWithCapture"],
        (binding: KecRequirementExtractionBinding, captureContract: KecSourceCaptureContractId) =>
          | { readonly status: "not-found" }
          | { readonly status: "capture-absent"; readonly requirementSnapshot: KecRequirementExtractionSnapshot }
          | {
              readonly status: "captured";
              readonly requirementSnapshot: KecRequirementExtractionSnapshot;
              readonly captureSnapshot: KecSourceCaptureSnapshot;
            }>>;
      type LegacyWrite = Expect<Equal<KecRequirementSnapshotStore["storeSnapshot"],
        (snapshot: KecRequirementExtractionSnapshot) => void>>;
      type LegacyLoad = Expect<Equal<KecRequirementSnapshotStore["loadSnapshot"],
        (binding: KecRequirementExtractionBinding) => KecRequirementExtractionSnapshot | null>>;
      type LegacyClose = Expect<Equal<KecRequirementSnapshotStore["close"], () => void>>;
      type ErrorCategories = Expect<Equal<KecRequirementSnapshotErrorCategory,
        | "binding-mismatch"
        | "unsupported-locator-space"
        | "snapshot-conflict"
        | "locator-encode"
        | "locator-decode"
        | "member-corruption"
        | "schema"
        | "storage"
        | "closed"
        | "capture-invalid"
        | "capture-conflict"
        | "capture-corruption"
        | "capture-unsupported-schema">>;

      export type Task93Checks =
        | ContractIsOpaque | PlainStringIsNotContract | SpanIsExact
        | DetectorsAreExact | RolesAreExact | TerminationsAreExact | BlocksAreExact
        | FragmentKeysAreExact | DetectorIsArray | NoSingularDetector
        | ColumnKeys | SuppressedKeys | AssemblyKeys | AssemblyUsesRequirementId
        | ObservationUnion | ObservationKinds | CaptureKeys | CaptureBinding
        | PairedKeys | PairedRequirement | Producer | Migration | StoreWrite
        | PairedLoad | LegacyWrite | LegacyLoad | LegacyClose | ErrorCategories;
    `;
      writeFileSync(fixturePath, source);
      try {
        const program = ts.createProgram({
          rootNames: [fixturePath],
          options: {
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            customConditions: ["voltai-source"],
          },
        });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        expect(diagnostics, diagnosticsText(diagnostics)).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("keeps frozen capture, extraction, and locator identifiers independent", async () => {
      const sourceCapture = (await import(
        /* @vite-ignore */ fileURLToPath(
          new URL("../src/knowledge/sourceCapture.ts", import.meta.url),
        )
      )) as { readonly KEC_SOURCE_CAPTURE_CONTRACT_ID: string };
      const extraction = (await import(
        /* @vite-ignore */ fileURLToPath(
          new URL("../src/knowledge/requirementExtraction.ts", import.meta.url),
        )
      )) as {
        readonly KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID: string;
        readonly KEC_REQUIREMENT_LOCATOR_SPACE: string;
      };
      expect(sourceCapture.KEC_SOURCE_CAPTURE_CONTRACT_ID).toBe(
        TASK93_CAPTURE_CONTRACT_ID,
      );
      expect(extraction.KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID).toBe(
        TASK90_EXTRACTION_CONTRACT_ID,
      );
      expect(extraction.KEC_REQUIREMENT_LOCATOR_SPACE).toBe(
        TASK90_LOCATOR_SPACE,
      );
    });
  },
);
