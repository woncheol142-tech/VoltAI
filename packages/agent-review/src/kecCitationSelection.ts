import type { KecSearchResult } from "./ports.js";

export type KecCitationSelectionInput = {
  contextText: string;
  results: KecSearchResult[];
  relativeThreshold?: number;
};

export type KecCitationSelectionDiagnostic = {
  result: KecSearchResult;
  supported: boolean;
  overlapCount: number;
  relativeScore: number;
  clauseMatched: boolean;
};

type ScoredKecResult = KecCitationSelectionDiagnostic & {
  originalIndex: number;
};

const defaultRelativeThreshold = 0.5;
const ignoredTokens = new Set([
  "kec",
  "기준",
  "rule",
  "requirement",
  "and",
  "the",
  "for",
  "of",
  "to",
  "a",
  "an",
  "관련",
  "검토",
]);
const conceptAliases = new Map<string, string>([
  ["케이블", "cable"],
  ["전선", "cable"],
  ["cable", "cable"],
  ["차단기", "breaker"],
  ["mccb", "breaker"],
  ["elb", "breaker"],
  ["breaker", "breaker"],
  ["분전반", "panel"],
  ["panel", "panel"],
  ["조명", "lighting"],
  ["lighting", "lighting"],
  ["light", "lighting"],
  ["콘센트", "outlet"],
  ["outlet", "outlet"],
  ["receptacle", "outlet"],
  ["접지", "grounding"],
  ["ground", "grounding"],
  ["grounding", "grounding"],
  ["전압강하", "voltage-drop"],
  ["voltage", "voltage-drop"],
  ["drop", "voltage-drop"],
  ["부하", "load"],
  ["load", "load"],
]);

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenize(value: string): Set<string> {
  const tokens = normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalizedTokens = new Set<string>();

  for (const token of tokens) {
    if (ignoredTokens.has(token) || /^\p{N}+$/u.test(token)) {
      continue;
    }

    normalizedTokens.add(conceptAliases.get(token) ?? token);
  }

  return normalizedTokens;
}

function explicitClauses(value: string): Set<string> {
  const clauses = new Set<string>();
  const matches = normalizeText(value).matchAll(/\bKEC\s+(\d+(?:\.\d+)*)\b/gi);

  for (const match of matches) {
    clauses.add(`kec ${match[1]}`);
  }

  return clauses;
}

function normalizeClause(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = normalizeText(value).match(/\bKEC\s+(\d+(?:\.\d+)*)\b/i);

  return match ? `kec ${match[1]}` : undefined;
}

function overlapCount(contextTokens: Set<string>, resultTokens: Set<string>): number {
  let count = 0;

  for (const token of resultTokens) {
    if (contextTokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

function compareScoredResults(left: ScoredKecResult, right: ScoredKecResult): number {
  if (right.result.similarity !== left.result.similarity) {
    return right.result.similarity - left.result.similarity;
  }

  if (right.overlapCount !== left.overlapCount) {
    return right.overlapCount - left.overlapCount;
  }

  const sourcePathComparison = left.result.sourcePath.localeCompare(right.result.sourcePath);

  if (sourcePathComparison !== 0) {
    return sourcePathComparison;
  }

  if (left.result.page !== right.result.page) {
    return left.result.page - right.result.page;
  }

  const clauseComparison = (left.result.clause ?? "").localeCompare(right.result.clause ?? "");

  return clauseComparison !== 0 ? clauseComparison : left.originalIndex - right.originalIndex;
}

export function getKecCitationSelectionDiagnostics(
  input: KecCitationSelectionInput,
): KecCitationSelectionDiagnostic[] {
  const contextTokens = tokenize(input.contextText);
  const contextClauses = explicitClauses(input.contextText);
  const preliminary = input.results.map((result, originalIndex) => {
    const clauseMatched = (() => {
      const clause = normalizeClause(result.clause);

      return clause !== undefined && contextClauses.has(clause);
    })();
    const overlap = overlapCount(contextTokens, tokenize(result.text));

    return {
      result,
      originalIndex,
      supported: overlap > 0 || clauseMatched,
      overlapCount: overlap,
      clauseMatched,
      relativeScore: 0,
    };
  });
  const topSupportedSimilarity = Math.max(
    0,
    ...preliminary
      .filter((candidate) => candidate.supported && candidate.result.similarity > 0)
      .map((candidate) => candidate.result.similarity),
  );

  return preliminary.map((candidate) => ({
    result: candidate.result,
    supported: candidate.supported,
    overlapCount: candidate.overlapCount,
    clauseMatched: candidate.clauseMatched,
    relativeScore:
      topSupportedSimilarity > 0 && candidate.supported && candidate.result.similarity > 0
        ? candidate.result.similarity / topSupportedSimilarity
        : 0,
  }));
}

export function selectKecResultsForReview(
  input: KecCitationSelectionInput,
): KecSearchResult[] {
  const relativeThreshold = input.relativeThreshold ?? defaultRelativeThreshold;

  if (relativeThreshold < 0 || relativeThreshold > 1) {
    throw new Error("relativeThreshold must be between 0 and 1");
  }

  const diagnostics = getKecCitationSelectionDiagnostics(input);
  const originalIndices = new Map(input.results.map((result, index) => [result, index]));

  return diagnostics
    .filter(
      (candidate) =>
        candidate.supported &&
        candidate.result.similarity > 0 &&
        candidate.relativeScore >= relativeThreshold,
    )
    .map((candidate) => ({
      ...candidate,
      originalIndex: originalIndices.get(candidate.result) ?? 0,
    }))
    .sort(compareScoredResults)
    .map((candidate) => candidate.result);
}
