import type {
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "../../packages/source-core/src/index.js";
import { createKecSourcePolicy } from "../../packages/kec-source-policy/src/index.js";
import { describe, expect, it } from "vitest";

function policy() {
  return createKecSourcePolicy({
    opaqueIdentityIssuer: { issue: async () => "unused" as SourceIdentity },
    assertionClaimRegistry: {
      identityFor: () => undefined,
      associateAtomically: (_claim: string, identity: string) => identity,
    },
    issuanceRequestRegistry: {
      outcomeFor: () => undefined,
      register: () => undefined,
    },
  });
}

describe("Task97 inherited prerequisite contracts", () => {
  it("CASE1 Ministry 2024-749 vs KEA 2024-749 remains POLICY_LOOKUP_REQUIRED", async () => {
    expect(
      await policy().evaluateCurrentKecCase({
        caseId: "CASE1",
        left: {
          assertingAuthorityReference: "observed:ministry",
          observedIdentifier: "2024-749",
        },
        right: {
          assertingAuthorityReference: "observed:kea",
          observedIdentifier: "2024-749",
        },
        registeredAssertionSchemes: [],
      }),
    ).toEqual({
      identity: "UNKNOWN_RELATIONSHIP",
      revision: "NOT_APPLICABLE",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("CASE2 law.go.kr 2025-227 vs Ministry consolidated remains POLICY_LOOKUP_REQUIRED", async () => {
    expect(
      await policy().evaluateCurrentKecCase({
        caseId: "CASE2",
        left: {
          assertingAuthorityReference: "observed:law-go-kr",
          observedIdentifier: "2025-227",
        },
        right: {
          assertingAuthorityReference: "observed:ministry",
          observedIdentifier: "consolidated",
        },
        registeredAssertionSchemes: [],
      }),
    ).toEqual({
      identity: "UNKNOWN_RELATIONSHIP",
      revision: "NOT_APPLICABLE",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("CASE3 registry absence remains non-forcing and does not mint", async () => {
    expect(
      await policy().evaluateCurrentKecCase({
        caseId: "CASE3",
        observation: { publisher: "observed:ministry" },
        assertionClaimRegistryLookup: "ABSENT",
        candidates: [],
        registeredAssertionSchemes: [],
      }),
    ).toEqual({
      identityEstablishment: "NOT_ESTABLISHED",
      pairwiseIdentityRelation: "NOT_APPLICABLE",
      revision: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("CASE4 structurally permits identity A/revision A1 and identity B/revision B7 for one blob", () => {
    const blob: SourceBlobHash = Object.freeze({
      algorithm: "sha-256",
      digest: "4".repeat(64),
    });
    const revisions: readonly SourceRevision[] = [
      {
        sourceIdentity: "case4:A" as SourceIdentity,
        revisionKey: "case4:A1" as SourceRevisionKey,
      },
      {
        sourceIdentity: "case4:B" as SourceIdentity,
        revisionKey: "case4:B7" as SourceRevisionKey,
      },
    ];
    expect(
      new Set(revisions.map((revision) => revision.sourceIdentity)).size,
    ).toBe(2);
    expect(revisions.map(() => blob.digest)).toEqual([
      blob.digest,
      blob.digest,
    ]);
  });

  it("current Task95 configuration accepts zero active automatic origin schemes", async () => {
    expect(
      await policy().validateSchemeActivation({
        policyEpoch: "task97:current-kec",
        registeredSchemes: [],
        activeAutomaticOriginSchemeVersions: [],
      }),
    ).toEqual({
      kind: "POLICY_VALID",
      automaticOrigin: "UNAVAILABLE",
      reason: "NO_ACTIVE_ORIGIN_SCHEME",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });
});
