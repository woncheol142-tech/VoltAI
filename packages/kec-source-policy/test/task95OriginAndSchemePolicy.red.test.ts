import { describe, expect, it } from "vitest";

import {
  automaticOriginInput,
  boundOriginAssertion,
  createPolicyHarness,
  loadPolicyUnderTest,
  nonOriginScheme,
  validObservation,
  validOriginScheme,
} from "./fixtures/task95ArchitectureContract.js";

async function policyFixture() {
  const harness = createPolicyHarness();
  const policy = await loadPolicyUnderTest(harness.dependencies);
  return { harness, policy };
}

describe("Task95 V4 origin authorization RED contracts", () => {
  it("RED-A candidate miss alone cannot authorize ESTABLISH_NEW_IDENTITY", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateOriginAuthorization(
      automaticOriginInput({
        registeredSchemes: Object.freeze([]),
        activeAutomaticOriginSchemeVersions: Object.freeze([]),
        candidates: Object.freeze([]),
        discoveryResult: "CANDIDATE_MISS",
        assertion: undefined,
      }),
    );

    expect(actual).toEqual({
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "NO_ACTIVE_ORIGIN_SCHEME",
    });
  });

  it("RED-B empty CandidateSet yields NO_RELATION_EVIDENCE_FROM_DISCOVERY without vacuous DIFFERENT", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateOriginAuthorization(
      automaticOriginInput({
        registeredSchemes: Object.freeze([]),
        activeAutomaticOriginSchemeVersions: Object.freeze([]),
        assertion: undefined,
        candidates: Object.freeze([]),
        relationAssessments: Object.freeze([]),
      }),
    );

    expect(actual).toEqual({
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      discoveryEvidence: "NO_RELATION_EVIDENCE_FROM_DISCOVERY",
    });
  });

  it("RED-C all discovered DIFFERENT_IDENTITY assessments remain insufficient without positive origin semantics", async () => {
    const { policy } = await policyFixture();
    const candidates = Object.freeze([
      Object.freeze({ sourceIdentity: "existing:one" }),
      Object.freeze({ sourceIdentity: "existing:two" }),
    ]);
    const actual = await policy.evaluateOriginAuthorization(
      automaticOriginInput({
        registeredSchemes: Object.freeze([nonOriginScheme()]),
        activeAutomaticOriginSchemeVersions: Object.freeze([]),
        assertion: Object.freeze({
          ...boundOriginAssertion,
          schemeId: "synthetic-kec-relation",
        }),
        candidates,
        relationAssessments: Object.freeze(
          candidates.map((candidate) =>
            Object.freeze({ candidate, relation: "DIFFERENT_IDENTITY" }),
          ),
        ),
      }),
    );

    expect(actual).toEqual({
      kind: "NOT_ESTABLISHED",
      automation: "HUMAN_JUDGEMENT_REQUIRED",
      reason: "NO_POSITIVE_ORIGIN_ASSERTION",
    });
  });

  it("RED-D zero active automatic origin schemes is a valid policy state", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.validateSchemeActivation({
      policyEpoch: "kec-policy-epoch:95-v4",
      registeredSchemes: Object.freeze([nonOriginScheme()]),
      activeAutomaticOriginSchemeVersions: Object.freeze([]),
    });

    expect(actual).toEqual({
      kind: "POLICY_VALID",
      automaticOrigin: "UNAVAILABLE",
      reason: "NO_ACTIVE_ORIGIN_SCHEME",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("RED-E exactly one structurally valid active origin scheme crosses the positive authorization boundary", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.establishIdentityAtomically(
      automaticOriginInput(),
    );

    expect(actual).toEqual({
      kind: "AUTO_ESTABLISH_NEW_IDENTITY",
      sourceIdentity: "opaque-source-identity-1",
      canonicalAssertionClaim: {
        schemeId: "synthetic-kec-origin",
        schemeVersion: "S1",
        canonicalValue: "SYN-0001",
      },
    });
    expect(harness.issuedIdentities).toEqual(["opaque-source-identity-1"]);
  });

  it("RED-F multiple active origin schemes fail closed globally without first/priority/order selection", async () => {
    const { policy } = await policyFixture();
    const second = validOriginScheme({
      schemeId: "synthetic-kec-origin-beta",
      identifierNamespace: "synthetic-kec-origin-beta:v1",
    });
    const actual = await policy.validateSchemeActivation({
      policyEpoch: "kec-policy-epoch:95-v4",
      registeredSchemes: Object.freeze([validOriginScheme(), second]),
      activeAutomaticOriginSchemeVersions: Object.freeze([
        Object.freeze({ schemeId: "synthetic-kec-origin", version: "S1" }),
        Object.freeze({
          schemeId: "synthetic-kec-origin-beta",
          version: "S1",
        }),
      ]),
      priorities: Object.freeze([
        Object.freeze({ schemeId: second.schemeId, priority: 1 }),
        Object.freeze({ schemeId: "synthetic-kec-origin", priority: 99 }),
      ]),
    });

    expect(actual).toEqual({
      kind: "INVALID_POLICY_CONFIGURATION",
      reason: "MULTIPLE_ACTIVE_ORIGIN_SCHEMES",
      automaticOrigin: "GLOBALLY_DISABLED",
    });
  });

  it("RED-G a non-origin relation-capable scheme cannot mint after proving all candidates different", async () => {
    const { harness, policy } = await policyFixture();
    const actual = await policy.evaluateOriginAuthorization(
      automaticOriginInput({
        registeredSchemes: Object.freeze([nonOriginScheme()]),
        activeAutomaticOriginSchemeVersions: Object.freeze([]),
        assertion: Object.freeze({
          ...boundOriginAssertion,
          schemeId: "synthetic-kec-relation",
        }),
        candidates: Object.freeze([
          Object.freeze({ sourceIdentity: "existing:one" }),
        ]),
        relationAssessments: Object.freeze([
          Object.freeze({
            sourceIdentity: "existing:one",
            relation: "DIFFERENT_IDENTITY",
          }),
        ]),
      }),
    );

    expect(actual).toEqual({
      kind: "NOT_ESTABLISHED",
      automation: "HUMAN_JUDGEMENT_REQUIRED",
      relationEvidenceRetained: true,
      reason: "SCHEME_NOT_ORIGIN_CAPABLE",
    });
    expect(harness.issuedIdentities).toEqual([]);
  });
});

