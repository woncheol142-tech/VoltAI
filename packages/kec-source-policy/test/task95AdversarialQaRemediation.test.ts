import { describe, expect, it } from "vitest";

import {
  createPolicyHarness,
  loadPolicyUnderTest,
  validOriginScheme,
} from "./fixtures/task95ArchitectureContract.js";

const schemeId = "novel-origin-authority-scheme";
const predecessor = Object.freeze({
  schemeId,
  version: "legacy-epoch-17",
});
const successor = Object.freeze({
  schemeId,
  version: "replacement-epoch-23",
});

type Correspondence = Readonly<
  | {
      kind: "EXPLICIT_CLAIM_MAPPING";
      predecessorSchemeVersion: typeof predecessor;
      successorSchemeVersion: typeof successor;
      mappings: readonly Readonly<{
        predecessorCanonicalValue: string;
        successorCanonicalValue: string;
      }>[];
    }
  | {
      kind: "DISJOINT_IDENTIFIER_SPACE";
      predecessorSchemeVersion: typeof predecessor;
      successorSchemeVersion: typeof successor;
    }
>;

function scheme(version: string, transformations: readonly string[] = []) {
  return validOriginScheme({
    schemeId,
    version,
    assertingAuthorityReference: "novel-authority:delta",
    identifierNamespace: "novel-identifiers:v17",
    canonicalization: {
      ruleId: "novel-declared-transformations",
      deterministic: true,
      equivalencePreservingTransformations: transformations,
    },
    bindingRule: "novel-observation:identifier",
    semanticApproval: {
      policyDecisionId: "policy-decision:novel-origin",
      evidenceReference: "evidence:novel-origin-contract",
      approvingAuthorityRole: "SOURCE_POLICY_APPROVER",
      policyEpoch: "policy-epoch:novel-41",
    },
  });
}

function claimRegistryKey(version: string, canonicalValue: string): string {
  return [schemeId, version, canonicalValue]
    .map((coordinate) => `${coordinate.length}:${coordinate}`)
    .join("|");
}

function originInput(
  version: string,
  canonicalValue: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const assertion = Object.freeze({
    observationId: "observation:novel-claim",
    schemeId,
    schemeVersion: version,
    rawValue: canonicalValue,
    canonicalValue,
    bindingStatus: "BOUND",
  });
  return Object.freeze({
    requestKey: `request:novel:${version}:${canonicalValue}`,
    immutableRequestContent: Object.freeze({
      observationId: assertion.observationId,
      assertion,
    }),
    observation: Object.freeze({
      observationId: assertion.observationId,
      validity: "VALID_SOURCE_OBSERVATION",
    }),
    assertion,
    registeredSchemes: Object.freeze([scheme(version)]),
    activeAutomaticOriginSchemeVersions: Object.freeze([
      Object.freeze({ schemeId, version }),
    ]),
    candidates: Object.freeze([]),
    relationAssessments: Object.freeze([]),
    relationConflict: false,
    canonicalizationCollision: false,
    ...overrides,
  });
}

function replacementInput(
  canonicalValue: string,
  correspondence: Correspondence | undefined,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return originInput(successor.version, canonicalValue, {
    registeredSchemes: Object.freeze([
      scheme(predecessor.version),
      scheme(successor.version),
    ]),
    predecessorAutomaticOriginSchemeVersion: predecessor,
    crossVersionCorrespondence: correspondence,
    candidateDiscoveryCompleteness: "UNKNOWN_AND_IRRELEVANT",
    ...overrides,
  });
}

function explicitMapping(
  predecessorCanonicalValue: string,
  successorCanonicalValue: string,
): Correspondence {
  return Object.freeze({
    kind: "EXPLICIT_CLAIM_MAPPING",
    predecessorSchemeVersion: predecessor,
    successorSchemeVersion: successor,
    mappings: Object.freeze([
      Object.freeze({
        predecessorCanonicalValue,
        successorCanonicalValue,
      }),
    ]),
  });
}

function observations(
  leftRaw: string,
  rightRaw: string,
  canonicalValue: string,
) {
  return Object.freeze([
    Object.freeze({ rawValue: leftRaw, producedCanonical: canonicalValue }),
    Object.freeze({ rawValue: rightRaw, producedCanonical: canonicalValue }),
  ]);
}

async function policyFixture() {
  const harness = createPolicyHarness();
  const policy = await loadPolicyUnderTest(harness.dependencies);
  return { harness, policy };
}

