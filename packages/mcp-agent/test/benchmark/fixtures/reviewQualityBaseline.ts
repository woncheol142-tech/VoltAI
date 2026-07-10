import type { ReviewBenchmarkResult } from "../helpers/evaluateReview.js";

export const reviewQualityBaseline: ReviewBenchmarkResult = {
  designItems: {
    truePositive: 6,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    missing: [],
    unexpected: [],
  },
  relations: {
    truePositive: 4,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    missing: [],
    unexpected: [],
  },
  evidence: {
    required: 3,
    matched: 3,
    missing: [],
  },
  citations: {
    expected: 1,
    matched: 1,
    hitRate: 1,
    missing: [],
    unexpected: ["KEC 999.1"],
    wrongLocations: [],
  },
  coverage: {
    expected: 2,
    matched: 2,
    missing: [],
    unexpected: [],
  },
  forbiddenFindings: [],
  forbiddenCitations: ["KEC 999.1"],
  sections: {
    required: 7,
    matched: 7,
    completeness: 1,
    missing: [],
  },
  passed: false,
};
