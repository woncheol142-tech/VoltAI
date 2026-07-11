import { join } from "node:path";

import type { KnowledgeEmbeddingProvider } from "@voltai/knowledge-core";

export type CompanyEnvironment = Record<string, string | undefined>;

class LocalCompanyPlaceholderEmbeddingProvider implements KnowledgeEmbeddingProvider {
  getMetadata() {
    return {
      provider: "placeholder",
      model: "company-local-placeholder",
    };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();

    return [
      normalized.includes("ground") || normalized.includes("접지") ? 1 : 0,
      normalized.includes("procurement") || normalized.includes("구매") ? 1 : 0,
      normalized.length > 0 ? 1 : 0,
    ];
  }
}

export function createCompanyEmbeddingProviderFromEnv(
  environment: CompanyEnvironment = process.env,
): KnowledgeEmbeddingProvider {
  const provider = environment.COMPANY_EMBED_PROVIDER;

  if (provider === undefined || provider.length === 0) {
    throw new Error("COMPANY_EMBED_PROVIDER is required; set it to placeholder");
  }

  if (provider !== "placeholder") {
    throw new Error("COMPANY_EMBED_PROVIDER must be placeholder");
  }

  return new LocalCompanyPlaceholderEmbeddingProvider();
}

export function resolveCompanyKnowledgeDbPath(
  projectRoot: string,
  environment: CompanyEnvironment = process.env,
): string {
  return environment.KNOWLEDGE_DB_PATH ?? join(projectRoot, ".voltai", "knowledge.sqlite");
}
