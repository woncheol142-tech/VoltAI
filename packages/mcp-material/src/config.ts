import { join } from "node:path";

import type { KnowledgeEmbeddingProvider } from "@voltai/knowledge-core";

export type MaterialEnvironment = Record<string, string | undefined>;

class LocalMaterialPlaceholderEmbeddingProvider implements KnowledgeEmbeddingProvider {
  getMetadata() {
    return {
      provider: "placeholder",
      model: "material-local-placeholder",
    };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();

    return [
      normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0,
      normalized.includes("breaker") || normalized.includes("차단기") ? 1 : 0,
      normalized.length > 0 ? 1 : 0,
    ];
  }
}

export function createMaterialEmbeddingProviderFromEnv(
  environment: MaterialEnvironment = process.env,
): KnowledgeEmbeddingProvider {
  const provider = environment.MATERIAL_EMBED_PROVIDER;

  if (provider === undefined || provider.length === 0) {
    throw new Error("MATERIAL_EMBED_PROVIDER is required; set it to placeholder");
  }
  if (provider !== "placeholder") {
    throw new Error("MATERIAL_EMBED_PROVIDER must be placeholder");
  }

  return new LocalMaterialPlaceholderEmbeddingProvider();
}

export function resolveMaterialKnowledgeDbPath(
  projectRoot: string,
  environment: MaterialEnvironment = process.env,
): string {
  return environment.KNOWLEDGE_DB_PATH ?? join(projectRoot, ".voltai", "knowledge.sqlite");
}
