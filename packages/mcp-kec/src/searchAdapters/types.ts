import type {
  KnowledgeSearchResult,
  PageLocator,
} from "@voltai/knowledge-core";

import type { KecKnowledgeMetadata } from "../knowledge/kecKnowledgeAdapter.js";
import type { KecLexicalSearchResult } from "../searchLexical/index.js";
import type { KecSemanticSearchCoreDependencies } from "../searchSemantic/semanticSearchCore.js";

export type PersistedKecSemanticResult = KnowledgeSearchResult<
  KecKnowledgeMetadata,
  PageLocator
>;

export type ExistingSemanticSearchAdapterDependencies =
  KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>;

export type ExistingLexicalSearchAdapterDependencies = Readonly<{
  searchLexically: (
    query: string,
    limit: number,
  ) => Promise<readonly KecLexicalSearchResult[]>;
}>;
