import type { KecBatchDirectoryDiscoveryDependencies } from "../directoryBatchIndexing/types.js";

export type KecDirectoryPruneDiscovery = Readonly<{
  directoryPath: string;
  sources: readonly string[];
}>;

export type KecDirectoryPrunePlan = Readonly<{
  directoryPath: string;
  desiredSourcePaths: readonly string[];
  expectedSourcePaths: readonly string[];
  staleSources: readonly Readonly<{
    sourcePath: string;
    sourceId: string;
  }>[];
  desiredSourceCount: number;
  indexedSourceCount: number;
}>;

export type KecDirectoryPruneResult = Readonly<{
  schemaVersion: 1;
  status: "SUCCEEDED";
  desiredSourceCount: number;
  indexedSourceCount: number;
  deletedSourceCount: number;
  sources: readonly Readonly<{
    sourceId: string;
    status: "DELETED";
  }>[];
}>;

export type KecDirectoryPruneDiscoveryDependencies =
  KecBatchDirectoryDiscoveryDependencies;

export type KecDirectoryPruneExecutionDependencies = Readonly<{
  pruneSources: (
    expectedSourcePaths: readonly string[],
    staleSourcePaths: readonly string[],
  ) => Promise<void>;
}>;