describe("Task95 V4 assertion scheme structural validation RED contracts", () => {
  it.each([
    ["ALIASES_POSSIBLE", { aliasesPossible: "UNKNOWN" as const }],
    ["RENUMBERING_POSSIBLE", { renumberingPossible: "UNKNOWN" as const }],
    [
      "IDENTIFIER_REUSE_POSSIBLE",
      { identifierReusePossible: "UNKNOWN" as const },
    ],
  ])(
    "RED-H rejects origin-capable registration with %s = UNKNOWN",
    async (contradiction, override) => {
      const { policy } = await policyFixture();
      const scheme = validOriginScheme(override);
      const actual = await policy.validateSchemeActivation({
        policyEpoch: "kec-policy-epoch:95-v4",
        registeredSchemes: Object.freeze([scheme]),
        activeAutomaticOriginSchemeVersions: Object.freeze([
          Object.freeze({ schemeId: scheme.schemeId, version: scheme.version }),
        ]),
      });

      expect(actual).toEqual({
        kind: "INVALID_ASSERTION_SCHEME",
        reason: `ORIGIN_CAPABILITY_CONTRADICTS_${contradiction}`,
        automaticOrigin: "UNAVAILABLE",
      });
    },
  );

  it("RED-H rejects structurally valid-looking configuration without auditable semantic approval", async () => {
    const { policy } = await policyFixture();
    const scheme = validOriginScheme({
      semanticApproval: {
        policyDecisionId: "",
        evidenceReference: "",
        approvingAuthorityRole: "",
        policyEpoch: "kec-policy-epoch:95-v4",
      },
    });
    const actual = await policy.validateSchemeActivation({
      policyEpoch: "kec-policy-epoch:95-v4",
      registeredSchemes: Object.freeze([scheme]),
      activeAutomaticOriginSchemeVersions: Object.freeze([
        Object.freeze({ schemeId: scheme.schemeId, version: scheme.version }),
      ]),
    });

    expect(actual).toEqual({
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "SEMANTIC_REGISTRATION_APPROVAL_REQUIRED",
      automaticOrigin: "UNAVAILABLE",
    });
  });

  it("RED-H arbitrary metadata cannot substitute for a bound identity assertion", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateOriginAuthorization(
      automaticOriginInput({
        assertion: undefined,
        arbitraryMetadata: Object.freeze({
          publisher: "synthetic-authority:alpha",
          documentNumber: "SYN-0001",
          title: "metadata is not an assertion claim",
        }),
      }),
    );

    expect(actual).toEqual({
      kind: "NOT_ESTABLISHED",
      automation: "POLICY_LOOKUP_REQUIRED",
      reason: "BOUND_IDENTITY_ASSERTION_REQUIRED",
    });
  });

  it("RED-H assertion claims exclude V1 metadata basis-key coordinates", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.validateAssertionClaim({
      schemeId: "synthetic-kec-origin",
      schemeVersion: "S1",
      canonicalValue: "SYN-0001",
      forbiddenMetadataCoordinates: Object.freeze({
        publisher: "publisher-is-not-asserting-authority",
        documentScope: "scope-is-not-identity",
        blobDigest: "blob-is-not-identity",
        requestKey: "request-is-not-identity",
      }),
    });

    expect(actual).toEqual({
      kind: "INVALID_ASSERTION_CLAIM",
      reason: "ASSERTION_CLAIM_CONTAINS_NON_SCHEME_COORDINATES",
    });
  });

  it("RED-H keeps assertion authority distinct from citation authority", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.validateSchemeActivation({
      policyEpoch: "kec-policy-epoch:95-v4",
      registeredSchemes: Object.freeze([validOriginScheme()]),
      activeAutomaticOriginSchemeVersions: Object.freeze([]),
      citationPreference: "synthetic-publisher-preference-must-be-ignored",
    });

    expect(actual).toEqual({
      kind: "POLICY_VALID",
      automaticOrigin: "UNAVAILABLE",
      reason: "NO_ACTIVE_ORIGIN_SCHEME",
      automation: "POLICY_LOOKUP_REQUIRED",
    });
  });

  it("RED-H uses the bound assertion rather than publisher metadata at the positive boundary", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.evaluateOriginAuthorization(
      automaticOriginInput({
        observation: Object.freeze({
          ...validObservation,
          publisherMetadata: "unrelated-synthetic-publisher",
        }),
      }),
    );

    expect(actual).toEqual({
      kind: "AUTO_ORIGIN_AUTHORIZED",
      canonicalAssertionClaim: {
        schemeId: "synthetic-kec-origin",
        schemeVersion: "S1",
        canonicalValue: "SYN-0001",
      },
    });
  });
});
