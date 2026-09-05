import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { extractKecV2Technical } from "../../packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.js";
import {
  AMBIGUOUS_SCRIPT_ITEMS,
  ambiguousBridgeItems,
  BASELINE_CHAIN_ITEMS,
  DETERMINISTIC_TIE_ITEMS,
  lineContinuationItems,
  ORIENTATION_ITEMS,
  PROJECTED_ORDER_ITEMS,
  r2TechnicalInput,
  SYNTHETIC_FONT_STYLES,
  TASK98_R2_FROZEN_FAMILIES,
  TASK98_R2_PRECISION_CASE_IDS,
  TASK98_R2_PRECISION_FIXTURES,
  TASK98_R2_RED_CONTRACTS,
  TASK98_R2_SCALE_CIRCULARITY_RATIONALE,
  TASK98_R2_SLICE_LOCAL_FAMILIES,
  UNIQUE_SCRIPT_ITEMS,
} from "./fixtures/task98R2GeometricLinesContract.js";
import {
  deepKeys,
  lineMemberIndices,
  observeR2Page,
  primaryDispositionIndices,
  technicalAnomalies,
  technicalItems,
  type Task98R2ObservedPage,
} from "./helpers/task98R2GeometricLinesHarness.js";
import { installTask98PdfJsTextContentHarness } from "./helpers/task98PdfJsTextContentHarness.js";

const pdfjsHarness = {
  pages: [] as Array<{
    items: readonly unknown[];
    styles: Readonly<Record<string, unknown>>;
  }>,
  textContentCalls: [] as number[],
};

let restorePdfJsHarness: (() => void) | undefined;

beforeAll(async () => {
  restorePdfJsHarness =
    await installTask98PdfJsTextContentHarness(pdfjsHarness);
});

afterAll(() => {
  restorePdfJsHarness?.();
});

beforeEach(() => {
  pdfjsHarness.pages = [];
  pdfjsHarness.textContentCalls = [];
});

async function extract(items: readonly unknown[]) {
  pdfjsHarness.pages = [{ items, styles: SYNTHETIC_FONT_STYLES }];
  return extractKecV2Technical(r2TechnicalInput());
}

function memberPartitions(page: Task98R2ObservedPage) {
  return page.lines.map(lineMemberIndices);
}

function scriptSummaries(page: Task98R2ObservedPage) {
  return page.lines.flatMap((line, lineIndex) =>
    line.runs.flatMap((run, runIndex) =>
      run.scripts.map((script) => ({
        lineIndex,
        runIndex,
        originalItemIndex: script.originalItemIndex,
        displacement: script.displacement,
      })),
    ),
  );
}

function memberSummaries(page: Task98R2ObservedPage) {
  return page.lines.flatMap((line, lineIndex) =>
    line.runs.flatMap((run, runIndex) =>
      run.members.map((member) => ({
        lineIndex,
        runIndex,
        originalItemIndex: member.originalItemIndex,
        geometricRole: member.geometricRole,
      })),
    ),
  );
}

describe("Task98 R2 RED contract provenance", () => {
  it("keeps frozen V1 and slice-local V1.1 family provenance distinct", () => {
    expect(TASK98_R2_FROZEN_FAMILIES).toEqual([
      "R2-A",
      "R2-F",
      "R2-V",
      "R2-W",
      "R2-Y",
    ]);
    expect(TASK98_R2_SLICE_LOCAL_FAMILIES).toEqual(["R2-I", "R2-B", "R2-G"]);
    expect(Object.keys(TASK98_R2_RED_CONTRACTS)).toHaveLength(8);
    expect(TASK98_R2_SCALE_CIRCULARITY_RATIONALE).toContain(
      "without asserting call order",
    );
  });
});