describe("Task95 cross-version origin remediation", () => {
  it("CV-1 permits ordinary origin for the first-ever origin version", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      originInput("first-policy-version", "NOVEL-001"),
    );

    expect(actual).toEqual({
      kind: "AUTO_ESTABLISH_NEW_IDENTITY",
      sourceIdentity: "opaque-source-identity-1",
      canonicalAssertionClaim: {
        schemeId,
        schemeVersion: "first-policy-version",
        canonicalValue: "NOVEL-001",
      },
    });
    expect(harness.issuedIdentities).toEqual(["opaque-source-identity-1"]);
  });

  it("CV-2 fails closed when a replacement has no correspondence", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      replacementInput("NOVEL-002", undefined),
    );

    expect(actual).toEqual({
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "CROSS_VERSION_CORRESPONDENCE_REQUIRED",
      automaticOrigin: "UNAVAILABLE",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });

  it("CV-3 fails closed when correspondence has no mapping for the S2 claim", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      replacementInput(
        "NOVEL-UNRESOLVED",
        explicitMapping("LEGACY-OTHER", "NOVEL-OTHER"),
      ),
    );

    expect(actual).toEqual({
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });

  it("CV-4 keeps an empty candidate set irrelevant to unresolved correspondence", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      replacementInput(
        "NOVEL-EMPTY-CANDIDATES",
        explicitMapping("LEGACY-OTHER", "NOVEL-OTHER"),
        {
          candidates: Object.freeze([]),
          discoveryResult: "CANDIDATE_MISS",
        },
      ),
    );

    expect(actual).toMatchObject({
      kind: "NOT_ESTABLISHED",
      reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });

  it("CV-5 keeps all-DIFFERENT candidates irrelevant to unresolved correspondence", async () => {
    const { harness, policy } = await policyFixture();
    const candidate = Object.freeze({ sourceIdentity: "historical:other" });
    const actual = await policy.establishIdentityAtomically(
      replacementInput(
        "NOVEL-DIFFERENT-CANDIDATES",
        explicitMapping("LEGACY-OTHER", "NOVEL-OTHER"),
        {
          candidates: Object.freeze([candidate]),
          relationAssessments: Object.freeze([
            Object.freeze({ candidate, relation: "DIFFERENT_IDENTITY" }),
          ]),
        },
      ),
    );

    expect(actual).toMatchObject({
      kind: "NOT_ESTABLISHED",
      reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });

  it("keeps unavailable candidate discovery irrelevant to unresolved correspondence", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      replacementInput(
        "NOVEL-DISCOVERY-UNAVAILABLE",
        explicitMapping("LEGACY-OTHER", "NOVEL-OTHER"),
        {
          candidates: undefined,
          relationAssessments: undefined,
          discoveryResult: "UNAVAILABLE",
        },
      ),
    );

    expect(actual).toMatchObject({
      kind: "NOT_ESTABLISHED",
      reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });

  it("CV-6 maps an S2 claim to the existing S1 identity without minting", async () => {
    const { harness, policy } = await policyFixture();
    const historicalIdentity = "opaque-historical-identity-A";
    harness.dependencies.assertionClaimRegistry.associateAtomically(
      claimRegistryKey(predecessor.version, "LEGACY-006"),
      historicalIdentity,
    );

    const actual = await policy.establishIdentityAtomically(
      replacementInput("NOVEL-006", explicitMapping("LEGACY-006", "NOVEL-006")),
    );

    expect(actual).toEqual({
      kind: "REUSE_ESTABLISHED_IDENTITY",
      sourceIdentity: historicalIdentity,
    });
    expect(harness.issuedIdentities).toEqual([]);
    expect(
      harness.dependencies.assertionClaimRegistry.identityFor(
        claimRegistryKey(successor.version, "NOVEL-006"),
      ),
    ).toBe(historicalIdentity);
  });

  it("CV-7 permits a positively declared disjoint successor space", async () => {
    const { harness, policy } = await policyFixture();
    const correspondence = Object.freeze({
      kind: "DISJOINT_IDENTIFIER_SPACE" as const,
      predecessorSchemeVersion: predecessor,
      successorSchemeVersion: successor,
    });

    const actual = await policy.establishIdentityAtomically(
      replacementInput("NOVEL-DISJOINT-007", correspondence),
    );

    expect(actual).toMatchObject({
      kind: "AUTO_ESTABLISH_NEW_IDENTITY",
      sourceIdentity: "opaque-source-identity-1",
    });
    expect(harness.issuedIdentities).toEqual(["opaque-source-identity-1"]);
  });
});

