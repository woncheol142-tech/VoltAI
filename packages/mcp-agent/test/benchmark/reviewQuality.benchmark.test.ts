import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CoverageFinding,
  KecCitation,
  PdfEvidence,
  ReviewFinding,
  ReviewReport,
} from "@voltai/agent-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateReview,
  type ReviewBenchmarkInput,
  type ReviewBenchmarkManifest,
} from "./helpers/evaluateReview.js";
import { reviewQualityBaseline } from "./fixtures/reviewQualityBaseline.js";
import { reviewQualityManifest } from "./fixtures/reviewQualityManifest.js";
import { prepareBenchmarkFixture } from "./fixtures/prepareBenchmarkFixture.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..", "..");

function createReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    project: { path: "/benchmark", fileCount: 0 },
    summary: [],
    kecCitations: [],
    itemReviews: [],
    risks: [],
    findings: [],
    coverage: [],
    relations: [],
    closingComments: [],
    ...overrides,
  };
}

function createInput(report: ReviewReport, markdown = "# 프로젝트 개요"): ReviewBenchmarkInput {
  return { report, markdown };
}

function createManifest(
  overrides: Partial<ReviewBenchmarkManifest> = {},
): ReviewBenchmarkManifest {
  return {
    id: "synthetic",
    expectedDesignItems: [],
    expectedRelations: [],
    requiredEvidenceIds: [],
    expectedCitations: [],
    expectedCoverageFindings: [],
    forbiddenFindings: [],
    forbiddenCitations: [],
    requiredReportSections: ["# 프로젝트 개요"],
    ...overrides,
  };
}

function pdfEvidence(id = "pdf:docs/spec.pdf:p1:1"): PdfEvidence {
  return {
    id,
    sourceType: "pdf",
    sourcePath: "docs/spec.pdf",
    page: 1,
    excerpt: "Cable design note.",
  };
}

function kecCitation(page = 1): KecCitation {
  return {
    id: `kec:knowledge/kec.pdf:p${page}:KEC 232.5`,
    sourceType: "kec",
    sourcePath: "knowledge/kec.pdf",
    page,
    label: "KEC 232.5",
    excerpt: "Cable sizing rule.",
  };
}

function coverageFinding(id = "coverage:estimate.xlsx:Summary:row-limit"): CoverageFinding {
  return {
    id,
    severity: "warning",
    file: "estimate.xlsx",
    reviewed: 50,
    reason: "row-limit",
    message: "estimate.xlsx [Summary] was limited to 50 rows",
  };
}

function finding(message: string): ReviewFinding {
  return { severity: "warning", message };
}

