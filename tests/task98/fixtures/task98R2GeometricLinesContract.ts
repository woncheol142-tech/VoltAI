import {
  r1TechnicalInput,
  SYNTHETIC_FONT_STYLES,
  syntheticPdfTextItem,
  type SyntheticPdfTextItem,
} from "./task98R1GlyphProvenanceContract.js";

export { SYNTHETIC_FONT_STYLES };

export type Task98R2FrozenFamily = "R2-A" | "R2-F" | "R2-V" | "R2-W" | "R2-Y";

export type Task98R2SliceLocalFamily = "R2-I" | "R2-B" | "R2-G";
export type Task98R2RedFamily = Task98R2FrozenFamily | Task98R2SliceLocalFamily;

export type Task98R2RedContract = Readonly<{
  source: "FROZEN_V1" | "SLICE_LOCAL_V1_1";
  purpose: string;
  observableExpectation: string;
  currentFailureMeaning: string;
  falseRedCondition: string;
}>;

export const TASK98_R2_RED_CONTRACTS = Object.freeze({
  "R2-A": {
    source: "FROZEN_V1",
    purpose: "baseline-separated geometric lines and ordinary continuation",
    observableExpectation:
      "two baselines yield two lines while obvious same-line fragments remain one run, independent of hasEOL",
    currentFailureMeaning:
      "the R1-only result exposes no geometric line or continuation structure",
    falseRedCondition:
      "the test asks for a semantic block, paragraph gap, indentation, or emitted line text",
  },
  "R2-F": {
    source: "FROZEN_V1",
    purpose: "prevent the confirmed same-baseline confident false merge",
    observableExpectation:
      "each of the 11 measured precursor shapes is one baseline line with separate runs and a SEPARATED boundary",
    currentFailureMeaning:
      "separate geometric content has no R2 run boundary representation",
    falseRedCondition:
      "the test assigns columns, lanes, cells, requirement recovery, or a numeric threshold",
  },
  "R2-V": {
    source: "FROZEN_V1",
    purpose: "unique-parent script attachment and competing-parent ambiguity",
    observableExpectation:
      "a unique local geometric parent receives a displacement attachment while competing parents leave the item unplaced",
    currentFailureMeaning:
      "the R1-only result has neither a script channel nor geometric ambiguity disposition",
    falseRedCondition:
      "the test assigns exponent, footnote, degree, unit, or other semantic meaning",
  },
  "R2-W": {
    source: "FROZEN_V1",
    purpose:
      "projected-axis ordering and attachment independent of emission order",
    observableExpectation:
      "content and bridge members are ordered by projected geometry and the raised item attaches without text projection",
    currentFailureMeaning:
      "the R1-only result preserves emission order but exposes no ordered run",
    falseRedCondition:
      "the test constructs a unit-expression string or relies on source emission order",
  },
  "R2-Y": {
    source: "FROZEN_V1",
    purpose:
      "deterministic result enumeration with raw classification precedence",
    observableExpectation:
      "repeated results are structurally equal, ties end in originalItemIndex, and quantized ties do not erase raw distinctions",
    currentFailureMeaning:
      "the R1-only result exposes no R2 collections whose enumeration or membership can be observed",
    falseRedCondition:
      "the test claims page reading order, byte serialization identity, or cross-parser-version determinism",
  },
  "R2-I": {
    source: "SLICE_LOCAL_V1_1",
    purpose:
      "single-disposition conservation and non-transitive baseline bands",
    observableExpectation:
      "retained indices occur exactly once without rebasing and an A-near-B-near-C chain does not become one band",
    currentFailureMeaning:
      "the R1-only result provides no R2 disposition or anchor-bounded band outcome",
    falseRedCondition:
      "the test requires rejected items as members, contiguous indices, or a specific clustering algorithm",
  },
  "R2-B": {
    source: "SLICE_LOCAL_V1_1",
    purpose: "bridge non-merge, projected gap, and conservative ambiguity",
    observableExpectation:
      "a locally unresolved same-baseline boundary becomes separate runs with UNCERTAIN_CONTINUITY regardless of whitespace width",
    currentFailureMeaning:
      "the R1-only result cannot preserve an uncertain geometric boundary",
    falseRedCondition:
      "the test labels either side as a column or freezes T_join, T_split, 1.5x, or 3x",
  },
  "R2-G": {
    source: "SLICE_LOCAL_V1_1",
    purpose: "fail-closed orientation disposition",
    observableExpectation:
      "unsupported horizontal orientations are unplaced with exact provenance while supported skew remains placeable",
    currentFailureMeaning:
      "the R1-only result has no R2 unplaced-orientation channel",
    falseRedCondition:
      "the test demands vertical-text support or asserts real-source orientation incidence",
  },
}) satisfies Readonly<Record<Task98R2RedFamily, Task98R2RedContract>>;

export const TASK98_R2_FROZEN_FAMILIES = Object.freeze([
  "R2-A",
  "R2-F",
  "R2-V",
  "R2-W",
  "R2-Y",
] as const satisfies readonly Task98R2FrozenFamily[]);

export const TASK98_R2_SLICE_LOCAL_FAMILIES = Object.freeze([
  "R2-I",
  "R2-B",
  "R2-G",
] as const satisfies readonly Task98R2SliceLocalFamily[]);

export const TASK98_R2_SCALE_CIRCULARITY_RATIONALE =
  "R2-A mixes intrinsic scales inside obvious continuations; the expected membership is stable without asserting call order or a private median implementation";

export const TASK98_R2_PRECISION_CASE_IDS = Object.freeze([
  "G105",
  "G106",
  "G107",
  "G108",
  "G109",
  "G110",
  "G111",
  "G112",
  "G116",
  "G117",
  "G119",
] as const);

