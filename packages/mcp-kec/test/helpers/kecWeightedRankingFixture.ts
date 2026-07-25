import type {
  KecRankCandidate,
  KecRankSignals,
} from "../../src/searchFoundation/index.js";

type RankCandidateOverrides = Omit<Partial<KecRankCandidate>, "signals"> & {
  readonly signals?: KecRankSignals;
};

export function rankCandidate(
  overrides: RankCandidateOverrides = {},
): KecRankCandidate {
  return {
    chunkId: "chunk-1",
    sourcePath: "knowledge/kec.pdf",
    page: 1,
    clause: "KEC 232.5",
    text: "Cable sizing requirement.",
    signals: { semanticScore: 0.5 },
    ...overrides,
  };
}
