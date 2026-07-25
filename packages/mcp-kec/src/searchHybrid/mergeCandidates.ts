import type {
  KecLexicalHit,
  KecRankCandidate,
  KecSemanticHit,
} from "../searchFoundation/index.js";

type ChunkHit = {
  readonly chunkId: string;
};

function indexByChunkId<T extends ChunkHit>(
  hits: readonly T[],
): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();

  for (const hit of hits) {
    if (indexed.has(hit.chunkId)) {
      throw new Error(`DUPLICATE_CHUNK_ID: ${hit.chunkId}`);
    }

    indexed.set(hit.chunkId, hit);
  }

  return indexed;
}

function hasMatchingMetadata(
  semantic: KecSemanticHit,
  lexical: KecLexicalHit,
): boolean {
  return (
    semantic.sourcePath === lexical.sourcePath &&
    semantic.page === lexical.page &&
    semantic.clause === lexical.clause &&
    semantic.text === lexical.text
  );
}

function compareChunkId(
  left: KecRankCandidate,
  right: KecRankCandidate,
): number {
  return left.chunkId < right.chunkId
    ? -1
    : left.chunkId > right.chunkId
      ? 1
      : 0;
}

export function mergeCandidates(
  semanticHits: readonly KecSemanticHit[],
  lexicalHits: readonly KecLexicalHit[],
): readonly KecRankCandidate[] {
  const semanticByChunkId = indexByChunkId(semanticHits);
  const lexicalByChunkId = indexByChunkId(lexicalHits);
  const candidates: KecRankCandidate[] = [];

  for (const semantic of semanticHits) {
    const lexical = lexicalByChunkId.get(semantic.chunkId);

    if (lexical && !hasMatchingMetadata(semantic, lexical)) {
      throw new Error(`CONFLICTING_CHUNK_METADATA: ${semantic.chunkId}`);
    }

    candidates.push({
      chunkId: semantic.chunkId,
      sourcePath: semantic.sourcePath,
      page: semantic.page,
      clause: semantic.clause,
      text: semantic.text,
      signals: lexical
        ? {
            semanticScore: semantic.semanticScore,
            lexicalScore: lexical.lexicalScore,
          }
        : { semanticScore: semantic.semanticScore },
    });
  }

  for (const lexical of lexicalHits) {
    if (semanticByChunkId.has(lexical.chunkId)) {
      continue;
    }

    candidates.push({
      chunkId: lexical.chunkId,
      sourcePath: lexical.sourcePath,
      page: lexical.page,
      clause: lexical.clause,
      text: lexical.text,
      signals: { lexicalScore: lexical.lexicalScore },
    });
  }

  return candidates.sort(compareChunkId);
}
