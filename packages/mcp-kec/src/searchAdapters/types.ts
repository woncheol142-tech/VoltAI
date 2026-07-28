import type {
  KnowledgeSearchResult,
  PageLocator,
} from "@voltai/knowledge-core";

import type { KecKnowledgeMetadata } from "../knowledge/kecKnowledgeAdapter.js";
import type { KecSemanticSearchCoreDependencies } from "../searchSemantic/semanticSearchCore.js";

export type PersistedKecSemanticResult = KnowledgeSearchResult<
  KecKnowledgeMetadata,
  PageLocator
>;

export type ExistingSemanticSearchAdapterDependencies =
  KecSemanticSearchCoreDependencies<PersistedKecSemanticResult>;
