import { describe, expect, it } from "vitest";

import {
  TASK97_RED_FAMILY_MAP,
  type Task97Family,
} from "./fixtures/task97ArchitectureContract.js";
import {
  call,
  candidate,
  established,
  outcomeKind,
  reasonOf,
  withTask97System,
  type Task97System,
  type UnknownRecord,
} from "./fixtures/task97RuntimeHarness.js";

function task97Contract(
  label: Task97Family,
  id: string,
  run: () => unknown | Promise<unknown>,
): void {
  const contract = TASK97_RED_FAMILY_MAP[label].tests.find(
    (entry) => entry.id === id,
  );
  if (contract === undefined)
    throw new Error(`Unmapped Task97 contract ${label}:${id}`);
  it(`[${label}:${id}] ${contract.contract}`, run);
}

async function registerSchemes(system: Task97System): Promise<void> {
  await call(system.registrar, "registerAssertionSchemeVersion", {
    epoch: "task97:test:epoch-1",
    scheme: {
      schemeId: "synthetic.identity",
      version: "1",
      assertingAuthorityReference: "test:reviewed-policy-authority",
      identifierNamespace: "synthetic:test-only",
      canonicalization: {
        ruleId: "synthetic:identity:exact:v1",
        deterministic: true,
        equivalencePreservingTransformations: [],
      },
      bindingRule: "test-only explicit bound assertion",
      equalitySemantics: "exact canonical value",
      differenceSemantics: "distinct canonical values",
      aliasesPossible: "NO",
      renumberingPossible: "NO",
      identifierReusePossible: "NO",
      originIssuanceCapability: "YES",
      semanticApproval: {
        policyDecisionId: "reviewed:test-only:identity-v1",
        evidenceReference: "synthetic:no-real-source",
        approvingAuthorityRole: "PolicyRegistrar",
        policyEpoch: "task97:test:epoch-1",
      },
    },
  });
  await call(system.registrar, "replaceActiveOriginScheme", {
    epoch: "task97:test:epoch-1",
    schemeId: "synthetic.identity",
    schemeVersion: "1",
  });
  await call(system.registrar, "registerRevisionAssertionScheme", {
    epoch: "task97:test:epoch-1",
    scheme: {
      kind: "SOURCE_REVISION_ASSERTION_SCHEME",
      schemeId: "synthetic.revision",
      schemeVersion: "1",
      assertingAuthorityReference: "test:reviewed-policy-authority",
      revisionStateNamespace: "synthetic:test-only",
      canonicalization: {
        ruleId: "synthetic:revision:exact:v1",
        transformations: [],
      },
    },
  });
}

async function registerIdentitySuccessor(
  system: Task97System,
  version: string,
): Promise<void> {
  await call(system.registrar, "registerAssertionSchemeVersion", {
    epoch: "task97:test:epoch-1",
    scheme: {
      schemeId: "synthetic.identity",
      version,
      assertingAuthorityReference: "test:reviewed-policy-authority",
      identifierNamespace: `synthetic:test-only:v${version}`,
      canonicalization: {
        ruleId: `synthetic:identity:exact:v${version}`,
        deterministic: true,
        equivalencePreservingTransformations: [],
      },
      bindingRule: "test-only explicit bound assertion",
      equalitySemantics: "exact canonical value",
      differenceSemantics: "distinct canonical values",
      aliasesPossible: "NO",
      renumberingPossible: "NO",
      identifierReusePossible: "NO",
      originIssuanceCapability: "YES",
      semanticApproval: {
        policyDecisionId: `reviewed:test-only:identity-v${version}`,
        evidenceReference: "synthetic:no-real-source",
        approvingAuthorityRole: "PolicyRegistrar",
        policyEpoch: "task97:test:epoch-1",
      },
    },
  });
}

function sourceRevisionOf(result: unknown): UnknownRecord {
  return established(result).sourceRevision as UnknownRecord;
}

