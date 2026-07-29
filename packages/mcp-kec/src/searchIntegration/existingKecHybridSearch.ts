import type { PageLocator } from "@voltai/knowledge-core";

import {
  kecKnowledgeCodecs,
  type KecKnowledgeMetadata,
} from "../knowledge/kecKnowledgeAdapter.js";
import {
  createExistingLexicalSearcher,
  createExistingSemanticSearcher,
} from "../searchAdapters/index.js";
import {
  createKecHybridSearchOrchestrator,
  type KecHybridSearchOrchestrator,
} from "../searchHybrid/index.js";
import { searchKecLexically } from "../searchLexical/index.js";
import {
  createKecWeightedRankingStrategy,
  type KecWeightedRankingOptions,
} from "../searchRanking/index.js";
import type { ExistingKecHybridSearchDependencies } from "./types.js";

const kecCollection = "kec";

export function createExistingKecHybridSearch(
  dependencies: ExistingKecHybridSearchDependencies,
  rankingOptions: KecWeightedRankingOptions,
): KecHybridSearchOrchestrator {
  const semanticSearcher = createExistingSemanticSearcher({
    embeddingProvider: dependencies.embeddingProvider,
    getIndexMetadata: () =>
      dependencies.vectorStore.getIndexMetadata(kecCollection),
    search: (embedding, limit) =>
      dependencies.vectorStore.search(
        kecCollection,
        embedding,
        limit,
        kecKnowledgeCodecs,
      ),
  });
  const lexicalSearcher = createExistingLexicalSearcher({
    searchLexically: (query, limit) =>
      searchKecLexically(query, limit, {
        listChunks: () =>
          dependencies.vectorStore.listChunks<
            KecKnowledgeMetadata,
            PageLocator
          >(kecCollection, kecKnowledgeCodecs),
      }),
  });
  const rankingStrategy = createKecWeightedRankingStrategy(rankingOptions);

  return createKecHybridSearchOrchestrator({
    semanticSearcher,
    lexicalSearcher,
    rankingStrategy,
  });
}
