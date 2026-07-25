export type KecSearchRequest = {
  readonly query: string;
  readonly limit: number;
};

export type KecSemanticHit = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly semanticScore: number;
};

export type KecLexicalHit = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly lexicalScore: number;
};

export type KecRankSignals = {
  readonly lexicalScore?: number;
  readonly semanticScore?: number;
};

export type KecRankCandidate = {
  readonly chunkId: string;
  readonly sourcePath: string;
  readonly page: number;
  readonly clause: string | null;
  readonly text: string;
  readonly signals: KecRankSignals;
};