type GeometricItemOptions = Readonly<{
  token: string;
  x: number;
  baseline: number;
  width?: number;
  scale?: number;
  height?: number;
  hasEOL?: boolean;
  b?: number;
  c?: number;
}>;

export function geometricItem({
  token,
  x,
  baseline,
  width = 10,
  scale = 10,
  height = scale,
  hasEOL = false,
  b = 0,
  c = 0,
}: GeometricItemOptions): SyntheticPdfTextItem {
  return syntheticPdfTextItem({
    str: token,
    transform: Object.freeze([scale, b, c, scale, x, baseline]),
    width,
    height,
    hasEOL,
  });
}

export function r2TechnicalInput(maxTextItemsPerPage = 128) {
  return r1TechnicalInput(undefined, {
    maxPages: 1,
    maxTextItemsPerPage,
  });
}

export function lineContinuationItems(hasEOL: boolean) {
  return Object.freeze([
    geometricItem({ token: "a0", x: 10, baseline: 100, width: 10, hasEOL }),
    geometricItem({
      token: "a1",
      x: 21,
      baseline: 100,
      width: 10,
      scale: 5,
    }),
    geometricItem({ token: "b0", x: 10, baseline: 80, width: 10 }),
    geometricItem({ token: "b1", x: 21, baseline: 80, width: 10, scale: 5 }),
  ]);
}

const PRECISION_GAPS = Object.freeze({
  G105: 118.1,
  G106: 128.4,
  G107: 162.1,
  G108: 172.3,
  G109: 177.1,
  G110: 105.8,
  G111: 181.8,
  G112: 141,
  G116: 77.3,
  G117: 93.2,
  G119: 112.6,
} satisfies Readonly<
  Record<(typeof TASK98_R2_PRECISION_CASE_IDS)[number], number>
>);

export const TASK98_R2_PRECISION_FIXTURES = Object.freeze(
  TASK98_R2_PRECISION_CASE_IDS.map((caseId, caseIndex) => {
    const gap = PRECISION_GAPS[caseId];
    const baseline = 100 + caseIndex;
    return Object.freeze({
      caseId,
      sourcePageLocator: Object.freeze({ pageNumber: caseIndex + 1 }),
      expectedRecallOwner: "S3" as const,
      expectedR2Outcome: "SEPARATE_CONFIDENT_RUNS" as const,
      items: Object.freeze([
        geometricItem({ token: `l${caseIndex}`, x: 10, baseline, width: 10 }),
        geometricItem({
          token: " ",
          x: 24,
          baseline,
          width: gap * 5,
          height: 0,
        }),
        geometricItem({
          token: `r${caseIndex}`,
          x: 20 + gap,
          baseline,
          width: 10,
        }),
      ]),
    });
  }),
);

export function ambiguousBridgeItems(declaredWhitespaceWidth: number) {
  return Object.freeze([
    geometricItem({ token: "p", x: 10, baseline: 100, width: 10 }),
    geometricItem({
      token: " ",
      x: 21,
      baseline: 100,
      width: declaredWhitespaceWidth,
      height: 0,
    }),
    geometricItem({ token: "q", x: 31, baseline: 100, width: 10 }),
  ]);
}

export const BASELINE_CHAIN_ITEMS = Object.freeze([
  geometricItem({ token: "a", x: 10, baseline: 101, width: 5, scale: 1 }),
  { str: "malformed-retention-hole" },
  geometricItem({ token: "b", x: 20, baseline: 100.5, width: 5, scale: 1 }),
  geometricItem({ token: "c", x: 30, baseline: 100, width: 5, scale: 1 }),
]);

export const UNIQUE_SCRIPT_ITEMS = Object.freeze([
  geometricItem({ token: "parent", x: 20, baseline: 100, width: 20 }),
  geometricItem({ token: "tiny", x: 29, baseline: 96, width: 4, scale: 5 }),
  geometricItem({ token: "remote", x: 20, baseline: 60, width: 20 }),
]);

export const AMBIGUOUS_SCRIPT_ITEMS = Object.freeze([
  geometricItem({ token: "left", x: 10, baseline: 100, width: 8 }),
  geometricItem({ token: "right", x: 30, baseline: 100, width: 8 }),
  geometricItem({ token: "tiny", x: 24, baseline: 104, width: 4, scale: 5 }),
]);

export const PROJECTED_ORDER_ITEMS = Object.freeze([
  geometricItem({ token: "raised", x: 44, baseline: 104, width: 4, scale: 5 }),
  geometricItem({ token: "unit", x: 32, baseline: 100, width: 10 }),
  geometricItem({ token: "number", x: 10, baseline: 100, width: 20 }),
  geometricItem({
    token: " ",
    x: 31,
    baseline: 100,
    width: 1_000,
    height: 0,
  }),
]);

export const DETERMINISTIC_TIE_ITEMS = Object.freeze([
  geometricItem({ token: "tie-0", x: 10.0004, baseline: 100, width: 4 }),
  geometricItem({ token: "tie-1", x: 10.0004, baseline: 100, width: 4 }),
  geometricItem({
    token: "raw-rotation",
    x: 10.0004,
    baseline: 100,
    width: 4,
    b: 0.25,
  }),
]);

export const ORIENTATION_ITEMS = Object.freeze([
  geometricItem({ token: "rotated", x: 10, baseline: 100, b: 0.25 }),
  geometricItem({ token: "non-positive", x: 20, baseline: 90, scale: -1 }),
  geometricItem({ token: "zero-axis", x: 30, baseline: 80, scale: 0 }),
  geometricItem({ token: "supported-skew", x: 40, baseline: 70, c: 2 }),
]);
