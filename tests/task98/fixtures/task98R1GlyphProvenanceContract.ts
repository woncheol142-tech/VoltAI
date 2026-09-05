import type {
  ExtractKecV2TechnicalInput,
  KecV2MappingRegistry,
} from "../../../packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.js";
import type { SourceRevision } from "../../../packages/source-core/src/index.js";
import { deterministicKoreanPdfBytes } from "../../../packages/mcp-kec/test/fixtures/requirementExtractionContracts.js";

export type Task98R1IntentionalRedFamily =
  "R1-T" | "R1-U" | "R1-V" | "R1-W" | "R1-X" | "R1-AH" | "R1-I" | "R1-N";

export type Task98R1RedContract = Readonly<{
  expectedCurrentFailure: string;
  failureMeaning: string;
  targetGreenBehavior: string;
  falseRedCondition: string;
}>;

export const TASK98_R1_RED_CONTRACTS = Object.freeze({
  "R1-T": {
    expectedCurrentFailure:
      "the V2 result has no raw-item output, glyph state, or font evidence",
    failureMeaning:
      "an unknown private-use code point can pass through without explicit unresolved provenance",
    targetGreenBehavior:
      "retain the exact raw code point and font evidence as UNRESOLVED_PUA without substitution or extraction failure",
    falseRedCondition:
      "the fixture is invalid, demands downstream promotion behavior, or expects a real-source semantic mapping",
  },
  "R1-U": {
    expectedCurrentFailure:
      "the V2 registry accepts identity only and exposes no font-scoped mapping result",
    failureMeaning:
      "a supplied synthetic mapping cannot be applied mechanically and audited without losing raw text",
    targetGreenBehavior:
      "apply a mapping only for an exact derived-font-fingerprint and source-code-point match and retain complete mapping evidence",
    falseRedCondition:
      "the test freezes a fingerprint algorithm, requires a production mapping, or treats mapping as authority",
  },
  "R1-V": {
    expectedCurrentFailure:
      "the V2 result discards separately positioned source items",
    failureMeaning:
      "a small offset glyph loses its independent source identity and exact raw geometry",
    targetGreenBehavior:
      "retain both source items independently with original indices, raw text, font evidence, glyph state, and raw geometry",
    falseRedCondition:
      "the test requires grouping, attachment, or any ordering other than parser emission order",
  },
  "R1-W": {
    expectedCurrentFailure:
      "the V2 result has no retained items, including no zero-height whitespace bridge",
    failureMeaning:
      "structurally valid but geometrically unusual source evidence can disappear before downstream processing",
    targetGreenBehavior:
      "retain number, whitespace, unit, and raised-glyph items independently without interpreting their relationship",
    falseRedCondition:
      "the test constructs a unit expression, assigns semantic membership, or makes a promotion decision",
  },
  "R1-X": {
    expectedCurrentFailure:
      "the V2 result exposes no original PDFJS item-index coordinate space",
    failureMeaning:
      "later technical provenance cannot locate items in the untouched parser emission sequence",
    targetGreenBehavior:
      "preserve unique page-scoped originalItemIndex values in exact parser emission order",
    falseRedCondition:
      "the test asks for assembled locator spans or durable cross-parser identity",
  },
  "R1-AH": {
    expectedCurrentFailure:
      "the V2 result has no raw-item anomaly or rejection channel",
    failureMeaning:
      "malformed or non-finite raw geometry can disappear or poison later processing without a typed outcome",
    targetGreenBehavior:
      "produce deterministic typed raw-geometry anomalies with original item identity while retaining unusual valid geometry",
    falseRedCondition:
      "the test rejects geometry for visual meaning, asserts measured real-source incidence, or requires downstream capture projection",
  },
  "R1-I": {
    expectedCurrentFailure:
      "the V2 result discards all source items and cannot account for a rejected eligible text item",
    failureMeaning:
      "an eligible text item can disappear silently and later retained items can be rebased",
    targetGreenBehavior:
      "each eligible text item is either retained at its original index or represented by an explicit typed anomaly at that same index",
    falseRedCondition:
      "the test requires non-text parser markers to become RawTextItems or changes the legacy V1 path",
  },
  "R1-N": {
    expectedCurrentFailure:
      "the V2 result has no separately addressable raw and semantic representations",
    failureMeaning:
      "technical transformation can erase the source string or alter raw geometry",
    targetGreenBehavior:
      "preserve exact raw text and raw doubles beside a provenance-backed semantic mapping that differs from raw text",
    falseRedCondition:
      "the fixture is unchanged Unicode, silently adds normalization policy, or duplicates a production transformation algorithm",
  },
}) satisfies Readonly<
  Record<Task98R1IntentionalRedFamily, Task98R1RedContract>
>;

export type SyntheticPdfTextItem = Readonly<{
  str: string;
  dir: string;
  transform: readonly number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}>;

export function syntheticPdfTextItem(
  overrides: Partial<SyntheticPdfTextItem> = {},
): SyntheticPdfTextItem {
  return Object.freeze({
    str: "synthetic",
    dir: "ltr",
    transform: Object.freeze([1, 0, 0, 1, 10, 20]),
    width: 8,
    height: 10,
    fontName: "task98-font-a",
    hasEOL: false,
    ...overrides,
  });
}

export const SYNTHETIC_FONT_STYLES = Object.freeze({
  "task98-font-a": Object.freeze({
    fontFamily: "Task98 Synthetic A",
    ascent: 0.8,
    descent: -0.2,
    vertical: false,
  }),
  "task98-font-b": Object.freeze({
    fontFamily: "Task98 Synthetic B",
    ascent: 0.75,
    descent: -0.25,
    vertical: false,
  }),
});

export const TASK98_R1_SOURCE_CONTEXT = Object.freeze({
  sourceIdentity: "diag:kec:task98:r1:synthetic-source",
  revisionKey: "diag:kec:task98:r1:synthetic-revision",
}) as SourceRevision;

export const EMPTY_TEST_MAPPING_REGISTRY = Object.freeze({
  version: "task98:r1:synthetic-empty:v1",
  digest: "0".repeat(64),
}) satisfies KecV2MappingRegistry;

export function r1TechnicalInput(
  mappingRegistry: Readonly<
    Record<string, unknown>
  > = EMPTY_TEST_MAPPING_REGISTRY,
  resourceLimits: Readonly<{
    maxPages: number;
    maxTextItemsPerPage: number;
  }> = Object.freeze({ maxPages: 8, maxTextItemsPerPage: 64 }),
): ExtractKecV2TechnicalInput {
  return {
    exactBytes: deterministicKoreanPdfBytes("Task98 R1 synthetic parser seam"),
    sourceContext: TASK98_R1_SOURCE_CONTEXT,
    extractionContract: "kec:pdfjs-geometry-semantic-requirements:v2",
    mappingRegistry,
    resourceLimits,
  } as unknown as ExtractKecV2TechnicalInput;
}
