export { questionKeys } from "./questions.js";
export { KecSourceResolutionRuntime } from "./runtime.js";
export type {
  EstablishedSourceRevision,
  ObservedSourceCandidate,
  Task97ResolutionOutcome,
} from "./types.js";
export type ResolveSourceIdentityAndRevision =
  KecSourceResolutionRuntime["resolveSourceIdentityAndRevision"];

import { KecSourceResolutionRuntime } from "./runtime.js";
import type { ResolutionInstrumentation } from "./types.js";

export function openKecSourceResolution(
  input: Readonly<{
    policyDatabasePath: string;
    judgementDatabasePath: string;
    policyEpoch: string;
    testInstrumentation?: ResolutionInstrumentation;
  }>,
): KecSourceResolutionRuntime {
  return new KecSourceResolutionRuntime(input);
}
