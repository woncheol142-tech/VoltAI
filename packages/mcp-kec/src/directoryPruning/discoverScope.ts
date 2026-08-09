import { discoverKecBatchDirectoryScope } from "../directoryBatchIndexing/discoverKecBatchDirectory.js";

import type {
  KecDirectoryPruneDiscovery,
  KecDirectoryPruneDiscoveryDependencies,
} from "./types.js";

const ERROR_PREFIX = "KEC_BATCH_DIRECTORY: ";
const PRUNE_ERROR_PREFIX = "KEC_DIRECTORY_PRUNE: ";

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

export function discoverKecDirectoryPruneScope(
  projectRoot: string,
  request: unknown,
  dependencies?: KecDirectoryPruneDiscoveryDependencies,
): KecDirectoryPruneDiscovery {
  try {
    return discoverKecBatchDirectoryScope(projectRoot, request, dependencies);
  } catch (error) {
    const message = errorMessage(error);
    if (message?.startsWith(ERROR_PREFIX) === true) {
      throw new Error(
        `${PRUNE_ERROR_PREFIX}${message.slice(ERROR_PREFIX.length)}`,
      );
    }
    throw new Error("KEC_DIRECTORY_PRUNE: INTERNAL_ERROR");
  }
}
