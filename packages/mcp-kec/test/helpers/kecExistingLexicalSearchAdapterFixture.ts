import type { KecLexicalSearchResult } from "../../src/searchLexical/index.js";

export type LexicalRuntimeCallback = (
  query: string,
  limit: number,
) => Promise<readonly KecLexicalSearchResult[]>;

export type LexicalAdapterDependenciesFixture = Readonly<{
  searchLexically: LexicalRuntimeCallback;
}>;

export function kecLexicalRuntimeResult(
  overrides: Partial<KecLexicalSearchResult> = {},
): KecLexicalSearchResult {
  return {
    chunkId: "persisted-lexical-chunk-1",
    documentId: "kec:knowledge/kec.pdf",
    sourcePath: "knowledge/kec.pdf",
    locator: { kind: "page", page: 3 },
    metadata: { clause: "KEC 232.5" },
    text: "Cable sizing requirement.",
    lexicalScore: 0.91,
    ...overrides,
  };
}

export function existingLexicalAdapterDependencies(
  overrides: Partial<LexicalAdapterDependenciesFixture> = {},
): LexicalAdapterDependenciesFixture {
  return {
    searchLexically: async () => [],
    ...overrides,
  };
}
