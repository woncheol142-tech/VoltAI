import type { KecSearchRequest, KecSemanticHit } from "./types.js";

export interface KecSemanticSearcher {
  search(request: KecSearchRequest): Promise<readonly KecSemanticHit[]>;
}
