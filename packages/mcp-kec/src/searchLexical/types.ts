import type { KnowledgeChunk, PageLocator } from "@voltai/knowledge-core";

import type { KecKnowledgeMetadata } from "../knowledge/kecKnowledgeAdapter.js";

export type KecLexicalSourceChunk = Readonly<
  KnowledgeChunk<KecKnowledgeMetadata, PageLocator>
>;

export type KecLexicalSearchResult = {
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly locator: Readonly<PageLocator>;
  readonly metadata: Readonly<KecKnowledgeMetadata>;
  readonly text: string;
  readonly lexicalScore: number;
};

export type KecLexicalSearchDependencies = Readonly<{
  listChunks: () => Promise<readonly KecLexicalSourceChunk[]>;
}>;
