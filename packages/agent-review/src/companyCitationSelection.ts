import type { CompanySearchResult } from "@voltai/knowledge-company";

const generalTokens = new Set([
  "company",
  "standard",
  "standards",
  "design",
  "requirement",
  "requirements",
  "관련",
  "기준",
]);

type ScoredCompanyResult = {
  result: CompanySearchResult;
  overlapCount: number;
};

function tokens(text: string): Set<string> {
  const normalized = text.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
  const values = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];

  return new Set(
    values.filter(
      (value) => !/^\p{N}+$/u.test(value) && !generalTokens.has(value),
    ),
  );
}

function resultText(result: CompanySearchResult): string {
  return [result.standardId, result.title, result.section ?? "", result.text].join("\n");
}

function compareResults(left: ScoredCompanyResult, right: ScoredCompanyResult): number {
  return (
    right.result.similarity - left.result.similarity ||
    right.overlapCount - left.overlapCount ||
    left.result.sourcePath.localeCompare(right.result.sourcePath) ||
    left.result.page - right.result.page ||
    left.result.chunkId.localeCompare(right.result.chunkId)
  );
}

export function selectCompanyResultsForPlaceholderReview(input: {
  contextText: string;
  results: CompanySearchResult[];
}): CompanySearchResult[] {
  const contextTokens = tokens(input.contextText);

  return input.results
    .map((result): ScoredCompanyResult => {
      const candidateTokens = tokens(resultText(result));
      const overlapCount = Array.from(contextTokens).filter((token) =>
        candidateTokens.has(token),
      ).length;

      return { result, overlapCount };
    })
    .filter((candidate) => candidate.overlapCount > 0)
    .sort(compareResults)
    .map((candidate) => candidate.result);
}
