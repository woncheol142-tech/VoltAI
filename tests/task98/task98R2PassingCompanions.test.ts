import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { extractKecV2Technical } from "../../packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.js";
import {
  geometricItem,
  r2TechnicalInput,
  SYNTHETIC_FONT_STYLES,
} from "./fixtures/task98R2GeometricLinesContract.js";
import { workspaceRoot } from "./fixtures/task98R0ArchitectureContract.js";
import {
  assertTechnicalDependencyAuthority,
  findTechnicalRoot,
} from "./helpers/task98TechnicalDependencyAuthority.js";
import {
  deepKeys,
  technicalAnomalies,
  technicalItems,
  withoutHasEOL,
} from "./helpers/task98R2GeometricLinesHarness.js";
import { installTask98PdfJsTextContentHarness } from "./helpers/task98PdfJsTextContentHarness.js";

const technicalSourceRoot = resolve(
  workspaceRoot,
  "packages/mcp-kec/src/technicalExtractionV2",
);
const geometricModule = resolve(technicalSourceRoot, "geometricLines.ts");

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

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`R2_COMPANION_INVALID_${label}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function testFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("Task98 R2 passing companions", () => {
  it("[C-1] keeps every retained R1 provenance field reachable and unmodified", async () => {
    const source = geometricItem({
      token: " source-token ",
      x: -12.25,
      baseline: 43.125,
      width: 7.75,
      scale: 2.5,
      hasEOL: true,
      c: 0.5,
    });
    const result = await extract([source]);
    const item = technicalItems(result)[0]!;

    expect(item).toMatchObject({
      pageNumber: 1,
      originalItemIndex: 0,
      rawText: source.str,
      rawGeometry: {
        transform: source.transform,
        width: source.width,
        height: source.height,
        hasEOL: source.hasEOL,
        direction: source.dir,
      },
      bbox: {
        x: source.transform[4],
        y: source.transform[5],
        width: source.width,
        height: source.height,
      },
      quantizedGeometry: { unit: "1/1000-point" },
      fontEvidence: { fontName: source.fontName },
      glyphs: expect.any(Array),
      semanticText: expect.any(Object),
    });
  });

  it("[C-2] preserves sparse originalItemIndex values without rebasing", async () => {
    const result = await extract([
      geometricItem({ token: "kept-0", x: 10, baseline: 100 }),
      { str: "rejected-1" },
      geometricItem({ token: "kept-2", x: 30, baseline: 100 }),
    ]);

    expect(
      technicalItems(result).map((item) => item.originalItemIndex),
    ).toEqual([0, 2]);
    expect(technicalAnomalies(result)).toMatchObject([
      { originalItemIndex: 1 },
    ]);
  });

  it("[C-3] preserves rawText without trimming, collapsing, or normalization", async () => {
    const rawText = "  A\tB\nme\u0301  ";
    const result = await extract([
      geometricItem({ token: rawText, x: 10, baseline: 100 }),
    ]);

    expect(technicalItems(result)[0]?.rawText).toBe(rawText);
  });

  it("[C-4] preserves unresolved PUA provenance without interpretation", async () => {
    const rawText = "\uE321";
    const result = await extract([
      geometricItem({ token: rawText, x: 10, baseline: 100 }),
    ]);
    const item = technicalItems(result)[0]!;

    expect(item.rawText).toBe(rawText);
    expect(record(item.semanticText, "SEMANTIC_TEXT")).toMatchObject({
      state: "UNRESOLVED_PUA",
      rawCodePoints: [0xe321],
    });
  });

  it("[C-5] keeps page-local technical output authority-neutral", async () => {
    const result = await extract([
      geometricItem({ token: "neutral", x: 10, baseline: 100 }),
    ]);
    const pageKeys = [...deepKeys(record(result, "RESULT").pages)];

    expect(pageKeys).not.toEqual(
      expect.arrayContaining([
        "sourceBinding",
        "admission",
        "admissionReference",
        "authorizingAdmissionReference",
        "authorityEnvelope",
        "evidenceEligibility",
        "normativeAuthority",
        "receipt",
        "receiptStore",
        "snapshotStore",
        "verified",
        "verifiedExecution",
        "sourceIdentity",
        "revisionKey",
        "authority",
        "confidence",
        "requirementClass",
        "evidenceClass",
      ]),
    );
  });

  it("[C-6] preserves extractKecV2Technical as the single technical root", () => {
    const root = findTechnicalRoot(
      resolve(workspaceRoot, "packages/mcp-kec/src"),
    );
    expect(basename(root)).toBe("technicalExtraction.ts");
  });

  it("[C-7] keeps hasEOL and downstream topology vocabulary outside R2 geometry", async () => {
    const withoutEol = await extract([
      geometricItem({
        token: "same-geometry",
        x: 10,
        baseline: 100,
        hasEOL: false,
      }),
    ]);
    const withEol = await extract([
      geometricItem({
        token: "same-geometry",
        x: 10,
        baseline: 100,
        hasEOL: true,
      }),
    ]);
    expect(withoutHasEOL(withEol)).toEqual(withoutHasEOL(withoutEol));

    const source = existsSync(geometricModule)
      ? readFileSync(geometricModule, "utf8")
      : "";
    expect(source).not.toMatch(
      /\b(?:column|lane|table|cell|row|region|paragraph|block|candidate|promotion|metric|locatorSpan|hasEOL)\b/u,
    );
  });

  it("[C-8] keeps persistence dependencies unreachable from the technical root", () => {
    const audit = assertTechnicalDependencyAuthority(
      resolve(workspaceRoot, "packages/mcp-kec/src"),
    );
    expect(audit.rootFile).toBe(
      findTechnicalRoot(resolve(workspaceRoot, "packages/mcp-kec/src")),
    );

    const source = existsSync(geometricModule)
      ? readFileSync(geometricModule, "utf8")
      : "";
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*(?:import|export)\b/u.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/\b(?:store|repository|writer)\b/iu);
  });

  it("[C-9] preserves deterministic structural equality of technical results", async () => {
    const items = [
      geometricItem({ token: "second", x: 20, baseline: 100 }),
      geometricItem({ token: "first", x: 10, baseline: 100 }),
    ];
    const first = await extract(items);
    const second = await extract(items);

    expect(second).toEqual(first);
  });

  it("[C-10] preserves the authoritative repository gate and 372-file baseline", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, unknown> };
    expect(manifest.scripts?.test).toBe("vitest run");

    const r2Files = new Set([
      "task98R2GeometricLines.red.test.ts",
      "task98R2PassingCompanions.test.ts",
    ]);
    const packageTestFiles = readdirSync(resolve(workspaceRoot, "packages"), {
      withFileTypes: true,
    }).flatMap((entry) =>
      entry.isDirectory()
        ? testFiles(resolve(workspaceRoot, "packages", entry.name, "test"))
        : [],
    );
    const baselineFiles = [
      ...testFiles(resolve(workspaceRoot, "tests")),
      ...packageTestFiles,
    ].filter((path) => !r2Files.has(basename(path)));
    expect(baselineFiles).toHaveLength(372);
  });
});
