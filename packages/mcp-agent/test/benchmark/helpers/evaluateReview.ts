import type {
  CoverageFinding,
  KecCitation,
  ReviewFinding,
  ReviewReport,
  StructuredEvidence,
} from "@voltai/agent-review";

export type ExpectedRelation = {
  id: string;
  message: string;
};

export type ExpectedCitation = {
  label: string;
  sourcePath: string;
  page: number;
};

export type ExpectedCoverageFinding = {
  id: string;
  reason: CoverageFinding["reason"];
  file: string;
  reviewed?: number;
  total?: number;
};

export type ReviewBenchmarkManifest = {
  id: string;
  expectedDesignItems: string[];
  expectedRelations: ExpectedRelation[];
  requiredEvidenceIds: string[];
  expectedCitations: ExpectedCitation[];
  expectedCoverageFindings: ExpectedCoverageFinding[];
  forbiddenFindings: string[];
  forbiddenCitations: string[];
  requiredReportSections: string[];
};

export type ReviewBenchmarkInput = {
  report: ReviewReport;
  markdown: string;
};

export type SetMetrics = {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  missing: string[];
  unexpected: string[];
};

export type EvidenceMetrics = {
  required: number;
  matched: number;
  missing: string[];
};

export type CitationLocationMismatch = {
  label: string;
  expected: {
    sourcePath: string;
    page: number;
  };
  actual: {
    sourcePath: string;
    page: number;
  };
};

export type CitationMetrics = {
  expected: number;
  matched: number;
  hitRate: number;
  missing: string[];
  unexpected: string[];
  wrongLocations: CitationLocationMismatch[];
};

export type CoverageMetrics = {
  expected: number;
  matched: number;
  missing: string[];
  unexpected: string[];
};

export type SectionMetrics = {
  required: number;
  matched: number;
  completeness: number;
  missing: string[];
};

export type ReviewBenchmarkResult = {
  designItems: SetMetrics;
  relations: SetMetrics;
  evidence: EvidenceMetrics;
  citations: CitationMetrics;
  coverage: CoverageMetrics;
  forbiddenFindings: string[];
  forbiddenCitations: string[];
  sections: SectionMetrics;
  passed: boolean;
};

type NormalizedValues = Map<string, string>;

export function normalizeBenchmarkText(value: string): string {
  return canonicalBenchmarkText(value).toLowerCase();
}

function canonicalBenchmarkText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function toNormalizedValues(values: string[]): NormalizedValues {
  const normalized = new Map<string, string>();

  for (const value of values) {
    const key = normalizeBenchmarkText(value);

    if (!normalized.has(key)) {
      normalized.set(key, canonicalBenchmarkText(value));
    }
  }

  return normalized;
}

function compareSets(expectedValues: string[], actualValues: string[]): SetMetrics {
  const expected = toNormalizedValues(expectedValues);
  const actual = toNormalizedValues(actualValues);
  const matchingKeys = [...expected.keys()].filter((key) => actual.has(key));
  const missingKeys = [...expected.keys()].filter((key) => !actual.has(key));
  const unexpectedKeys = [...actual.keys()].filter((key) => !expected.has(key));
  const truePositive = matchingKeys.length;
  const falsePositive = unexpectedKeys.length;
  const falseNegative = missingKeys.length;
  const precision =
    actual.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositive / actual.size;
  const recall = expected.size === 0 ? 1 : truePositive / expected.size;

  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision,
    recall,
    missing: missingKeys.map((key) => expected.get(key) ?? key),
    unexpected: unexpectedKeys.map((key) => actual.get(key) ?? key),
  };
}

function collectEvidence(report: ReviewReport): StructuredEvidence[] {
  const evidence = new Map<string, StructuredEvidence>();

  for (const item of report.itemReviews) {
    for (const candidate of item.evidence) {
      evidence.set(candidate.id, candidate);
    }
  }

  return [...evidence.values()];
}

function collectCitations(report: ReviewReport): KecCitation[] {
  const citations = new Map<string, KecCitation>();
  const candidates = [
    ...report.kecCitations,
    ...report.itemReviews.flatMap((item) => item.kecCitations),
  ];

  for (const citation of candidates) {
    citations.set(
      `${normalizeBenchmarkText(citation.label)}\u0000${citation.sourcePath}\u0000${citation.page}`,
      citation,
    );
  }

  return [...citations.values()];
}

function collectFindings(report: ReviewReport): ReviewFinding[] {
  const findings = new Map<string, ReviewFinding>();
  const candidates = [
    ...report.findings,
    ...report.relations,
    ...report.itemReviews.flatMap((item) => item.findings),
  ];

  for (const finding of candidates) {
    findings.set(normalizeBenchmarkText(finding.message), finding);
  }

  return [...findings.values()];
}

function matchesCoverage(
  actual: CoverageFinding,
  expected: ExpectedCoverageFinding,
): boolean {
  return (
    actual.id === expected.id &&
    actual.reason === expected.reason &&
    actual.file === expected.file &&
    (expected.reviewed === undefined || actual.reviewed === expected.reviewed) &&
    (expected.total === undefined || actual.total === expected.total)
  );
}