describe("Task98 R2 intentional RED contracts", () => {
  it("[R2-A] emits two baseline lines without fragmenting obvious continuation or consulting hasEOL", async () => {
    const eolFalse = await extract(lineContinuationItems(false));
    const eolTrue = await extract(lineContinuationItems(true));
    const falseItems = technicalItems(eolFalse);
    const trueItems = technicalItems(eolTrue);

    expect(falseItems).toHaveLength(4);
    expect(trueItems).toHaveLength(4);
    expect(
      falseItems.map((item) =>
        (item.rawGeometry as { transform: readonly number[] }).transform.slice(
          4,
          6,
        ),
      ),
    ).toEqual([
      [10, 100],
      [21, 100],
      [10, 80],
      [21, 80],
    ]);

    const observedFalse = observeR2Page(eolFalse);
    const observedTrue = observeR2Page(eolTrue);
    const expected = [[[0, 1]], [[2, 3]]];

    expect({
      eolFalse: memberPartitions(observedFalse),
      eolTrue: memberPartitions(observedTrue),
    }).toEqual({ eolFalse: expected, eolTrue: expected });
  });

  it("[R2-F] preserves all 11 S3-attributed precision precursors as separate confident runs", async () => {
    expect(TASK98_R2_PRECISION_CASE_IDS).toHaveLength(11);
    const observed = [];
    for (const fixture of TASK98_R2_PRECISION_FIXTURES) {
      const result = await extract(fixture.items);
      const rawItems = technicalItems(result);
      expect(rawItems).toHaveLength(3);
      expect(rawItems[1]?.rawText).toBe(" ");
      expect((rawItems[1]?.rawGeometry as { height: number }).height).toBe(0);
      expect(
        new Set(
          rawItems.map(
            (item) =>
              (item.rawGeometry as { transform: readonly number[] })
                .transform[5],
          ),
        ).size,
      ).toBe(1);

      const page = observeR2Page(result);
      const members = memberSummaries(page);
      const contentRuns = [0, 2].map(
        (index) =>
          members.find((member) => member.originalItemIndex === index)
            ?.runIndex,
      );
      observed.push({
        caseId: fixture.caseId,
        recallOwner: fixture.expectedRecallOwner,
        lineCount: page.lines.length,
        runCount: page.lines[0]?.runs.length ?? 0,
        contentRuns,
        bridgeRole: members.find((member) => member.originalItemIndex === 1)
          ?.geometricRole,
        leadingBoundaries:
          page.lines[0]?.runs.map((run) => run.leadingBoundary) ?? [],
        hasTextProjection:
          page.raw === undefined
            ? false
            : [...deepKeys(page.raw)].some(
                (key) => key === "rawText" || key === "semanticText",
              ),
      });
    }

    expect(observed).toEqual(
      TASK98_R2_PRECISION_CASE_IDS.map((caseId) => ({
        caseId,
        recallOwner: "S3",
        lineCount: 1,
        runCount: 2,
        contentRuns: [0, 1],
        bridgeRole: "BRIDGE",
        leadingBoundaries: [undefined, "SEPARATED"],
        hasTextProjection: false,
      })),
    );
  });

  it("[R2-V] attaches only a uniquely eligible geometric script parent and never index-tiebreaks competing parents", async () => {
    const uniqueResult = await extract(UNIQUE_SCRIPT_ITEMS);
    expect(technicalItems(uniqueResult)).toHaveLength(3);
    const unique = observeR2Page(uniqueResult);

    const ambiguousResult = await extract(AMBIGUOUS_SCRIPT_ITEMS);
    expect(technicalItems(ambiguousResult)).toHaveLength(3);
    const ambiguous = observeR2Page(ambiguousResult);

    expect({
      uniqueScripts: scriptSummaries(unique).map(
        ({ originalItemIndex, displacement }) => ({
          originalItemIndex,
          displacement,
        }),
      ),
      uniqueItemDispositionCount: primaryDispositionIndices(unique).filter(
        (index) => index === 1,
      ).length,
      ambiguousScripts: scriptSummaries(ambiguous).filter(
        ({ originalItemIndex }) => originalItemIndex === 2,
      ),
      ambiguousUnplaced: ambiguous.unplacedItems.filter(
        ({ originalItemIndex }) => originalItemIndex === 2,
      ),
    }).toEqual({
      uniqueScripts: [{ originalItemIndex: 1, displacement: "SUBSCRIPT" }],
      uniqueItemDispositionCount: 1,
      ambiguousScripts: [],
      ambiguousUnplaced: [
        { originalItemIndex: 2, reason: "AMBIGUOUS_MEMBERSHIP" },
      ],
    });
  });

  it("[R2-W] uses projected geometry rather than emission deltas or whitespace width", async () => {
    const result = await extract(PROJECTED_ORDER_ITEMS);
    const rawItems = technicalItems(result);
    expect(rawItems.map((item) => item.originalItemIndex)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(rawItems.map((item) => item.rawText)).toEqual([
      "raised",
      "unit",
      "number",
      " ",
    ]);
    expect((rawItems[3]?.rawGeometry as { width: number }).width).toBe(1_000);

    const page = observeR2Page(result);
    expect({
      lineCount: page.lines.length,
      runCount: page.lines[0]?.runs.length ?? 0,
      members: page.lines[0]?.runs[0]?.members ?? [],
      scripts: page.lines[0]?.runs[0]?.scripts ?? [],
    }).toMatchObject({
      lineCount: 1,
      runCount: 1,
      members: [
        { originalItemIndex: 2, geometricRole: "CONTENT" },
        { originalItemIndex: 3, geometricRole: "BRIDGE" },
        { originalItemIndex: 1, geometricRole: "CONTENT" },
      ],
      scripts: [{ originalItemIndex: 0, displacement: "SUPERSCRIPT" }],
    });
  });

  it("[R2-Y] deterministically enumerates ties while raw geometry alone controls disposition", async () => {
    const first = await extract(DETERMINISTIC_TIE_ITEMS);
    const second = await extract(DETERMINISTIC_TIE_ITEMS);
    const rawItems = technicalItems(first);
    expect(rawItems).toHaveLength(3);
    expect(rawItems[0]?.quantizedGeometry).toEqual(
      rawItems[1]?.quantizedGeometry,
    );
    expect(rawItems[0]?.quantizedGeometry).toEqual(
      rawItems[2]?.quantizedGeometry,
    );
    expect(
      (rawItems[2]?.rawGeometry as { transform: readonly number[] })
        .transform[1],
    ).not.toBe(
      (rawItems[0]?.rawGeometry as { transform: readonly number[] })
        .transform[1],
    );

    const firstPage = observeR2Page(first);
    const secondPage = observeR2Page(second);
    expect({
      structurallyEqual: secondPage,
      memberPartitions: memberPartitions(firstPage),
      unplaced: firstPage.unplacedItems,
    }).toEqual({
      structurallyEqual: firstPage,
      memberPartitions: [[[0, 1]]],
      unplaced: [{ originalItemIndex: 2, reason: "UNSUPPORTED_ORIENTATION" }],
    });
  });

  it("[R2-I] conserves sparse R1 identities once and rejects a transitive baseline-chain merge", async () => {
    const result = await extract(BASELINE_CHAIN_ITEMS);
    const rawItems = technicalItems(result);
    const anomalies = technicalAnomalies(result);
    expect(rawItems.map((item) => item.originalItemIndex)).toEqual([0, 2, 3]);
    expect(anomalies).toMatchObject([{ originalItemIndex: 1 }]);
    const baselines = rawItems.map(
      (item) =>
        (item.rawGeometry as { transform: readonly number[] }).transform[5]!,
    );
    expect(baselines[0]! - baselines[1]!).toBeCloseTo(0.5);
    expect(baselines[1]! - baselines[2]!).toBeCloseTo(0.5);
    expect(baselines[0]! - baselines[2]!).toBeCloseTo(1);

    const page = observeR2Page(result);
    const primary = primaryDispositionIndices(page);
    expect({
      memberPartitions: memberPartitions(page),
      primarySorted: [...primary].sort((left, right) => left - right),
      primaryUniqueCount: new Set(primary).size,
      sourceAnomalies: page.sourceAnomalies,
    }).toEqual({
      memberPartitions: [[[0, 2]], [[3]]],
      primarySorted: [0, 2, 3],
      primaryUniqueCount: 3,
      sourceAnomalies: anomalies,
    });
  });

  it("[R2-B] splits unresolved continuity with geometric uncertainty independent of declared whitespace width", async () => {
    const narrowWidthResult = await extract(ambiguousBridgeItems(0));
    const misleadingWidthResult = await extract(ambiguousBridgeItems(10_000));
    const narrowItems = technicalItems(narrowWidthResult);
    const misleadingItems = technicalItems(misleadingWidthResult);
    expect(narrowItems).toHaveLength(3);
    expect(misleadingItems).toHaveLength(3);
    expect(narrowItems[1]?.rawText).toBe(" ");
    expect(misleadingItems[1]?.rawText).toBe(" ");

    const summarize = (page: Task98R2ObservedPage) => ({
      lineCount: page.lines.length,
      runCount: page.lines[0]?.runs.length ?? 0,
      contentRuns: [0, 2].map(
        (index) =>
          memberSummaries(page).find(
            (member) => member.originalItemIndex === index,
          )?.runIndex,
      ),
      bridgeRole: memberSummaries(page).find(
        (member) => member.originalItemIndex === 1,
      )?.geometricRole,
      boundaries: page.lines[0]?.runs.map((run) => run.leadingBoundary) ?? [],
    });
    const expected = {
      lineCount: 1,
      runCount: 2,
      contentRuns: [0, 1],
      bridgeRole: "BRIDGE",
      boundaries: [undefined, "UNCERTAIN_CONTINUITY"],
    };

    expect({
      narrowDeclaredWidth: summarize(observeR2Page(narrowWidthResult)),
      misleadingDeclaredWidth: summarize(observeR2Page(misleadingWidthResult)),
    }).toEqual({
      narrowDeclaredWidth: expected,
      misleadingDeclaredWidth: expected,
    });
  });

  it("[R2-G] fails unsupported orientation closed while retaining supported skew", async () => {
    const result = await extract(ORIENTATION_ITEMS);
    const rawItems = technicalItems(result);
    expect(rawItems).toHaveLength(4);
    expect(
      rawItems.map(
        (item) =>
          (item.rawGeometry as { transform: readonly number[] }).transform,
      ),
    ).toEqual(ORIENTATION_ITEMS.map((item) => item.transform));

    const page = observeR2Page(result);
    expect({
      unplaced: page.unplacedItems,
      placedIndices: memberSummaries(page).map(
        ({ originalItemIndex }) => originalItemIndex,
      ),
      allPrimaryIndices: [...primaryDispositionIndices(page)].sort(
        (left, right) => left - right,
      ),
    }).toEqual({
      unplaced: [
        { originalItemIndex: 0, reason: "UNSUPPORTED_ORIENTATION" },
        { originalItemIndex: 1, reason: "UNSUPPORTED_ORIENTATION" },
        { originalItemIndex: 2, reason: "UNSUPPORTED_ORIENTATION" },
      ],
      placedIndices: [3],
      allPrimaryIndices: [0, 1, 2, 3],
    });
  });
});
