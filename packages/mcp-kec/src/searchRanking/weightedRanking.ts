import type {
  KecRankCandidate,
  KecRankingStrategy,
} from "../searchFoundation/index.js";
import type { KecWeightedRankingOptions } from "./types.js";
import {
  type WeightedRankEntry,
  validateRankLimit,
  validateWeightedRankCandidate,
  validateWeightedRankingOptions,
} from "./validateWeightedRanking.js";

function compareDescending(left: number, right: number): number {
  return left > right ? -1 : left < right ? 1 : 0;
}

function comparePresence(left: boolean, right: boolean): number {
  return left === right ? 0 : left ? -1 : 1;
}

function compareChunkId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(
  left: WeightedRankEntry,
  right: WeightedRankEntry,
): number {
  return (
    compareDescending(left.weightedScore, right.weightedScore) ||
    comparePresence(left.semanticPresent, right.semanticPresent) ||
    compareDescending(left.semanticScore, right.semanticScore) ||
    comparePresence(left.lexicalPresent, right.lexicalPresent) ||
    compareDescending(left.lexicalScore, right.lexicalScore) ||
    compareChunkId(left.chunkId, right.chunkId)
  );
}

export function createKecWeightedRankingStrategy(
  options: KecWeightedRankingOptions,
): KecRankingStrategy {
  const validatedOptions = validateWeightedRankingOptions(options);

  return {
    rank: (candidates, limit) => {
      validateRankLimit(limit);

      const entries = candidates.map((candidate) =>
        validateWeightedRankCandidate(candidate, validatedOptions),
      );
      entries.sort(compareEntries);

      const result: KecRankCandidate[] = entries
        .slice(0, limit)
        .map((entry) => entry.candidate);

      return Object.freeze(result);
    },
  };
}
