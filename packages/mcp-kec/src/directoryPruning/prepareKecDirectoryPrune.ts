import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import type {
  KecDirectoryPruneDiscovery,
  KecDirectoryPrunePlan,
} from "./types.js";

const INVALID_INDEX_STATE = "KEC_DIRECTORY_PRUNE: INVALID_INDEX_STATE";

function sourceId(sourcePath: string): string {
  return `kecsrc_${createHash("sha256").update(sourcePath, "utf8").digest("hex")}`;
}

function isManagedSourcePath(sourcePath: unknown): sourcePath is string {
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    sourcePath.includes("\0") ||
    sourcePath.includes("\\") ||
    isAbsolute(sourcePath)
  ) {
    return false;
  }
  const segments = sourcePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return false;
  }
  const basename = segments.at(-1) ?? "";
  return basename.length > 4 && basename.toLowerCase().endsWith(".pdf");
}

function parentDirectory(sourcePath: string): string {
  const separator = sourcePath.lastIndexOf("/");
  return separator === -1 ? "." : sourcePath.slice(0, separator);
}

function asciiSourceIdOrder(
  left: Readonly<{ sourceId: string }>,
  right: Readonly<{ sourceId: string }>,
): number {
  return left.sourceId < right.sourceId
    ? -1
    : left.sourceId > right.sourceId
      ? 1
      : 0;
}

export function prepareKecDirectoryPrune(
  discovery: KecDirectoryPruneDiscovery,
  indexedSourcePaths: readonly string[],
): KecDirectoryPrunePlan {
  const seen = new Set<string>();
  for (const indexedSourcePath of indexedSourcePaths) {
    if (
      !isManagedSourcePath(indexedSourcePath) ||
      seen.has(indexedSourcePath)
    ) {
      throw new Error(INVALID_INDEX_STATE);
    }
    seen.add(indexedSourcePath);
  }

  const desired = new Set(discovery.sources);
  const indexedInScope = indexedSourcePaths.filter(
    (sourcePath) => parentDirectory(sourcePath) === discovery.directoryPath,
  );
  const staleSources = indexedInScope
    .filter((sourcePath) => !desired.has(sourcePath))
    .map((sourcePath) =>
      Object.freeze({ sourcePath, sourceId: sourceId(sourcePath) }),
    )
    .sort(asciiSourceIdOrder);

  return Object.freeze({
    directoryPath: discovery.directoryPath,
    desiredSourcePaths: Object.freeze([...discovery.sources]),
    expectedSourcePaths: Object.freeze([...indexedSourcePaths]),
    staleSources: Object.freeze(staleSources),
    desiredSourceCount: desired.size,
    indexedSourceCount: indexedInScope.length,
  });
}
