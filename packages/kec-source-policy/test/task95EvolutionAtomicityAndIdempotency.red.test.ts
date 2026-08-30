import { describe, expect, it } from "vitest";

import {
  automaticOriginInput,
  createPolicyHarness,
  loadPolicyUnderTest,
  validOriginScheme,
} from "./fixtures/task95ArchitectureContract.js";

async function policyFixture() {
  const harness = createPolicyHarness();
  const policy = await loadPolicyUnderTest(harness.dependencies);
  return { harness, policy };
}

const semanticFieldChanges = [
  [
    "canonicalization",
    {
      ruleId: "case-fold-v2",
      deterministic: true,
      equivalencePreservingTransformations: ["CASE_FOLD"],
    },
  ],
  ["assertingAuthorityReference", "synthetic-authority:renamed"],
  ["identifierNamespace", "synthetic-kec-origin:v2"],
  ["equalitySemantics", "changed equality semantics"],
  ["differenceSemantics", "changed difference semantics"],
  ["aliasesPossible", "YES"],
  ["renumberingPossible", "YES"],
  ["identifierReusePossible", "YES"],
  ["originIssuanceCapability", "NO"],
  ["bindingRule", "synthetic-observation-field:changed-id"],
] as const;

describe("Task95 V4 scheme evolution RED contracts", () => {
  it.each(semanticFieldChanges)(
    "RED-I rejects in-place mutation of active/used S1 semantic field %s",
    async (field, replacement) => {
      const { policy } = await policyFixture();
      const s1 = validOriginScheme();
      const mutatedS1 = Object.freeze({ ...s1, [field]: replacement });
      const actual = await policy.replaceOriginSchemeVersion({
        activeUsedScheme: s1,
        proposedScheme: mutatedS1,
        issuedClaimCount: 1,
      });

      expect(actual).toEqual({
        kind: "ASSERTION_SCHEME_VERSION_CONFLICT",
        reason: "SEMANTIC_FIELDS_IMMUTABLE_AFTER_ACTIVATION",
        changedField: field,
        requiredVersion: "S2",
      });
    },
  );

  it("RED-J S2 never recanonicalizes or reinterprets an S1 historical claim", async () => {
    const { policy } = await policyFixture();
    const s1 = validOriginScheme();
    const s2 = validOriginScheme({
      version: "S2",
      canonicalization: {
        ruleId: "strip-zeroes-v2",
        deterministic: true,
        equivalencePreservingTransformations: ["STRIP_LEADING_ZEROES"],
      },
    });
    const actual = await policy.interpretHistoricalClaim({
      historicalClaim: Object.freeze({
        schemeId: s1.schemeId,
        schemeVersion: "S1",
        rawValue: "SYN-0001",
        canonicalValue: "SYN-0001",
        sourceIdentity: "opaque-source-identity-historical",
      }),
      historicalScheme: s1,
      currentScheme: s2,
    });

    expect(actual).toEqual({
      kind: "HISTORICAL_CLAIM_INTERPRETED",
      governingSchemeVersion: "S1",
      canonicalValue: "SYN-0001",
      sourceIdentity: "opaque-source-identity-historical",
      reminted: false,
    });
  });

  it("RED-K replacement origin S2 without cross-version correspondence fails closed", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.replaceOriginSchemeVersion({
      activeUsedScheme: validOriginScheme(),
      proposedScheme: validOriginScheme({ version: "S2" }),
      proposedDesignation: "ACTIVE_FOR_AUTOMATIC_ORIGIN",
      crossVersionCorrespondence: undefined,
      candidateDiscoveryCompleteness: "UNKNOWN_AND_IRRELEVANT",
    });

    expect(actual).toEqual({
      kind: "INVALID_ASSERTION_SCHEME",
      reason: "CROSS_VERSION_CORRESPONDENCE_REQUIRED",
      automaticOrigin: "UNAVAILABLE",
    });
  });
});

