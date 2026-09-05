import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { extractKecV2Technical } from "../../packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.js";
import {
  r1TechnicalInput,
  SYNTHETIC_FONT_STYLES,
  syntheticPdfTextItem,
  TASK98_R1_RED_CONTRACTS,
} from "./fixtures/task98R1GlyphProvenanceContract.js";
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

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`R1_CONTRACT_INVALID_${label}`);
  }
  return value as UnknownRecord;
}

function rawPage(result: unknown, pageIndex = 0): UnknownRecord {
  const pages = record(result, "RESULT").pages;
  if (!Array.isArray(pages)) throw new Error("R1_CONTRACT_MISSING_RAW_PAGES");
  return record(pages[pageIndex], "RAW_PAGE");
}

function rawItems(result: unknown): UnknownRecord[] {
  const items = rawPage(result).items;
  if (!Array.isArray(items)) throw new Error("R1_CONTRACT_MISSING_RAW_ITEMS");
  return items.map((item) => record(item, "RAW_ITEM"));
}

function anomalies(result: unknown): UnknownRecord[] {
  const value = rawPage(result).anomalies;
  if (!Array.isArray(value)) {
    throw new Error("R1_CONTRACT_MISSING_RAW_ANOMALIES");
  }
  return value.map((item) => record(item, "RAW_ANOMALY"));
}

function fontFingerprint(item: UnknownRecord): string {
  const value = record(item.fontEvidence, "FONT_EVIDENCE").fingerprint;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("R1_CONTRACT_MISSING_FONT_FINGERPRINT");
  }
  return value;
}

function semantic(item: UnknownRecord): UnknownRecord {
  return record(item.semanticText, "SEMANTIC_TEXT");
}

function expectFrozenGeometrySubstrate(
  item: UnknownRecord,
  expectedRaw: Readonly<Record<string, unknown>>,
): void {
  expect(record(item.rawGeometry, "RAW_GEOMETRY")).toMatchObject(expectedRaw);
  const bbox = record(item.bbox, "BBOX");
  expect(Object.values(bbox)).not.toHaveLength(0);
  expect(
    Object.values(bbox).every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  ).toBe(true);

  const quantized = record(item.quantizedGeometry, "QUANTIZED_GEOMETRY");
  expect(quantized.unit).toBe("1/1000-point");
  const quantizedBbox = record(quantized.bbox, "QUANTIZED_BBOX");
  expect(Object.values(quantizedBbox)).not.toHaveLength(0);
  expect(
    Object.values(quantizedBbox).every(
      (value) => typeof value === "number" && Number.isSafeInteger(value),
    ),
  ).toBe(true);
}

function setPage(items: readonly unknown[]): void {
  pdfjsHarness.pages = [{ items, styles: SYNTHETIC_FONT_STYLES }];
}

beforeEach(() => {
  pdfjsHarness.pages = [];
  pdfjsHarness.textContentCalls = [];
});

