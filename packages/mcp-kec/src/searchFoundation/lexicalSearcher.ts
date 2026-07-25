import type { KecLexicalHit, KecSearchRequest } from "./types.js";

export interface KecLexicalSearcher {
  search(request: KecSearchRequest): Promise<readonly KecLexicalHit[]>;
}
