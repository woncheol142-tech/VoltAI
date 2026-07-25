import type {
  KecLexicalHit,
  KecSearchRequest,
  KecSemanticHit,
} from "../../src/searchFoundation/index.js";

export const hybridSearchRequest: KecSearchRequest = {
  query: "KEC cable",
  limit: 5,
};

export function semanticHit(
  overrides: Partial<KecSemanticHit> = {},
): KecSemanticHit {
  return {
    chunkId: "chunk-1",
    sourcePath: "knowledge/kec.pdf",
    page: 1,
    clause: "KEC 232.5",
    text: "Cable sizing requirement.",
    semanticScore: 0.91,
    ...overrides,
  };
}

export function lexicalHit(
  overrides: Partial<KecLexicalHit> = {},
): KecLexicalHit {
  return {
    chunkId: "chunk-1",
    sourcePath: "knowledge/kec.pdf",
    page: 1,
    clause: "KEC 232.5",
    text: "Cable sizing requirement.",
    lexicalScore: 12.5,
    ...overrides,
  };
}

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