describe("review benchmark evaluator", () => {
  it("returns precision and recall of one for a complete exact match", () => {
    const relation = "Cable and voltage drop relation";
    const report = createReport({
      itemReviews: [{ name: "Cable", evidence: [pdfEvidence()], kecCitations: [], findings: [] }],
      kecCitations: [kecCitation()],
      coverage: [coverageFinding()],
      relations: [finding(relation)],
    });
    const manifest = createManifest({
      expectedDesignItems: ["Cable"],
      expectedRelations: [{ id: "cable-voltage-drop", message: relation }],
      requiredEvidenceIds: [pdfEvidence().id],
      expectedCitations: [
        { label: "KEC 232.5", sourcePath: "knowledge/kec.pdf", page: 1 },
      ],
      expectedCoverageFindings: [
        { id: coverageFinding().id, reason: "row-limit", file: "estimate.xlsx", reviewed: 50 },
      ],
    });

    const result = evaluateReview(createInput(report), manifest);

    expect(result.designItems).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
    });
    expect(result.relations).toMatchObject({ precision: 1, recall: 1 });
    expect(result.citations).toMatchObject({ expected: 1, matched: 1, hitRate: 1 });
    expect(result.coverage).toMatchObject({ expected: 1, matched: 1 });
    expect(result.passed).toBe(true);
  });

  it("reports missing and unexpected design items with TP, FP, and FN", () => {
    const result = evaluateReview(
      createInput(
        createReport({
          itemReviews: [
            { name: "Cable", evidence: [], kecCitations: [], findings: [] },
            { name: "Breaker", evidence: [], kecCitations: [], findings: [] },
          ],
        }),
      ),
      createManifest({ expectedDesignItems: ["Cable", "Panel"] }),
    );

    expect(result.designItems).toMatchObject({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
      missing: ["Panel"],
      unexpected: ["Breaker"],
    });
  });

  it("uses the defined zero-denominator policy", () => {
    const empty = evaluateReview(createInput(createReport()), createManifest());
    const missing = evaluateReview(
      createInput(createReport()),
      createManifest({ expectedDesignItems: ["Cable"] }),
    );

    expect(empty.designItems).toMatchObject({ precision: 1, recall: 1 });
    expect(missing.designItems).toMatchObject({ precision: 0, recall: 0 });
  });

  it("normalizes and deduplicates relation findings before matching", () => {
    const relation = "Cable relation check";
    const result = evaluateReview(
      createInput(
        createReport({
          relations: [finding("  cable   relation   check "), finding("Cable relation check")],
        }),
      ),
      createManifest({ expectedRelations: [{ id: "cable", message: relation }] }),
    );

    expect(result.relations).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
    });
  });

  it("diagnoses missing required evidence stable IDs", () => {
    const result = evaluateReview(
      createInput(createReport()),
      createManifest({ requiredEvidenceIds: [pdfEvidence().id] }),
    );

    expect(result.evidence.missing).toEqual([pdfEvidence().id]);
    expect(result.passed).toBe(false);
  });

  it("matches citations by label and validates source and page", () => {
    const result = evaluateReview(
      createInput(createReport({ kecCitations: [kecCitation()] })),
      createManifest({
        expectedCitations: [
          { label: "KEC 232.5", sourcePath: "knowledge/kec.pdf", page: 1 },
        ],
      }),
    );

    expect(result.citations).toMatchObject({
      expected: 1,
      matched: 1,
      hitRate: 1,
      missing: [],
      unexpected: [],
      wrongLocations: [],
    });
  });

  it("reports a wrong citation location when the label matches", () => {
    const result = evaluateReview(
      createInput(createReport({ kecCitations: [kecCitation(2)] })),
      createManifest({
        expectedCitations: [
          { label: "KEC 232.5", sourcePath: "knowledge/kec.pdf", page: 1 },
        ],
      }),
    );

    expect(result.citations.matched).toBe(0);
    expect(result.citations.wrongLocations).toEqual([
      expect.objectContaining({
        label: "KEC 232.5",
        expected: { sourcePath: "knowledge/kec.pdf", page: 1 },
        actual: { sourcePath: "knowledge/kec.pdf", page: 2 },
      }),
    ]);
  });

  it("reports matched, missing, and unexpected coverage findings", () => {
    const expected = coverageFinding();
    const unexpected = coverageFinding("coverage:estimate.xlsx:Summary:sheet-selection");
    const result = evaluateReview(
      createInput(createReport({ coverage: [expected, unexpected] })),
      createManifest({
        expectedCoverageFindings: [
          { id: expected.id, reason: "row-limit", file: "estimate.xlsx", reviewed: 50 },
          {
            id: "coverage:docs/spec.pdf:pdf-truncated",
            reason: "pdf-truncated",
            file: "docs/spec.pdf",
          },
        ],
      }),
    );

    expect(result.coverage).toMatchObject({
      expected: 2,
      matched: 1,
      missing: ["coverage:docs/spec.pdf:pdf-truncated"],
      unexpected: [unexpected.id],
    });
  });

  it("detects forbidden findings after normalized exact matching", () => {
    const result = evaluateReview(
      createInput(createReport({ findings: [finding("  KEC index missing ")] })),
      createManifest({ forbiddenFindings: ["KEC   index missing"] }),
    );

    expect(result.forbiddenFindings).toEqual(["KEC index missing"]);
    expect(result.passed).toBe(false);
  });

  it("detects forbidden citation labels", () => {
    const result = evaluateReview(
      createInput(
        createReport({
          kecCitations: [
            {
              ...kecCitation(),
              id: "kec:knowledge/kec.pdf:p9:KEC 999.1",
              label: "KEC 999.1",
              page: 9,
            },
          ],
        }),
      ),
      createManifest({ forbiddenCitations: ["KEC 999.1"] }),
    );

    expect(result.forbiddenCitations).toEqual(["KEC 999.1"]);
    expect(result.passed).toBe(false);
  });

  it("reports required markdown sections that are missing", () => {
    const result = evaluateReview(
      createInput(createReport(), "# 프로젝트 개요\r\n\r\n# 검토 의견"),
      createManifest({ requiredReportSections: ["# 프로젝트 개요", "# 확인 필요사항"] }),
    );

    expect(result.sections).toMatchObject({
      missing: ["# 확인 필요사항"],
      completeness: 0.5,
    });
    expect(result.passed).toBe(false);
  });

  it("returns structured diagnostics and computes passed from all strict expectations", () => {
    const result = evaluateReview(
      createInput(createReport({ itemReviews: [{ name: "Unexpected", evidence: [], kecCitations: [], findings: [] }] })),
      createManifest({ expectedDesignItems: ["Expected"] }),
    );

    expect(result).toMatchObject({
      designItems: {
        missing: ["Expected"],
        unexpected: ["Unexpected"],
      },
      forbiddenFindings: [],
      forbiddenCitations: [],
      passed: false,
    });
  });
});

