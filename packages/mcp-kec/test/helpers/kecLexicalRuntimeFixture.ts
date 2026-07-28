import type { KnowledgeChunk, PageLocator } from "@voltai/knowledge-core";

import type { KecKnowledgeMetadata } from "../../src/knowledge/kecKnowledgeAdapter.js";

export type KecLexicalSourceChunk = Readonly<
  KnowledgeChunk<KecKnowledgeMetadata, PageLocator>
>;

export function kecLexicalSourceChunk(
  overrides: Partial<KecLexicalSourceChunk> = {},
): KecLexicalSourceChunk {
  return {
    chunkId: "kec:knowledge/kec.pdf#page=3#chunk=0",
    documentId: "kec:knowledge/kec.pdf",
    sourcePath: "knowledge/kec.pdf",
    chunkIndex: 0,
    locator: { kind: "page", page: 3 },
    metadata: { clause: "KEC 232.5" },
    text: "접지 보호 기준",
    ...overrides,
  };
}

export function createKecLexicalSourceHarness(
  source: readonly KecLexicalSourceChunk[] = [],
): {
  readonly dependencies: {
    readonly listChunks: () => Promise<readonly KecLexicalSourceChunk[]>;
  };
  readonly callCount: () => number;
} {
  let calls = 0;

  return {
    dependencies: {
      listChunks: async () => {
        calls += 1;
        return source;
      },
    },
    callCount: () => calls,
  };
}

export function createLargeKecLexicalSource(
  count: number,
): readonly KecLexicalSourceChunk[] {
  return Array.from({ length: count }, (_, index) =>
    kecLexicalSourceChunk({
      chunkId: `kec:large#chunk=${String(index).padStart(5, "0")}`,
      documentId: "kec:large",
      sourcePath: "knowledge/large-kec.pdf",
      chunkIndex: index,
      locator: { kind: "page", page: Math.floor(index / 20) + 1 },
      metadata: { clause: index % 10 === 0 ? "KEC 232.5" : null },
      text: `접지 기준 ${index}`,
    }),
  );
}
