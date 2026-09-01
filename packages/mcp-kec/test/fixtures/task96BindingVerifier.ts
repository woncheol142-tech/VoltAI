import type { KecSourceBindingVerifier } from "../../src/knowledge/requirementExtraction.js";

export const establishedSyntheticBindingVerifier: KecSourceBindingVerifier =
  Object.freeze({
    verifyObservedBinding({ sourceRevision, blobHash }) {
      const established =
        typeof sourceRevision.sourceIdentity === "string" &&
        sourceRevision.sourceIdentity.length > 0 &&
        typeof sourceRevision.revisionKey === "string" &&
        sourceRevision.revisionKey.length > 0;
      const observed =
        blobHash.algorithm === "sha-256" &&
        /^[0-9a-f]{64}$/u.test(blobHash.digest);
      return Object.freeze({
        kind:
          established && observed
            ? ("BINDING_ADMITTED" as const)
            : ("BINDING_CONTRADICTION" as const),
      });
    },
  });
