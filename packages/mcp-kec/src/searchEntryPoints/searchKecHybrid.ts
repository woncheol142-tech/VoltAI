import type { KecSearchRequest } from "../searchFoundation/index.js";
import type { KecHybridSearchResult } from "../searchHybrid/index.js";
import {
  createExistingKecHybridSearch,
  type ExistingKecHybridSearchDependencies,
} from "../searchIntegration/index.js";
import type { KecWeightedRankingOptions } from "../searchRanking/index.js";

export function searchKecHybrid(
  request: KecSearchRequest,
  dependencies: ExistingKecHybridSearchDependencies,
  rankingOptions: KecWeightedRankingOptions,
): Promise<KecHybridSearchResult> {
  return createExistingKecHybridSearch(dependencies, rankingOptions).search(
    request,
  );
}
