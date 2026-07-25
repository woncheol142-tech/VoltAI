import { mergeCandidates } from "./mergeCandidates.js";
import type {
  KecHybridSearchDependencies,
  KecHybridSearchOrchestrator,
} from "./types.js";

function invokeSearcher<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createKecHybridSearchOrchestrator(
  dependencies: KecHybridSearchDependencies,
): KecHybridSearchOrchestrator {
  return {
    search: async (request) => {
      const semanticPromise = invokeSearcher(() =>
        dependencies.semanticSearcher.search(request),
      );
      const lexicalPromise = invokeSearcher(() =>
        dependencies.lexicalSearcher.search(request),
      );
      const [semanticResult, lexicalResult] = await Promise.allSettled([
        semanticPromise,
        lexicalPromise,
      ]);

      if (semanticResult.status === "rejected") {
        throw semanticResult.reason;
      }

      if (lexicalResult.status === "rejected") {
        throw lexicalResult.reason;
      }

      const candidates = mergeCandidates(
        semanticResult.value,
        lexicalResult.value,
      );

      return dependencies.rankingStrategy.rank(candidates, request.limit);
    },
  };
}
