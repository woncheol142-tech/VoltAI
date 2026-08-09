export type KecBatchIndexStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export type KecBatchSourceStatus = "INDEXED" | "FAILED" | "NOT_ATTEMPTED";

export type KecBatchFailureCode = "INDEXING_FAILED" | "NOT_ATTEMPTED";

export type KecBatchIndexRequest = Readonly<{
  sources: readonly string[];
}>;

export type PreparedKecBatchSource = Readonly<{
  sourcePath: string;
  sourceId: string;
}>;

export type KecBatchIndexConfig = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;

export type PreparedKecBatchIndex = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  sources: readonly PreparedKecBatchSource[];
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;

export type KecBatchSourceResult = Readonly<{
  sourceId: string;
  status: KecBatchSourceStatus;
  indexedChunkCount: number;
  failureCode: KecBatchFailureCode | null;
}>;

export type KecBatchIndexResultV1 = Readonly<{
  schemaVersion: 1;
  status: KecBatchIndexStatus;
  requestedSourceCount: number;
  indexedSourceCount: number;
  failedSourceCount: number;
  notAttemptedSourceCount: number;
  indexedChunkCount: number;
  sources: readonly KecBatchSourceResult[];
}>;
