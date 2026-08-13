import type { EvidenceAuthority } from "@voltai/knowledge-core";

import type { CompanyKnowledgeSearchResult } from "./types.js";

export function companyEvidenceAuthority(
  result: CompanyKnowledgeSearchResult,
): EvidenceAuthority {
  void result;

  return { authorityClass: "company-standard" };
}
