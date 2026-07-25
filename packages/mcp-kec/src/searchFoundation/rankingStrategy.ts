import type { KecRankCandidate } from "./types.js";

export interface KecRankingStrategy {
  rank(
    candidates: readonly KecRankCandidate[],
    limit: number,
  ): readonly KecRankCandidate[];
}