function evaluateCitations(
  citations: KecCitation[],
  expectedCitations: ExpectedCitation[],
): CitationMetrics {
  const citationsByLabel = new Map<string, KecCitation[]>();

  for (const citation of citations) {
    const key = normalizeBenchmarkText(citation.label);
    const current = citationsByLabel.get(key) ?? [];
    current.push(citation);
    citationsByLabel.set(key, current);
  }

  const wrongLocations: CitationLocationMismatch[] = [];
  const missing: string[] = [];
  let matched = 0;

  for (const expected of expectedCitations) {
    const candidates = citationsByLabel.get(normalizeBenchmarkText(expected.label)) ?? [];
    const correctLocation = candidates.some(
      (citation) => citation.sourcePath === expected.sourcePath && citation.page === expected.page,
    );

    if (correctLocation) {
      matched += 1;
      continue;
    }

    if (candidates.length === 0) {
      missing.push(expected.label);
      continue;
    }

    wrongLocations.push({
      label: expected.label,
      expected: { sourcePath: expected.sourcePath, page: expected.page },
      actual: {
        sourcePath: candidates[0].sourcePath,
        page: candidates[0].page,
      },
    });
  }

  const expectedLabels = new Set(
    expectedCitations.map((citation) => normalizeBenchmarkText(citation.label)),
  );
  const unexpected = citations
    .filter((citation) => !expectedLabels.has(normalizeBenchmarkText(citation.label)))
    .map((citation) => citation.label);

  return {
    expected: expectedCitations.length,
    matched,
    hitRate: expectedCitations.length === 0 ? 1 : matched / expectedCitations.length,
    missing,
    unexpected,
    wrongLocations,
  };
}

function evaluateCoverage(
  coverage: CoverageFinding[],
  expectedCoverage: ExpectedCoverageFinding[],
): CoverageMetrics {
  const matchedExpected = new Set<string>();
  const matchedActual = new Set<string>();

  for (const expected of expectedCoverage) {
    const actual = coverage.find((candidate) => matchesCoverage(candidate, expected));

    if (actual) {
      matchedExpected.add(expected.id);
      matchedActual.add(actual.id);
    }
  }

  return {
    expected: expectedCoverage.length,
    matched: matchedExpected.size,
    missing: expectedCoverage
      .filter((expected) => !matchedExpected.has(expected.id))
      .map((expected) => expected.id),
    unexpected: coverage
      .filter((actual) => !matchedActual.has(actual.id))
      .map((actual) => actual.id),
  };
}

function evaluateSections(markdown: string, requiredSections: string[]): SectionMetrics {
  const headings = new Set(markdown.replace(/\r\n/g, "\n").split("\n"));
  const required = [...new Set(requiredSections)];
  const missing = required.filter((section) => !headings.has(section));
  const matched = required.length - missing.length;

  return {
    required: required.length,
    matched,
    completeness: required.length === 0 ? 1 : matched / required.length,
    missing,
  };
}

export function evaluateReview(
  input: ReviewBenchmarkInput,
  manifest: ReviewBenchmarkManifest,
): ReviewBenchmarkResult {
  const designItems = compareSets(
    manifest.expectedDesignItems,
    input.report.itemReviews.map((item) => item.name),
  );
  const relations = compareSets(
    manifest.expectedRelations.map((relation) => relation.message),
    input.report.relations.map((finding) => finding.message),
  );
  const evidence = collectEvidence(input.report);
  const evidenceIds = new Set(evidence.map((candidate) => candidate.id));
  const requiredEvidence = [...new Set(manifest.requiredEvidenceIds)];
  const evidenceMetrics: EvidenceMetrics = {
    required: requiredEvidence.length,
    matched: requiredEvidence.filter((id) => evidenceIds.has(id)).length,
    missing: requiredEvidence.filter((id) => !evidenceIds.has(id)),
  };
  const citations = evaluateCitations(collectCitations(input.report), manifest.expectedCitations);
  const coverage = evaluateCoverage(input.report.coverage, manifest.expectedCoverageFindings);
  const findings = collectFindings(input.report).map((finding) => normalizeBenchmarkText(finding.message));
  const forbiddenFindings = manifest.forbiddenFindings
    .filter((forbidden) => findings.includes(normalizeBenchmarkText(forbidden)))
    .map(canonicalBenchmarkText);
  const citationLabels = collectCitations(input.report).map((citation) =>
    normalizeBenchmarkText(citation.label),
  );
  const forbiddenCitations = manifest.forbiddenCitations
    .filter((forbidden) => citationLabels.includes(normalizeBenchmarkText(forbidden)))
    .map(canonicalBenchmarkText);
  const sections = evaluateSections(input.markdown, manifest.requiredReportSections);
  const passed =
    designItems.falsePositive === 0 &&
    designItems.falseNegative === 0 &&
    relations.falsePositive === 0 &&
    relations.falseNegative === 0 &&
    evidenceMetrics.missing.length === 0 &&
    citations.missing.length === 0 &&
    citations.unexpected.length === 0 &&
    citations.wrongLocations.length === 0 &&
    coverage.missing.length === 0 &&
    coverage.unexpected.length === 0 &&
    forbiddenFindings.length === 0 &&
    forbiddenCitations.length === 0 &&
    sections.missing.length === 0;

  return {
    designItems,
    relations,
    evidence: evidenceMetrics,
    citations,
    coverage,
    forbiddenFindings,
    forbiddenCitations,
    sections,
    passed,
  };
}
