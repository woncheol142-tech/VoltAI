import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  extractKecV2Technical as facadeExtractKecV2Technical,
  KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
  KEC_REQUIREMENT_LOCATOR_SPACE,
} from "../../packages/mcp-kec/src/knowledge/requirementExtraction.js";
import * as technical from "../../packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.js";
import {
  EMPTY_TEST_MAPPING_REGISTRY,
  r1TechnicalInput,
  SYNTHETIC_FONT_STYLES,
  syntheticPdfTextItem,
} from "./fixtures/task98R1GlyphProvenanceContract.js";
import {
  task98Paths,
  workspaceRoot,
} from "./fixtures/task98R0ArchitectureContract.js";
import {
  assertTechnicalDependencyAuthority,
  findTechnicalRoot,
} from "./helpers/task98TechnicalDependencyAuthority.js";
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

function deepKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (typeof value !== "object" || value === null) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    deepKeys(child, keys);
  }
  return keys;
}

beforeEach(() => {
  pdfjsHarness.pages = [];
  pdfjsHarness.textContentCalls = [];
});

describe("Task98 R1 passing companions", () => {
  it("[C-1] keeps the legacy V1 contract identities and entrypoints characterized", () => {
    expect(KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID).toBe(
      "kec:pdfjs-structural-normative-paragraphs:v1",
    );
    expect(KEC_REQUIREMENT_LOCATOR_SPACE).toBe("kec:pdf-text-item-span:v1");
    expect(facadeExtractKecV2Technical).toBe(technical.extractKecV2Technical);
  });

  it("[C-2/C-3/C-6] preserves one authority-neutral, non-persistent technical root", async () => {
    const root = findTechnicalRoot(task98Paths.mcpKecSource);
    const audit = assertTechnicalDependencyAuthority(task98Paths.mcpKecSource);
    expect(basename(root)).toBe("technicalExtraction.ts");
    expect(audit.rootFile).toBe(root);

    pdfjsHarness.pages = [
      { items: [syntheticPdfTextItem()], styles: SYNTHETIC_FONT_STYLES },
    ];
    const result = await technical.extractKecV2Technical(r1TechnicalInput());
    expect([...deepKeys(result)]).not.toEqual(
      expect.arrayContaining([
        "sourceBinding",
        "admission",
        "evidenceEligibility",
        "normativeAuthority",
        "receipt",
      ]),
    );
    expect(result.requirements).toEqual([]);
    expect(result.observations).toEqual([]);
    const possiblePages = (result as unknown as Record<string, unknown>).pages;
    if (Array.isArray(possiblePages)) {
      expect([...deepKeys(possiblePages)]).not.toEqual(
        expect.arrayContaining([
          "sourceIdentity",
          "revisionKey",
          "sourceBinding",
          "evidenceEligibility",
          "normativeAuthority",
        ]),
      );
    }
  });

  it("[C-5] keeps downstream structural and semantic contracts out of the R1 production seam", () => {
    const seamDirectory = resolve(
      workspaceRoot,
      "packages/mcp-kec/src/technicalExtractionV2",
    );
    const source = readdirSync(seamDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => readFileSync(join(seamDirectory, entry.name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /readingOrder|baselineBand|lineGroup|scriptAttachment|tableTopology|columnTopology|paragraphGroup|semanticBlock|candidatePromotion|outwardLocatorSpan/u,
    );
  });

  it("[C-7/R1-O] preserves repeated-run determinism and the caller byte snapshot", async () => {
    pdfjsHarness.pages = [
      { items: [syntheticPdfTextItem()], styles: SYNTHETIC_FONT_STYLES },
    ];
    const input = r1TechnicalInput();
    const before = input.exactBytes.slice();

    const first = await technical.extractKecV2Technical(input);
    const second = await technical.extractKecV2Technical(input);

    expect(second).toEqual(first);
    expect(input.exactBytes).toEqual(before);
  });

  it("[C-7/R1-O] keeps malformed registry validation before parser invocation", async () => {
    const invalidRegistry = {
      ...EMPTY_TEST_MAPPING_REGISTRY,
      digest: "invalid",
    };

    await expect(
      technical.extractKecV2Technical(r1TechnicalInput(invalidRegistry)),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILURE" });
    expect(pdfjsHarness.textContentCalls).toEqual([]);
    const source = readFileSync(
      resolve(
        workspaceRoot,
        "packages/mcp-kec/src/technicalExtractionV2/technicalExtraction.ts",
      ),
      "utf8",
    );
    expect(source.indexOf("validateInput(input)")).toBeLessThan(
      source.indexOf("await loadPdfJs()"),
    );
  });

  it("[C-7/R1-O] bounds resource acceptance only after page materialization", async () => {
    pdfjsHarness.pages = [
      {
        items: [syntheticPdfTextItem(), syntheticPdfTextItem()],
        styles: SYNTHETIC_FONT_STYLES,
      },
    ];

    await expect(
      technical.extractKecV2Technical(
        r1TechnicalInput(EMPTY_TEST_MAPPING_REGISTRY, {
          maxPages: 1,
          maxTextItemsPerPage: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_FAILURE" });
    expect(pdfjsHarness.textContentCalls).toEqual([1]);
  });
});
