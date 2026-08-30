import { expect, test } from "vitest";

import {
  createPolicyHarness,
  loadPolicyUnderTest,
  validOriginScheme,
} from "./fixtures/task95ArchitectureContract.js";

test("replacement origin cannot mint without cross-version correspondence", async () => {
  const harness = createPolicyHarness();
  const policy = await loadPolicyUnderTest(harness.dependencies);
  const predecessor = validOriginScheme({ version: "S1" });
  const replacement = validOriginScheme({ version: "S2" });

  const result = await policy.establishIdentityAtomically({
    requestKey: "request:qa-s2-no-correspondence",
    immutableRequestContent: Object.freeze({
      observationId: "observation:qa-s2-no-correspondence",
    }),
    assertion: {
      schemeId: "synthetic-kec-origin",
      schemeVersion: "S2",
      canonicalValue: "SYN-0001",
      bindingStatus: "BOUND",
    },
    activeAutomaticOriginSchemeVersions: [
      { schemeId: "synthetic-kec-origin", version: "S2" },
    ],
    registeredSchemes: [predecessor, replacement],
    predecessorAutomaticOriginSchemeVersion: {
      schemeId: "synthetic-kec-origin",
      version: "S1",
    },
    crossVersionCorrespondence: undefined,
    relationConflict: false,
    canonicalizationCollision: false,
  });

  expect(result).toEqual({
    kind: "INVALID_ASSERTION_SCHEME",
    reason: "CROSS_VERSION_CORRESPONDENCE_REQUIRED",
    automaticOrigin: "UNAVAILABLE",
  });
  expect(harness.issuedIdentities).toEqual([]);
});