describe("Task97 V1 revision, persistence, and failure RED contracts", () => {
  task97Contract("M", "historical-scheme-stability", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const underS1 = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      const revisionS1 = sourceRevisionOf(underS1);
      await call(system.registrar, "registerRevisionAssertionScheme", {
        epoch: "task97:test:epoch-2",
        scheme: {
          kind: "SOURCE_REVISION_ASSERTION_SCHEME",
          schemeId: "synthetic.revision",
          schemeVersion: "2",
          assertingAuthorityReference: "test:reviewed-policy-authority",
          revisionStateNamespace: "synthetic:test-only-v2",
          canonicalization: {
            ruleId: "synthetic:revision:prefix-v2",
            transformations: ["PREFIX_V2"],
          },
        },
      });
      await call(system.registrar, "activateEpoch", "task97:test:epoch-2");
      const reloaded = await call(
        system.resolution,
        "loadEstablishedSourceRevision",
        revisionS1,
      );
      expect((reloaded as UnknownRecord).sourceRevision).toEqual(revisionS1);
      expect((reloaded as UnknownRecord).revisionBasis).toMatchObject({
        schemeVersion: "1",
      });
    });
  });

  task97Contract("N", "cross-version-fail-closed", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      await registerIdentitySuccessor(system, "2");
      for (const correspondence of [
        undefined,
        { kind: "PARTIAL_MAPPING", mappings: [{ from: "A", to: "A2" }] },
        {
          kind: "CONTRADICTORY_MAPPING",
          mappings: [
            { from: "A", to: "A2" },
            { from: "A", to: "A3" },
          ],
        },
      ]) {
        const result = await call(
          system.resolution,
          "evaluateCrossVersionCorrespondence",
          {
            predecessor: {
              schemeId: "synthetic.identity",
              version: "1",
              canonicalValue: "claim-A",
            },
            successor: {
              schemeId: "synthetic.identity",
              version: "2",
              canonicalValue: "claim-A",
            },
            correspondence,
          },
        );
        expect(outcomeKind(result)).toBe("POLICY_LOOKUP_REQUIRED");
        expect(reasonOf(result)).toBe(
          "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
        );
      }
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });

    await withTask97System(async (system) => {
      await registerSchemes(system);
      await registerIdentitySuccessor(system, "2");
      await registerIdentitySuccessor(system, "3");
      await call(system.registrar, "registerCrossVersionCorrespondence", {
        epoch: "task97:test:epoch-1",
        predecessor: { schemeId: "synthetic.identity", version: "1" },
        successor: { schemeId: "synthetic.identity", version: "2" },
        correspondence: {
          kind: "PARTIAL_MAPPING",
          mappings: [{ from: "claim-A", to: "claim-A2" }],
        },
      });
      await call(system.registrar, "registerCrossVersionCorrespondence", {
        epoch: "task97:test:epoch-1",
        predecessor: { schemeId: "synthetic.identity", version: "1" },
        successor: { schemeId: "synthetic.identity", version: "3" },
        correspondence: {
          kind: "CONTRADICTORY_MAPPING",
          mappings: [
            { from: "claim-A", to: "claim-A2" },
            { from: "claim-A", to: "claim-A3" },
          ],
        },
      });
      for (const version of ["2", "3"]) {
        const result = await call(
          system.resolution,
          "evaluateCrossVersionCorrespondence",
          {
            predecessor: {
              schemeId: "synthetic.identity",
              version: "1",
              canonicalValue: "claim-A",
            },
            successor: {
              schemeId: "synthetic.identity",
              version,
              canonicalValue: "claim-A",
            },
          },
        );
        expect(outcomeKind(result)).toBe("POLICY_LOOKUP_REQUIRED");
        expect(reasonOf(result)).toBe(
          "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
        );
      }
    });

    await withTask97System(async (system) => {
      await registerSchemes(system);
      await registerIdentitySuccessor(system, "2");
      await call(system.registrar, "seedAssertionClaim", {
        claimRegistryKey: "18:synthetic.identity|1:1|7:claim-A",
        sourceIdentity: "si:kec:v1:11111111111111111111111111111111",
      });
      await call(system.registrar, "registerCrossVersionCorrespondence", {
        epoch: "task97:test:epoch-1",
        predecessor: { schemeId: "synthetic.identity", version: "1" },
        successor: { schemeId: "synthetic.identity", version: "2" },
        correspondence: {
          kind: "EXPLICIT_CLAIM_MAPPING",
          predecessorSchemeVersion: {
            schemeId: "synthetic.identity",
            version: "1",
          },
          successorSchemeVersion: {
            schemeId: "synthetic.identity",
            version: "2",
          },
          mappings: [
            {
              predecessorCanonicalValue: "claim-A",
              successorCanonicalValue: "claim-A2",
            },
          ],
        },
      });
      await call(system.registrar, "replaceActiveOriginScheme", {
        epoch: "task97:test:epoch-1",
        schemeId: "synthetic.identity",
        schemeVersion: "2",
      });
      const mapped = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "observation:cross-version:mapped",
          rawIdentityAssertions: [
            {
              schemeId: "synthetic.identity",
              schemeVersion: "2",
              rawValue: "claim-A2",
              bindingStatus: "BOUND",
              bindingEvidenceRef: "evidence:bound-identity-v2",
            },
          ],
        }),
      );
      expect(sourceRevisionOf(mapped).sourceIdentity).toBe(
        "si:kec:v1:11111111111111111111111111111111",
      );
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });

    await withTask97System(async (system) => {
      await registerSchemes(system);
      await registerIdentitySuccessor(system, "3");
      await call(system.registrar, "registerCrossVersionCorrespondence", {
        epoch: "task97:test:epoch-1",
        predecessor: { schemeId: "synthetic.identity", version: "1" },
        successor: { schemeId: "synthetic.identity", version: "3" },
        correspondence: {
          kind: "DISJOINT_IDENTIFIER_SPACE",
          predecessorSchemeVersion: {
            schemeId: "synthetic.identity",
            version: "1",
          },
          successorSchemeVersion: {
            schemeId: "synthetic.identity",
            version: "3",
          },
        },
      });
      await call(system.registrar, "replaceActiveOriginScheme", {
        epoch: "task97:test:epoch-1",
        schemeId: "synthetic.identity",
        schemeVersion: "3",
      });
      const disjoint = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "observation:cross-version:disjoint",
          rawIdentityAssertions: [
            {
              schemeId: "synthetic.identity",
              schemeVersion: "3",
              rawValue: "claim-new-space",
              bindingStatus: "BOUND",
              bindingEvidenceRef: "evidence:bound-identity-v3",
            },
          ],
        }),
      );
      expect(outcomeKind(disjoint)).toBe("IDENTITY_AND_REVISION_ESTABLISHED");
      expect(system.spies.issueIdentity).toHaveBeenCalledTimes(1);
    });
  });

  task97Contract("O", "revision-evidence-firewall", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          rawRevisionAssertions: [],
          observedMetadata: [
            { key: "filename", value: "KEC-2025.pdf" },
            { key: "last-modified", value: "2025-01-01" },
            { key: "document-date", value: "2025" },
            { key: "page-count", value: "749" },
          ],
        }),
      );
      expect(outcomeKind(result)).toBe(
        "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
      );
      expect((result as UnknownRecord).revisionOutcome).toBe("UNRESOLVED");
      expect(reasonOf(result)).toBe("INSUFFICIENT_REVISION_EVIDENCE");
      expect(system.spies.issueRevision).not.toHaveBeenCalled();
    });
  });

  task97Contract("O", "revision-scheme-authority", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const attacked = candidate({
        revisionAssertionScheme: {
          kind: "SOURCE_REVISION_ASSERTION_SCHEME",
          schemeId: "caller.forged.revision",
          schemeVersion: "999",
          assertingAuthorityReference: "caller:self",
          revisionStateNamespace: "caller:chosen",
        },
        rawRevisionAssertions: [
          {
            schemeId: "caller.forged.revision",
            schemeVersion: "999",
            rawRevisionState: "caller-says-revision",
            bindingStatus: "BOUND",
            bindingEvidenceRef: "caller:self",
          },
        ],
      });
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        attacked,
      );
      expect(outcomeKind(result)).toBe(
        "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
      );
      expect((result as UnknownRecord).revisionOutcome).toBe(
        "POLICY_LOOKUP_REQUIRED",
      );
      expect(reasonOf(result)).toBe("REVISION_SCHEME_NOT_REGISTERED");
      expect(system.spies.issueRevision).not.toHaveBeenCalled();
    });
  });

  task97Contract("P", "revision-unknown", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const result = await call(
        system.resolution,
        "resolveRevisionFromJudgement",
        {
          candidate: candidate(),
          decision: "UNKNOWN_RELATIONSHIP",
        },
      );
      expect(outcomeKind(result)).toBe(
        "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
      );
      expect(reasonOf(result)).toBe("UNKNOWN_REVISION_RELATIONSHIP");
      expect(system.spies.issueRevision).not.toHaveBeenCalled();
      expect(await call(system.registrar, "countRevisionClaims")).toBe(0);
    });
  });

  task97Contract("P", "revision-concurrency", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const results = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          call(
            system.resolution,
            "resolveSourceIdentityAndRevision",
            candidate({ observationId: `revision-race:${index}` }),
          ),
        ),
      );
      const revisionKeys = results.map(
        (result) => sourceRevisionOf(result).revisionKey,
      );
      expect(new Set(revisionKeys).size).toBe(1);
      expect(await call(system.registrar, "countRevisionClaims")).toBe(1);
      expect(
        await call(system.registrar, "countEstablishedSourceRevisions"),
      ).toBe(1);
    });
  });

  task97Contract("Q", "resolution-idempotency", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const results = [];
      for (let index = 0; index < 10; index += 1) {
        results.push(
          await call(
            system.resolution,
            "resolveSourceIdentityAndRevision",
            candidate(),
          ),
        );
      }
      expect(
        new Set(
          results.map((result) => JSON.stringify(sourceRevisionOf(result))),
        ).size,
      ).toBe(1);
      expect(await call(system.registrar, "countAssertionClaims")).toBe(1);
      expect(await call(system.registrar, "countRevisionClaims")).toBe(1);
      expect(system.spies.issueIdentity).toHaveBeenCalledTimes(1);
      expect(system.spies.issueRevision).toHaveBeenCalledTimes(1);

      const identityOnly = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "partial-progress:first",
          rawIdentityAssertions: [
            {
              ...(
                candidate().rawIdentityAssertions as readonly UnknownRecord[]
              )[0],
              rawValue: "partial-claim",
            },
          ],
          rawRevisionAssertions: [],
        }),
      );
      expect(outcomeKind(identityOnly)).toBe(
        "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
      );
      const identityIssueCount = system.spies.issueIdentity.mock.calls.length;
      const resumed = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "partial-progress:retry",
          rawIdentityAssertions: [
            {
              ...(
                candidate().rawIdentityAssertions as readonly UnknownRecord[]
              )[0],
              rawValue: "partial-claim",
            },
          ],
        }),
      );
      expect(outcomeKind(resumed)).toBe("IDENTITY_AND_REVISION_ESTABLISHED");
      expect(system.spies.issueIdentity).toHaveBeenCalledTimes(
        identityIssueCount,
      );
    });
  });

  task97Contract("R", "durable-reload", async () => {
    await withTask97System(async (system) => {
      await registerSchemes(system);
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      const handoff = established(result);
      await call(system.resolution, "close");
      const reopened = (await call(system.registrar, "openReadOnlyResolution", {
        policyEpoch: "task97:test:epoch-1",
      })) as UnknownRecord;
      const reloaded = await call(
        reopened,
        "loadEstablishedSourceRevision",
        handoff.sourceRevision,
      );
      expect(reloaded).toMatchObject({
        sourceRevision: handoff.sourceRevision,
        identityBasis: handoff.identityBasis,
        revisionBasis: handoff.revisionBasis,
      });
      expect(
        await call(
          reopened,
          "findEstablishedRevisionByBlob",
          (candidate().acquisition as UnknownRecord).observedBlobHash,
        ),
      ).toEqual({ kind: "NOT_ESTABLISHED" });
      expect(
        await call(
          reopened,
          "findEstablishedRevisionByLocator",
          (candidate().acquisition as UnknownRecord).locator,
        ),
      ).toEqual({ kind: "NOT_ESTABLISHED" });
      await call(reopened, "close");
    });
  });

  task97Contract("Y", "infrastructure-is-not-domain", async () => {
    await withTask97System(async (system) => {
      await call(system.resolution, "close");
      const failure = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      ).catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({
        name: "SourceResolutionStoreFailure",
        category: expect.stringMatching(/^(unavailable|transaction|corrupt)$/),
      });
      expect(outcomeKind(failure)).not.toBe("UNRESOLVED");
      expect(outcomeKind(failure)).not.toBe("POLICY_LOOKUP_REQUIRED");
      expect(outcomeKind(failure)).not.toBe("HUMAN_JUDGEMENT_REQUIRED");
    });
  });
});
