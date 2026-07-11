import type { CompanySearchResult } from "@voltai/knowledge-company";

import { selectKecResultsForReview } from "./kecCitationSelection.js";
import type { KecSearchResult, ReviewProjectPorts, StructuredEvidence } from "./ports.js";

export type KnowledgeSourceWarning = {
  severity: "warning";
  source: "company";
  scope: "project" | "item";
  itemName?: string;
  message: string;
};

export type ReviewKnowledgeQueryResult = {
  kecResults: KecSearchResult[];
  companyResults: CompanySearchResult[];
  warnings: KnowledgeSourceWarning[];
};

export type ReviewKnowledgeQueryService = {
  searchProject: (input: { context: string }) => Promise<ReviewKnowledgeQueryResult>;
  searchItem: (input: {
    name: string;
    evidence: StructuredEvidence[];
  }) => Promise<ReviewKnowledgeQueryResult>;
};

function companyFailureWarning(
  scope: "project" | "item",
  itemName?: string,
): KnowledgeSourceWarning {
  return {
    severity: "warning",
    source: "company",
    scope,
    ...(itemName === undefined ? {} : { itemName }),
    message:
      scope === "project"
        ? "Company knowledge search is unavailable for the project review."
        : `Company knowledge search is unavailable for item "${itemName}".`,
  };
}

function buildCompanyItemQuery(name: string, evidence: StructuredEvidence[]): string {
  return [name, ...evidence.map((item) => item.excerpt)].join("\n");
}

async function searchCompany(
  search: ReviewProjectPorts["searchCompany"],
  query: string,
  scope: "project" | "item",
  itemName?: string,
): Promise<Pick<ReviewKnowledgeQueryResult, "companyResults" | "warnings">> {
  if (!search) {
    return { companyResults: [], warnings: [] };
  }

  try {
    return {
      companyResults: [...((await search(query)) ?? [])],
      warnings: [],
    };
  } catch {
    return {
      companyResults: [],
      warnings: [companyFailureWarning(scope, itemName)],
    };
  }
}

export function createReviewKnowledgeQueryService(
  ports: Pick<ReviewProjectPorts, "searchKec" | "searchCompany">,
): ReviewKnowledgeQueryService {
  return {
    async searchProject({ context }): Promise<ReviewKnowledgeQueryResult> {
      const rawKecResults = await ports.searchKec(context);
      const company = await searchCompany(ports.searchCompany, context, "project");

      return {
        kecResults: selectKecResultsForReview({
          contextText: context,
          results: rawKecResults,
        }),
        ...company,
      };
    },

    async searchItem({ name, evidence }): Promise<ReviewKnowledgeQueryResult> {
      const rawKecResults = await ports.searchKec(`${name} KEC 기준`);
      const company = await searchCompany(
        ports.searchCompany,
        buildCompanyItemQuery(name, evidence),
        "item",
        name,
      );

      return {
        kecResults: selectKecResultsForReview({
          contextText: [name, ...evidence.map((item) => item.excerpt)].join("\n"),
          results: rawKecResults,
        }),
        ...company,
      };
    },
  };
}
