import type { KecDirectoryPruneResult } from "./types.js";

const INTERNAL_ERROR = "KEC_DIRECTORY_PRUNE: INTERNAL_ERROR";
const SOURCE_ID = /^kecsrc_[0-9a-f]{64}$/u;

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidResult(result: KecDirectoryPruneResult): boolean {
  if (
    typeof result !== "object" ||
    result === null ||
    result.schemaVersion !== 1 ||
    result.status !== "SUCCEEDED" ||
    !isNonnegativeInteger(result.desiredSourceCount) ||
    !isNonnegativeInteger(result.indexedSourceCount) ||
    !isNonnegativeInteger(result.deletedSourceCount) ||
    !Array.isArray(result.sources) ||
    result.deletedSourceCount !== result.sources.length ||
    result.deletedSourceCount > result.indexedSourceCount
  ) {
    return false;
  }
  return result.sources.every(
    (source) =>
      typeof source === "object" &&
      source !== null &&
      source.status === "DELETED" &&
      typeof source.sourceId === "string" &&
      SOURCE_ID.test(source.sourceId),
  );
}

export function serializeKecDirectoryPruneResult(
  result: KecDirectoryPruneResult,
): string {
  if (!isValidResult(result)) throw new Error(INTERNAL_ERROR);
  try {
    return `${JSON.stringify(result)}\n`;
  } catch {
    throw new Error(INTERNAL_ERROR);
  }
}