describe("Task98 R1 intentional RED contracts", () => {
  it("[R1-T] preserves an unresolved private-use glyph without substitution", async () => {
    const rawText = " \uE001 ";
    setPage([syntheticPdfTextItem({ str: rawText })]);

    const result = await extractKecV2Technical(r1TechnicalInput());
    const item = rawItems(result)[0]!;

    expect(item).toMatchObject({
      pageNumber: 1,
      originalItemIndex: 0,
      rawText,
      fontEvidence: { fontName: "task98-font-a" },
      semanticText: {
        state: "UNRESOLVED_PUA",
        rawCodePoints: [0xe001],
      },
    });
    expect(fontFingerprint(item)).toBeTypeOf("string");
    expect(JSON.stringify(semantic(item))).not.toContain("\uFFFD");
    expect(TASK98_R1_RED_CONTRACTS["R1-T"].expectedCurrentFailure).toContain(
      "no raw-item output",
    );
  });

  it("[R1-U] applies only an exact synthetic font-and-code-point mapping", async () => {
    setPage([
      syntheticPdfTextItem({ str: "\uE002" }),
      syntheticPdfTextItem({ str: "\uE002", fontName: "task98-font-b" }),
    ]);

    const discovery = await extractKecV2Technical(r1TechnicalInput());
    const fingerprint = fontFingerprint(rawItems(discovery)[0]!);
    const registry = Object.freeze({
      version: "task98:r1:synthetic-mapping:v1",
      digest: "1".repeat(64),
      entries: Object.freeze([
        Object.freeze({
          fontFingerprint: fingerprint,
          sourceCodePoint: 0xe002,
          mappedText: "Σ",
          mappingId: "synthetic:test-only:mapping:e002",
          evidenceDigest: "2".repeat(64),
        }),
      ]),
    });

    const result = await extractKecV2Technical(r1TechnicalInput(registry));
    const [matching, otherFont] = rawItems(result);

    expect(matching).toMatchObject({
      rawText: "\uE002",
      semanticText: {
        state: "VERIFIED_MAPPING",
        text: "Σ",
        mappingId: "synthetic:test-only:mapping:e002",
        fontFingerprint: fingerprint,
        evidenceDigest: "2".repeat(64),
      },
    });
    expect(otherFont).toMatchObject({
      rawText: "\uE002",
      semanticText: { state: "UNRESOLVED_PUA", rawCodePoints: [0xe002] },
    });
    expect(fontFingerprint(matching!)).toBe(fingerprint);
    expect(fontFingerprint(otherFont!)).not.toBe(fingerprint);

    const conflictingRegistry = {
      ...registry,
      entries: [
        ...registry.entries,
        {
          ...registry.entries[0],
          mappedText: "Ω",
          mappingId: "synthetic:test-only:mapping:e002:conflict",
        },
      ],
    };
    await expect(
      extractKecV2Technical(r1TechnicalInput(conflictingRegistry)),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILURE" });
  });

  it("[R1-V] retains independently positioned glyphs without relating them", async () => {
    const firstTransform = [1, 0, 0, 1, 40.125, 80.875] as const;
    const secondTransform = [0.6, 0, 0, 0.6, 47.25, 77.5] as const;
    setPage([
      syntheticPdfTextItem({ str: "x", transform: firstTransform }),
      syntheticPdfTextItem({ str: "\uE003", transform: secondTransform }),
    ]);

    const result = await extractKecV2Technical(r1TechnicalInput());
    const items = rawItems(result);

    expect(items).toHaveLength(2);
    expect(
      items.map(({ originalItemIndex, rawText }) => [
        originalItemIndex,
        rawText,
      ]),
    ).toEqual([
      [0, "x"],
      [1, "\uE003"],
    ]);
    expectFrozenGeometrySubstrate(items[0]!, {
      transform: firstTransform,
      width: 8,
      height: 10,
      hasEOL: false,
      direction: "ltr",
    });
    expectFrozenGeometrySubstrate(items[1]!, {
      transform: secondTransform,
      width: 8,
      height: 10,
      hasEOL: false,
      direction: "ltr",
    });
    expect(fontFingerprint(items[0]!)).toBeTypeOf("string");
    expect(semantic(items[1]!).state).toBe("UNRESOLVED_PUA");
  });

  it("[R1-W] retains a zero-height whitespace item as structurally valid provenance", async () => {
    setPage([
      syntheticPdfTextItem({ str: "12" }),
      syntheticPdfTextItem({ str: " ", width: 3.5, height: 0 }),
      syntheticPdfTextItem({ str: "m\u0301" }),
      syntheticPdfTextItem({
        str: "²",
        transform: [0.7, 0, 0, 0.7, 61.5, 84.25],
      }),
    ]);

    const result = await extractKecV2Technical(r1TechnicalInput());
    const items = rawItems(result);

    expect(
      items.map(({ originalItemIndex, rawText }) => [
        originalItemIndex,
        rawText,
      ]),
    ).toEqual([
      [0, "12"],
      [1, " "],
      [2, "m\u0301"],
      [3, "²"],
    ]);
    expect(record(items[1]!.rawGeometry, "RAW_GEOMETRY")).toMatchObject({
      width: 3.5,
      height: 0,
    });
    expect(semantic(items[1]!)).toMatchObject({
      state: "UNICODE",
      text: " ",
    });
    expect(semantic(items[2]!)).toMatchObject({
      state: "UNICODE",
      text: "m\u0301",
    });
    expect(anomalies(result)).toEqual([]);
  });

  it("[R1-X] preserves the untouched page-scoped parser index coordinate space", async () => {
    setPage([
      syntheticPdfTextItem({
        str: "third-visually",
        transform: [1, 0, 0, 1, 90, 10],
      }),
      syntheticPdfTextItem({
        str: "first-visually",
        transform: [1, 0, 0, 1, 10, 90],
      }),
      syntheticPdfTextItem({
        str: "second-visually",
        transform: [1, 0, 0, 1, 50, 50],
      }),
    ]);

    const result = await extractKecV2Technical(r1TechnicalInput());
    const items = rawItems(result);

    expect(items.map(({ originalItemIndex }) => originalItemIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(items.map(({ rawText }) => rawText)).toEqual([
      "third-visually",
      "first-visually",
      "second-visually",
    ]);
    expect(items.every(({ pageNumber }) => pageNumber === 1)).toBe(true);
  });

  it("[R1-AH] types malformed raw geometry without rejecting unusual valid coordinates", async () => {
    setPage([
      syntheticPdfTextItem({
        str: "nan",
        transform: [1, 0, 0, 1, Number.NaN, 10],
      }),
      syntheticPdfTextItem({
        str: "infinite",
        width: Number.POSITIVE_INFINITY,
      }),
      syntheticPdfTextItem({ str: "short-shape", transform: [1, 0, 0, 1, 10] }),
      syntheticPdfTextItem({
        str: "negative-origin",
        transform: [1, 0, 0, 1, -500, -900],
      }),
    ]);

    const first = await extractKecV2Technical(r1TechnicalInput());
    const second = await extractKecV2Technical(r1TechnicalInput());
    const firstAnomalies = anomalies(first);

    expect(firstAnomalies).toEqual(anomalies(second));
    expect(firstAnomalies).toHaveLength(3);
    expect(firstAnomalies).toEqual(
      expect.arrayContaining(
        [0, 1, 2].map((originalItemIndex) =>
          expect.objectContaining({
            kind: "INVALID_RAW_GEOMETRY",
            pageNumber: 1,
            originalItemIndex,
          }),
        ),
      ),
    );
    expect(rawItems(first)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalItemIndex: 3,
          rawText: "negative-origin",
        }),
      ]),
    );
  });

  it("[R1-I] accounts for each eligible text item without rebasing later indices", async () => {
    setPage([
      syntheticPdfTextItem({ str: "before" }),
      Object.freeze({
        str: "eligible-but-malformed",
        dir: "ltr",
        transform: Object.freeze([1, 0, 0]),
        width: 4,
        height: 8,
        fontName: "task98-font-a",
        hasEOL: false,
      }),
      syntheticPdfTextItem({ str: "after" }),
      Object.freeze({ type: "beginMarkedContent", id: "non-text-marker" }),
    ]);

    const result = await extractKecV2Technical(r1TechnicalInput());
    const retained = rawItems(result);
    const rejected = anomalies(result);

    expect(retained.map(({ originalItemIndex }) => originalItemIndex)).toEqual([
      0, 2,
    ]);
    expect(rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "INVALID_RAW_GEOMETRY",
          pageNumber: 1,
          originalItemIndex: 1,
        }),
      ]),
    );
    expect(
      [...retained, ...rejected]
        .map(({ originalItemIndex }) => originalItemIndex)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right),
    ).toEqual([0, 1, 2]);
  });

  it("[R1-N] keeps mapped semantic text and raw geometry beside immutable raw text", async () => {
    const rawText = "\uE004";
    const transform = [1.125, 0.001, -0.002, 0.875, 12.3456, 78.9012] as const;
    setPage([
      syntheticPdfTextItem({
        str: rawText,
        transform,
        width: 9.8765,
        height: 7.6543,
      }),
    ]);

    const discovery = await extractKecV2Technical(r1TechnicalInput());
    const fingerprint = fontFingerprint(rawItems(discovery)[0]!);
    const result = await extractKecV2Technical(
      r1TechnicalInput({
        version: "task98:r1:synthetic-dual-text:v1",
        digest: "3".repeat(64),
        entries: [
          {
            fontFingerprint: fingerprint,
            sourceCodePoint: 0xe004,
            mappedText: "α",
            mappingId: "synthetic:test-only:mapping:e004",
            evidenceDigest: "4".repeat(64),
          },
        ],
      }),
    );
    const item = rawItems(result)[0]!;

    expect(item.rawText).toBe(rawText);
    expect(semantic(item)).toMatchObject({
      state: "VERIFIED_MAPPING",
      text: "α",
    });
    expect(semantic(item).text).not.toBe(item.rawText);
    expect(record(item.rawGeometry, "RAW_GEOMETRY")).toMatchObject({
      transform,
      width: 9.8765,
      height: 7.6543,
    });
  });
});