describe("review quality benchmark baseline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("evaluates the deterministic fixture ReviewReport against the structured baseline", async () => {
    const benchmark = await prepareBenchmarkFixture();

    try {
      const output = await benchmark.runReview();
      const result = evaluateReview(output, reviewQualityManifest);

      expect(result).toEqual(reviewQualityBaseline);
    } finally {
      await benchmark.cleanup();
    }

    expect(existsSync(benchmark.projectRoot)).toBe(false);
  });

  it("keeps provenance and report structure as strict benchmark invariants", async () => {
    const benchmark = await prepareBenchmarkFixture();

    try {
      const result = evaluateReview(await benchmark.runReview(), reviewQualityManifest);

      expect(result.evidence.missing).toEqual([]);
      expect(result.citations.missing).toEqual([]);
      expect(result.citations.wrongLocations).toEqual([]);
      expect(result.coverage).toMatchObject({ matched: 2, missing: [], unexpected: [] });
      expect(result.sections).toMatchObject({ required: 7, matched: 7, completeness: 1, missing: [] });
    } finally {
      await benchmark.cleanup();
    }
  });

  it("produces the same structured baseline across repeated fixture reviews", async () => {
    const benchmark = await prepareBenchmarkFixture();

    try {
      const first = evaluateReview(await benchmark.runReview(), reviewQualityManifest);
      const second = evaluateReview(await benchmark.runReview(), reviewQualityManifest);

      expect(first).toEqual(second);
    } finally {
      await benchmark.cleanup();
    }
  });

  it("runs offline with no fetch calls and no API key", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("Benchmark must not make network requests");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const benchmark = await prepareBenchmarkFixture();

    try {
      const result = evaluateReview(await benchmark.runReview(), reviewQualityManifest);

      expect(result.designItems.recall).toBeGreaterThanOrEqual(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await benchmark.cleanup();
    }
  });

  it("does not require an API key to produce the deterministic benchmark", async () => {
    const originalApiKey = process.env.ZAI_API_KEY;
    delete process.env.ZAI_API_KEY;
    const benchmark = await prepareBenchmarkFixture();

    try {
      await expect(benchmark.runReview()).resolves.toEqual(
        expect.objectContaining({ report: expect.any(Object), markdown: expect.any(String) }),
      );
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.ZAI_API_KEY;
      } else {
        process.env.ZAI_API_KEY = originalApiKey;
      }

      await benchmark.cleanup();
    }
  });

  it("exposes a benchmark-only command that is separate from provider smoke", () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["test:benchmark"]).toBe(
      "vitest run --root ../.. packages/mcp-agent/test/benchmark",
    );
    expect(packageJson.scripts?.["test:benchmark"]).not.toContain("smoke");
    expect(packageJson.scripts?.test).not.toContain("benchmark");
  });
});
