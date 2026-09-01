export {
  PolicyEpochSealedFailure,
  PolicyRegistrationFailure,
  SourceResolutionStoreFailure,
} from "./errors.js";
export type { SourceResolutionStoreFailureCategory } from "./errors.js";
export { PolicyRegistrar, PolicyResolutionStore } from "./store.js";
export type {
  EstablishedSourceRevisionRecord,
  PolicyConfigurationSnapshot,
  RevisionScheme,
  Task97Instrumentation,
} from "./types.js";

import { PolicyRegistrar, PolicyResolutionStore } from "./store.js";
import type { Task97Instrumentation } from "./types.js";

export function openPolicyRegistrar(
  input: Readonly<{ databasePath: string }>,
): PolicyRegistrar {
  return new PolicyRegistrar(input.databasePath);
}

export function openPolicyResolutionStore(
  input: Readonly<{
    databasePath: string;
    testInstrumentation?: Task97Instrumentation;
  }>,
): PolicyResolutionStore {
  return new PolicyResolutionStore(
    input.databasePath,
    input.testInstrumentation,
  );
}