describe("Task95 transformation-specific canonicalization remediation", () => {
  it("CAN-1 accepts a slash-only collapse when STRIP_SLASH is declared", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v1", ["STRIP_SLASH"]),
      observations: observations("AB/C", "ABC", "ABC"),
    });

    expect(actual).toEqual({ kind: "ASSERTION_CLAIMS_CANONICALIZED" });
  });

  it("CAN-2 rejects a case-only collapse when only STRIP_SLASH is declared", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v2", ["STRIP_SLASH"]),
      observations: observations("ABC", "abc", "ABC"),
    });

    expect(actual).toEqual({
      kind: "ASSERTION_CANONICALIZATION_COLLISION",
      canonicalValue: "ABC",
      rawValues: ["ABC", "abc"],
      automaticOrigin: "DISABLED_FOR_CLAIM",
    });
  });

  it("CAN-3 accepts a case-only collapse when CASE_FOLD is declared", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v3", ["CASE_FOLD"]),
      observations: observations("ABC", "abc", "ABC"),
    });

    expect(actual).toEqual({ kind: "ASSERTION_CLAIMS_CANONICALIZED" });
  });

  it("CAN-4 rejects a slash-only collapse when only CASE_FOLD is declared", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v4", ["CASE_FOLD"]),
      observations: observations("AB/C", "ABC", "ABC"),
    });

    expect(actual).toEqual({
      kind: "ASSERTION_CANONICALIZATION_COLLISION",
      canonicalValue: "ABC",
      rawValues: ["AB/C", "ABC"],
      automaticOrigin: "DISABLED_FOR_CLAIM",
    });
  });

  it("CAN-5 preserves distinct raw identifiers when no transformations are declared", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v5"),
      observations: Object.freeze([
        Object.freeze({ rawValue: "NOVEL-A", producedCanonical: "NOVEL-A" }),
        Object.freeze({ rawValue: "novel-a", producedCanonical: "novel-a" }),
      ]),
    });

    expect(actual).toEqual({ kind: "ASSERTION_CLAIMS_CANONICALIZED" });
  });

  it("CAN-6 applies multiple declared transformations deterministically", async () => {
    const { policy } = await policyFixture();
    const forward = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v6", ["STRIP_SLASH", "CASE_FOLD"]),
      observations: observations("AB/C", "abc", "ABC"),
    });
    const reversed = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v6-reversed", ["CASE_FOLD", "STRIP_SLASH"]),
      observations: observations("AB/C", "abc", "ABC"),
    });

    expect(forward).toEqual({ kind: "ASSERTION_CLAIMS_CANONICALIZED" });
    expect(reversed).toEqual({ kind: "ASSERTION_CLAIMS_CANONICALIZED" });
  });

  it("does not classify exact repeated raw equality as a collision", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-exact-raw"),
      observations: observations("EXACT-RAW", "EXACT-RAW", "EXACT-RAW"),
    });

    expect(actual).toEqual({ kind: "ASSERTION_CLAIMS_CANONICALIZED" });
  });

  it("CAN-7 rejects an unsupported transformation", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: scheme("canonical-v7", ["TRIM_WHITESPACE"]),
      observations: Object.freeze([
        Object.freeze({ rawValue: " ABC ", producedCanonical: "ABC" }),
      ]),
    });

    expect(actual).toEqual({
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "UNSUPPORTED_CANONICALIZATION_TRANSFORMATION",
      automaticOrigin: "UNAVAILABLE",
    });
  });

  it("keeps every issuance and registry side effect at zero on collision", async () => {
    const harness = createPolicyHarness();
    let claimRegistryWrites = 0;
    let requestRegistryWrites = 0;
    const policy = await loadPolicyUnderTest({
      ...harness.dependencies,
      assertionClaimRegistry: {
        identityFor: (claim) =>
          harness.dependencies.assertionClaimRegistry.identityFor(claim),
        associateAtomically: (claim, identity) => {
          claimRegistryWrites += 1;
          return harness.dependencies.assertionClaimRegistry.associateAtomically(
            claim,
            identity,
          );
        },
      },
      issuanceRequestRegistry: {
        outcomeFor: (requestKey) =>
          harness.dependencies.issuanceRequestRegistry.outcomeFor(requestKey),
        register: (requestKey, content, outcome) => {
          requestRegistryWrites += 1;
          return harness.dependencies.issuanceRequestRegistry.register(
            requestKey,
            content,
            outcome,
          );
        },
      },
    });
    const activeScheme = scheme("canonical-runtime-v8", ["STRIP_SLASH"]);
    const actual = await policy.establishIdentityAtomically(
      originInput("canonical-runtime-v8", "ABC", {
        registeredSchemes: Object.freeze([activeScheme]),
        observations: observations("ABC", "abc", "ABC"),
      }),
    );

    expect(actual).toEqual({
      kind: "ASSERTION_CANONICALIZATION_COLLISION",
      canonicalValue: "ABC",
      rawValues: ["ABC", "abc"],
      automaticOrigin: "DISABLED_FOR_CLAIM",
    });
    expect(harness.issuedIdentities).toEqual([]);
    expect(claimRegistryWrites).toBe(0);
    expect(requestRegistryWrites).toBe(0);
    expect(harness.issuedRevisionKeys).toEqual([]);
    expect(harness.registeredRevisions).toEqual([]);
  });
});
