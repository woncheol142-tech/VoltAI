import { vi } from "vitest";

import type {
  EmbeddingProvider,
  EmbeddingProviderMetadata,
} from "../../src/knowledge/embedding.js";
import type {
  KecChunk,
  KecIndexMetadata,
  VectorStore,
} from "../../src/knowledge/vectorStore.js";

export const incomingSourcePath = "knowledge/current.pdf";
export const foreignSourcePath = "knowledge/foreign.pdf";

export type ExistingIndexState = Readonly<{
  metadata: KecIndexMetadata | null;
  sourcePaths: readonly string[];
}>;

export type IncomingEmbeddingState = Readonly<{
  sourcePath: string;
  providerMetadata: EmbeddingProviderMetadata;
  vectors: readonly (readonly number[])[];
}>;

export type KecIndexCompatibilityModule = Readonly<{
  assertKecIndexWriteCompatibility: (
    existing: ExistingIndexState,
    incoming: IncomingEmbeddingState,
  ) => Readonly<{ dimension: number }>;
}>;

export function providerMetadata(
  overrides: Partial<EmbeddingProviderMetadata> = {},
): EmbeddingProviderMetadata {
  return {
    provider: "ollama",
    model: "nomic-embed-text",
    ...overrides,
  };
}

export function indexMetadata(
  overrides: Partial<KecIndexMetadata> = {},
): KecIndexMetadata {
  return {
    embeddingProvider: "ollama",
    embeddingModel: "nomic-embed-text",
    dimensions: 3,
    indexedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

export function kecChunk(overrides: Partial<KecChunk> = {}): KecChunk {
  const sourcePath = overrides.sourcePath ?? incomingSourcePath;

  return {
    id: `${sourcePath}#page=1#chunk=0`,
    sourcePath,
    page: 1,
    chunkIndex: 0,
    clause: "KEC 232.5",
    text: "KEC 232.5 cable sizing rule",
    ...overrides,
  };
}

export function validVectors(dimension = 3, count = 2): number[][] {
  return Array.from({ length: count }, (_unused, vectorIndex) =>
    Array.from(
      { length: dimension },
      (_value, valueIndex) => (vectorIndex + 1) * (valueIndex + 1),
    ),
  );
}

export function malformedVectorCases(): ReadonlyArray<
  Readonly<{ name: string; vectors: readonly unknown[] }>
> {
  return [
    { name: "empty vector list", vectors: [] },
    { name: "zero-length vector", vectors: [[]] },
    {
      name: "inconsistent dimensions",
      vectors: [
        [1, 2, 3],
        [1, 2],
      ],
    },
    { name: "NaN", vectors: [[1, Number.NaN, 3]] },
    {
      name: "positive infinity",
      vectors: [[1, Number.POSITIVE_INFINITY, 3]],
    },
    {
      name: "negative infinity",
      vectors: [[1, Number.NEGATIVE_INFINITY, 3]],
    },
    { name: "string element", vectors: [[1, "2", 3]] },
    { name: "undefined element", vectors: [[1, undefined, 3]] },
    {
      name: "non-array vector",
      vectors: [{ length: 3, 0: 1, 1: 2, 2: 3 }],
    },
  ];
}

export function compatibilityErrorSentinels() {
  return {
    providerMetadata: new Error("provider-metadata-sentinel"),
    getIndexMetadata: new Error("metadata-read-sentinel"),
    listChunks: new Error("chunk-read-sentinel"),
    replaceSource: new Error("replace-source-sentinel"),
  };
}

export function existingIndexState(
  overrides: Partial<ExistingIndexState> = {},
): ExistingIndexState {
  return {
    metadata: indexMetadata(),
    sourcePaths: [incomingSourcePath],
    ...overrides,
  };
}

export function incomingEmbeddingState(
  overrides: Partial<IncomingEmbeddingState> = {},
): IncomingEmbeddingState {
  return {
    sourcePath: incomingSourcePath,
    providerMetadata: providerMetadata(),
    vectors: validVectors(),
    ...overrides,
  };
}

export type IndexCompatibilityHarnessOptions = Readonly<{
  metadataSequence?: readonly EmbeddingProviderMetadata[];
  vectors?: readonly unknown[];
  existingMetadata?: KecIndexMetadata | null;
  existingChunks?: readonly KecChunk[];
  providerMetadataError?: unknown;
  embeddingError?: unknown;
  getIndexMetadataError?: unknown;
  listChunksError?: unknown;
  replaceSourceError?: unknown;
  closeError?: unknown;
}>;

export function indexCompatibilityHarness(
  options: IndexCompatibilityHarnessOptions = {},
) {
  const metadataSequence = options.metadataSequence ?? [providerMetadata()];
  const vectors = options.vectors ?? [[1, 2, 3]];
  let metadataIndex = 0;
  let vectorIndex = 0;

  const getMetadata = vi.fn((): EmbeddingProviderMetadata => {
    if (options.providerMetadataError !== undefined) {
      throw options.providerMetadataError;
    }

    const snapshot =
      metadataSequence[Math.min(metadataIndex, metadataSequence.length - 1)];
    metadataIndex += 1;

    if (!snapshot) {
      throw new Error("fixture metadata sequence is empty");
    }

    return snapshot;
  });
  const embed = vi.fn(async (): Promise<number[]> => {
    if (options.embeddingError !== undefined) {
      throw options.embeddingError;
    }

    const vector = vectors[Math.min(vectorIndex, vectors.length - 1)];
    vectorIndex += 1;
    return vector as number[];
  });
  const getIndexMetadata = vi.fn(async (): Promise<KecIndexMetadata | null> => {
    if (options.getIndexMetadataError !== undefined) {
      throw options.getIndexMetadataError;
    }

    return options.existingMetadata ?? null;
  });
  const listChunks = vi.fn(async (): Promise<KecChunk[]> => {
    if (options.listChunksError !== undefined) {
      throw options.listChunksError;
    }

    return [...(options.existingChunks ?? [])];
  });
  const replaceSource = vi.fn<VectorStore["replaceSource"]>(async () => {
    if (options.replaceSourceError !== undefined) {
      throw options.replaceSourceError;
    }
  });
  const saveIndexMetadata = vi.fn<VectorStore["saveIndexMetadata"]>(
    async () => {},
  );
  const close = vi.fn(async () => {
    if (options.closeError !== undefined) {
      throw options.closeError;
    }
  });

  const embeddingProvider: EmbeddingProvider = {
    embed,
    getMetadata,
  };
  const vectorStore: VectorStore = {
    upsert: vi.fn(async () => {}),
    replaceSource,
    deleteBySourcePath: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    listChunks,
    saveIndexMetadata,
    getIndexMetadata,
    close,
  };

  return {
    embeddingProvider,
    vectorStore,
    embed,
    getMetadata,
    getIndexMetadata,
    listChunks,
    replaceSource,
    saveIndexMetadata,
    close,
  };
}

export async function captureError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  return undefined;
}
