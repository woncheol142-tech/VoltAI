import type {
  KecLexicalSearcher,
  KecRankCandidate,
  KecRankingStrategy,
  KecSearchRequest,
  KecSemanticSearcher,
} from "../searchFoundation/index.js";

export type KecHybridSearchDependencies = {
  readonly semanticSearcher: KecSemanticSearcher;
  readonly lexicalSearcher: KecLexicalSearcher;
  readonly rankingStrategy: KecRankingStrategy;
};

export type KecHybridSearchResult = readonly KecRankCandidate[];

export interface KecHybridSearchOrchestrator {
  search(request: KecSearchRequest): Promise<KecHybridSearchResult>;
}
