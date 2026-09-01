import { describe, expect, it } from "vitest";

import {
  productionText,
  TASK97_RED_FAMILY_MAP,
  task97Paths,
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

function withResolutionSystem<Result>(
  run: (system: Task97System) => Result | Promise<Result>,
): Promise<Result> {
  return withTask97System(run, "resolution");
}

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

async function registerSyntheticPolicy(system: Task97System): Promise<void> {
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
        evidenceReference: "synthetic:no-real-kec-source",
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

function sourceIdentityOf(result: unknown): string {
  const handoff = established(result);
  const revision = handoff.sourceRevision as UnknownRecord;
  expect(typeof revision.sourceIdentity).toBe("string");
  return revision.sourceIdentity as string;
}

describe("Task97 V1 identity and observation firewall RED contracts", () => {
  task97Contract("A", "unresolved-does-not-mint", async () => {
    await withResolutionSystem(async (system) => {
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          rawIdentityAssertions: Object.freeze([
            Object.freeze({
              schemeId: "synthetic.identity",
              schemeVersion: "1",
              rawValue: "unbound",
              bindingStatus: "UNBOUND",
              bindingEvidenceRef: "evidence:none",
            }),
          ]),
        }),
      );
      expect([
        "POLICY_LOOKUP_REQUIRED",
        "HUMAN_JUDGEMENT_REQUIRED",
        "UNRESOLVED",
      ]).toContain(outcomeKind(result));
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
      expect(system.spies.issueRevision).not.toHaveBeenCalled();
      expect(system.spies.associateIdentity).not.toHaveBeenCalled();
      expect(system.spies.associateRevision).not.toHaveBeenCalled();
      expect(system.spies.admitBinding).not.toHaveBeenCalled();
      expect(system.spies.runVerifiedKecExtraction).not.toHaveBeenCalled();
    });
  });

  task97Contract("B", "blob-firewall", async () => {
    await withResolutionSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const sharedHash = Object.freeze({
        algorithm: "sha-256",
        digest: "b".repeat(64),
      });
      const first = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "observation:blob:A",
          acquisition: {
            ...(candidate().acquisition as UnknownRecord),
            observedBlobHash: sharedHash,
          },
        }),
      );
      const second = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "observation:blob:B",
          acquisition: {
            ...(candidate().acquisition as UnknownRecord),
            observedBlobHash: sharedHash,
          },
          rawIdentityAssertions: [
            {
              ...(
                candidate().rawIdentityAssertions as readonly UnknownRecord[]
              )[0],
              rawValue: "claim-B",
            },
          ],
          rawRevisionAssertions: [
            {
              ...(
                candidate().rawRevisionAssertions as readonly UnknownRecord[]
              )[0],
              rawRevisionState: "revision-7",
            },
          ],
        }),
      );
      expect(sourceIdentityOf(first)).not.toBe(sourceIdentityOf(second));
      expect(
        system.spies.associateIdentity.mock.calls.flat().join("|"),
      ).not.toContain(sharedHash.digest);
    });
  });

  task97Contract("C", "locator-firewall", async () => {
    await withResolutionSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const sharedLocator = Object.freeze({
        scheme: "https",
        value: "same.invalid/source",
      });
      const first = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "observation:locator:A",
          acquisition: {
            locator: sharedLocator,
            observedBlobHash: { algorithm: "sha-256", digest: "1".repeat(64) },
            observedByteLength: 100,
          },
        }),
      );
      const second = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "observation:locator:B",
          acquisition: {
            locator: sharedLocator,
            observedBlobHash: { algorithm: "sha-256", digest: "2".repeat(64) },
            observedByteLength: 101,
          },
          rawIdentityAssertions: [
            {
              ...(
                candidate().rawIdentityAssertions as readonly UnknownRecord[]
              )[0],
              rawValue: "claim-B",
            },
          ],
        }),
      );
      expect(sourceIdentityOf(first)).not.toBe(sourceIdentityOf(second));
      expect(
        system.spies.associateIdentity.mock.calls.flat().join("|"),
      ).not.toContain(sharedLocator.value);
    });
  });

  task97Contract("C", "no-blob-locator-identity-index", () => {
    const source = productionText(
      task97Paths.policySqliteRoot,
      "MISSING_KEC_SOURCE_POLICY_SQLITE",
    );
    expect(source).not.toMatch(
      /identityFor(?:Blob|Locator)|sourceIdentityBy(?:Blob|Locator)/i,
    );
    expect(source).not.toMatch(
      /CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*(?:blob_digest|locator)[^;]*source_identity/is,
    );
    expect(source).toMatch(/assertion_claim/i);
    expect(source).toMatch(/revision_claim/i);
  });

  task97Contract("D", "exact-claim-hit", async () => {
    await withResolutionSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const first = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      system.spies.issueIdentity.mockClear();
      const repeated = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({ observationId: "observation:repeat" }),
      );
      expect(sourceIdentityOf(repeated)).toBe(sourceIdentityOf(first));
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });

  task97Contract("E", "opaque-authorized-mint", async () => {
    await withResolutionSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const first = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      const second = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "opaque-mint:second-claim",
          rawIdentityAssertions: [
            {
              ...(
                candidate().rawIdentityAssertions as readonly UnknownRecord[]
              )[0],
              rawValue: "claim-B",
            },
          ],
        }),
      );
      const identity = sourceIdentityOf(first);
      const secondIdentity = sourceIdentityOf(second);
      expect(identity).toMatch(/^si:kec:v1:[0-9a-f]{32}$/);
      expect(secondIdentity).toMatch(/^si:kec:v1:[0-9a-f]{32}$/);
      expect(secondIdentity).not.toBe(identity);
      for (const leaked of [
        "example.invalid",
        "a".repeat(64),
        "claim-A",
        "revision-1",
        "Ministry",
      ]) {
        expect(identity).not.toContain(leaked);
        expect(secondIdentity).not.toContain(leaked);
      }
      expect(system.spies.issueIdentity).toHaveBeenCalledTimes(2);
    });
  });

  task97Contract("F", "identity-concurrency", async () => {
    await withResolutionSystem(async (system) => {
      await registerSyntheticPolicy(system);
      const results = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          call(
            system.resolution,
            "resolveSourceIdentityAndRevision",
            candidate({ observationId: `observation:race:${index}` }),
          ),
        ),
      );
      expect(new Set(results.map(sourceIdentityOf)).size).toBe(1);
      expect(await call(system.registrar, "countAssertionClaims")).toBe(1);
      expect(await call(system.registrar, "countAuthoritativeIdentities")).toBe(
        1,
      );
    });
  });

  task97Contract("G", "claim-collision", async () => {
    await withResolutionSystem(async (system) => {
      await registerSyntheticPolicy(system);
      await call(system.registrar, "seedAssertionClaim", {
        claimRegistryKey: "18:synthetic.identity|1:1|7:claim-A",
        sourceIdentity: "si:kec:v1:11111111111111111111111111111111",
      });
      const result = await call(
        system.registrar,
        "associateAssertionClaimAtomically",
        {
          claimRegistryKey: "18:synthetic.identity|1:1|7:claim-A",
          proposedSourceIdentity: "si:kec:v1:22222222222222222222222222222222",
        },
      );
      expect(outcomeKind(result)).toBe("IDENTITY_ISSUANCE_CONFLICT");
      expect(reasonOf(result)).toBe("ASSERTION_CLAIM_CONFLICT");
      expect(
        await call(
          system.registrar,
          "identityForClaim",
          "18:synthetic.identity|1:1|7:claim-A",
        ),
      ).toBe("si:kec:v1:11111111111111111111111111111111");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();

      const undeclaredCanonicalization = await call(
        system.registrar,
        "registerAssertionSchemeVersion",
        {
          epoch: "task97:test:epoch-1",
          scheme: {
            schemeId: "synthetic.colliding",
            version: "1",
            canonicalization: {
              ruleId: "synthetic:lowercase:v1",
              deterministic: true,
              equivalencePreservingTransformations: [],
              reviewedKnownVectors: [
                { raw: "CLAIM-A", canonical: "claim-a" },
                { raw: "claim-a", canonical: "claim-a" },
              ],
            },
          },
        },
      ).catch((failure: unknown) => failure);
      expect(undeclaredCanonicalization).toMatchObject({
        name: "PolicyRegistrationFailure",
        reason: "UNDECLARED_CANONICALIZATION_COLLISION",
      });
    });
  });

  task97Contract("AF", "registry-absence", async () => {
    await withResolutionSystem(async (system) => {
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(outcomeKind(result)).toBe("POLICY_LOOKUP_REQUIRED");
      expect(reasonOf(result)).toBe("NO_ACTIVE_ORIGIN_SCHEME");
      expect(await call(system.registrar, "countAcquisitionRecords")).toBe(1);
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();

      const samePublisher = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "publisher-firewall:second",
          rawIdentityAssertions: [
            {
              ...(
                candidate().rawIdentityAssertions as readonly UnknownRecord[]
              )[0],
              rawValue: "claim-B",
            },
          ],
          observedMetadata: [{ key: "publisher", value: "Ministry" }],
        }),
      );
      expect(outcomeKind(samePublisher)).toBe("POLICY_LOOKUP_REQUIRED");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });
});
