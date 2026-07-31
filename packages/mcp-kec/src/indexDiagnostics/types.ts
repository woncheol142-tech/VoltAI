export type KecIndexDiagnosticStatus =
  | "MISSING_DATABASE"
  | "UNINITIALIZED_DATABASE"
  | "EMPTY_INDEX"
  | "READY"
  | "INCONSISTENT";

export type KecIndexDiagnosticMetadata = Readonly<{
  provider: string | null;
  model: string | null;
  dimensions: number | null;
  indexedAt: string | null;
}>;

export type KecIndexDiagnosticSource = Readonly<{
  sourceId: string;
  chunkCount: number;
}>;

export type KecIndexDiagnosticIssue = string;

export type KecIndexDiagnosticsV1 = Readonly<{
  schemaVersion: 1;
  status: KecIndexDiagnosticStatus;
  databaseExists: boolean;
  databaseSchemaVersion: number | null;
  metadata: KecIndexDiagnosticMetadata;
  chunkCount: number;
  sourceCount: number;
  sources: readonly KecIndexDiagnosticSource[];
  observedDimensions: readonly number[];
  issues: readonly KecIndexDiagnosticIssue[];
}>;
