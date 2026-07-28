import type {
  KnowledgeSearchResult,
  PageLocator,
} from "@voltai/knowledge-core";

import type { KecKnowledgeMetadata } from "../../src/knowledge/kecKnowledgeAdapter.js";
import type { KecSemanticSearchCoreDependencies } from "../../src/searchSemantic/semanticSearchCore.js";

export type PersistedKecSemanticResult = KnowledgeSearchResult<
  KecKnowledgeMetadata,
  PageLocator
>;

export const matchingKecIndexMetadata = {
  embeddingProvider: "test-provider",
  embeddingModel: "test-model",
  dimensions: 3,
  indexedAt: "2026-07-28T00:00:00.000Z",
};

export function persistedKecSemanticResult(
  overrides: Partial<PersistedKecSemanticResult> = {},
): PersistedKecSemanticResult {
  return {
    chunkId: "persisted-chunk-1",
    documentId: "kec:knowledge/kec.pdf",
    sourcePath: "knowledge/kec.pdf",
    locator: { kind: "page", page: 3 },
    metadata: { clause: "KEC 232.5" },
    text: "Cable sizing requirement.",
    similarity: 0.91,
    ...overrides,
  };
}

export function existingSemanticCoreDependencies(
  overrides: Partial<
    KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>
  > = {},
): KecSemanticSearchCoreDependencies<PersistedKecSemanticResult> {
  return {
    embeddingProvider: {
      embed: async () => [1, 0, 0],
      getMetadata: () => ({
        provider: "test-provider",
        model: "test-model",
      }),
    },
    getIndexMetadata: async () => matchingKecIndexMetadata,
    search: async () => [],
    ...overrides,
  };
}
