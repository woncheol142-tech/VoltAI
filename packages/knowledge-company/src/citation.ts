import type { KnowledgeCitation, PageLocator } from "@voltai/knowledge-core";

import type { CompanyCitation, CompanySearchResult } from "./types.js";

type CompanyCitationMetadata = {
  standardId: string;
  title: string;
  section: string | null;
};

export function companySearchResultToCompanyCitation(
  result: CompanySearchResult,
): CompanyCitation {
  return {
    id: `company:${result.chunkId}`,
    sourceType: "company",
    standardId: result.standardId,
    title: result.title,
    section: result.section,
    sourcePath: result.sourcePath,
    page: result.page,
    excerpt: result.text,
  };
}

export function companyCitationToKnowledgeCitation(
  citation: CompanyCitation,
): KnowledgeCitation<"company", CompanyCitationMetadata, PageLocator> {
  return {
    citationId: citation.id,
    sourceType: "knowledge",
    domain: "company",
    collection: "company",
    documentId: `company:${citation.sourcePath}`,
    sourcePath: citation.sourcePath,
    locator: { kind: "page", page: citation.page },
    label: `${citation.standardId}: ${citation.title}`,
    excerpt: citation.excerpt,
    metadata: {
      standardId: citation.standardId,
      title: citation.title,
      section: citation.section,
    },
  };
}

export function knowledgeCitationToCompanyCitation(
  citation: KnowledgeCitation<"company", CompanyCitationMetadata, PageLocator>,
): CompanyCitation {
  return {
    id: citation.citationId,
    sourceType: "company",
    standardId: citation.metadata.standardId,
    title: citation.metadata.title,
    section: citation.metadata.section,
    sourcePath: citation.sourcePath,
    page: citation.locator.page,
    excerpt: citation.excerpt,
  };
}