describe("Task95 V4 crosswalk and canonicalization RED contracts", () => {
  it("RED-L detects A SAME B, B SAME C, A DIFFERENT C and disables only the affected component", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.validateAssertionRelations({
      claims: Object.freeze(["A", "B", "C", "UNRELATED"]),
      edges: Object.freeze([
        Object.freeze({ left: "A", relation: "SAME", right: "B" }),
        Object.freeze({ left: "B", relation: "SAME", right: "C" }),
        Object.freeze({ left: "A", relation: "DIFFERENT", right: "C" }),
      ]),
      edgeOrder: Object.freeze(["newest-different", "older-same"]),
    });

    expect(actual).toEqual({
      kind: "CONFLICTING_ASSERTION_RELATIONS",
      affectedClaims: ["A", "B", "C"],
      automaticDecisions: "DISABLED_FOR_AFFECTED_COMPONENT",
      unaffectedClaims: ["UNRELATED"],
      winner: undefined,
    });
  });

  it("RED-M detects direct and symmetric SAME/DIFFERENT contradiction without an ordering winner", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.validateAssertionRelations({
      claims: Object.freeze(["A", "B"]),
      edges: Object.freeze([
        Object.freeze({ left: "A", relation: "SAME", right: "B" }),
        Object.freeze({ left: "B", relation: "DIFFERENT", right: "A" }),
      ]),
      priorities: Object.freeze([100, 1]),
    });

    expect(actual).toEqual({
      kind: "CONFLICTING_ASSERTION_RELATIONS",
      affectedClaims: ["A", "B"],
      automaticDecisions: "DISABLED_FOR_AFFECTED_COMPONENT",
      winner: undefined,
    });
  });

  it("RED-N undeclared canonical merge produces ASSERTION_CANONICALIZATION_COLLISION", async () => {
    const { policy } = await policyFixture();
    const actual = await policy.canonicalizeAssertionClaims({
      scheme: validOriginScheme({
        canonicalization: {
          ruleId: "separator-normalizer-bug",
          deterministic: true,
          equivalencePreservingTransformations: [],
        },
      }),
      observations: Object.freeze([
        Object.freeze({ rawValue: "SYN-0001", producedCanonical: "SYN0001" }),
        Object.freeze({ rawValue: "SYN0001", producedCanonical: "SYN0001" }),
      ]),
    });

    expect(actual).toEqual({
      kind: "ASSERTION_CANONICALIZATION_COLLISION",
      canonicalValue: "SYN0001",
      rawValues: ["SYN-0001", "SYN0001"],
      automaticOrigin: "DISABLED_FOR_CLAIM",
    });
  });
});

describe("Task95 V4 claim atomicity and request idempotency RED contracts", () => {
  it("RED-O concurrent request IDs with one canonical origin claim mint at most one SourceIdentity", async () => {
    const { harness, policy } = await policyFixture();
    const first = automaticOriginInput({
      requestKey: "issuance-request:atomic-1",
    });
    const second = automaticOriginInput({
      requestKey: "issuance-request:atomic-2",
    });

    const outcomes = await Promise.all([
      policy.establishIdentityAtomically(first),
      policy.establishIdentityAtomically(second),
    ]);

    expect(outcomes).toEqual([
      {
        kind: "AUTO_ESTABLISH_NEW_IDENTITY",
        sourceIdentity: "opaque-source-identity-1",
      },
      {
        kind: "REUSE_ESTABLISHED_IDENTITY",
        sourceIdentity: "opaque-source-identity-1",
      },
    ]);
    expect(harness.issuedIdentities).toEqual(["opaque-source-identity-1"]);
  });

  it("RED-P same request key plus same immutable content returns the same durable request outcome", async () => {
    const { policy } = await policyFixture();
    const request = Object.freeze({
      requestKey: "issuance-request:idempotent-1",
      immutableContent: Object.freeze({ observationId: "observation:fixed-1" }),
      proposedOutcome: Object.freeze({ kind: "REQUEST_ACCEPTED" }),
    });

    const first = await policy.registerIssuanceRequest(request);
    const replay = await policy.registerIssuanceRequest(request);

    expect(replay).toEqual(first);
  });

  it("RED-P same request key plus different content yields ISSUANCE_REQUEST_COLLISION", async () => {
    const { policy } = await policyFixture();
    await policy.registerIssuanceRequest({
      requestKey: "issuance-request:collision-1",
      immutableContent: Object.freeze({ observationId: "observation:A" }),
      proposedOutcome: Object.freeze({ kind: "REQUEST_ACCEPTED" }),
    });
    const actual = await policy.registerIssuanceRequest({
      requestKey: "issuance-request:collision-1",
      immutableContent: Object.freeze({ observationId: "observation:B" }),
      proposedOutcome: Object.freeze({ kind: "REQUEST_ACCEPTED" }),
    });

    expect(actual).toEqual({ kind: "ISSUANCE_REQUEST_COLLISION" });
  });

  it("RED-P different request keys with identical assertion content make no request-layer identity decision", async () => {
    const { policy } = await policyFixture();
    const immutableContent = Object.freeze({
      canonicalAssertionClaim: Object.freeze({
        schemeId: "synthetic-kec-origin",
        schemeVersion: "S1",
        canonicalValue: "SYN-0001",
      }),
    });
    const first = await policy.registerIssuanceRequest({
      requestKey: "issuance-request:independent-1",
      immutableContent,
      proposedOutcome: Object.freeze({ kind: "REQUEST_REGISTERED" }),
    });
    const second = await policy.registerIssuanceRequest({
      requestKey: "issuance-request:independent-2",
      immutableContent,
      proposedOutcome: Object.freeze({ kind: "REQUEST_REGISTERED" }),
    });

    expect(first).toEqual({
      kind: "REQUEST_REGISTERED",
      semanticIdentityDecision: "NOT_APPLICABLE",
    });
    expect(second).toEqual({
      kind: "REQUEST_REGISTERED",
      semanticIdentityDecision: "NOT_APPLICABLE",
    });
  });
});
