import type {
  KecDirectoryPruneExecutionDependencies,
  KecDirectoryPrunePlan,
  KecDirectoryPruneResult,
} from "./types.js";

const INDEX_CHANGED = "KEC_DIRECTORY_PRUNE: INDEX_CHANGED";
const PRUNE_FAILED = "KEC_DIRECTORY_PRUNE: PRUNE_FAILED";

function errorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export async function executeKecDirectoryPrune(
  plan: KecDirectoryPrunePlan,
  dependencies: KecDirectoryPruneExecutionDependencies,
): Promise<KecDirectoryPruneResult> {
  if (plan.staleSources.length > 0) {
    try {
      await dependencies.pruneSources(
        plan.expectedSourcePaths,
        plan.staleSources.map((source) => source.sourcePath),
      );
    } catch (error) {
      if (errorMessage(error) === INDEX_CHANGED) throw error;
      throw new Error(PRUNE_FAILED);
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    status: "SUCCEEDED",
    desiredSourceCount: plan.desiredSourceCount,
    indexedSourceCount: plan.indexedSourceCount,
    deletedSourceCount: plan.staleSources.length,
    sources: Object.freeze(
      plan.staleSources.map((source) =>
        Object.freeze({
          sourceId: source.sourceId,
          status: "DELETED" as const,
        }),
      ),
    ),
  });
}
