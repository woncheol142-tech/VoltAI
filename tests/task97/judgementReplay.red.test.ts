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

function withJudgementSystem<Result>(
  run: (system: Task97System) => Result | Promise<Result>,
): Promise<Result> {
  return withTask97System(run, "judgement");
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

async function registerJudgementOnlyScheme(
  system: Task97System,
): Promise<void> {
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
      originIssuanceCapability: "NO",
      semanticApproval: {
        policyDecisionId: "reviewed:test-only:judgement-origin",
        evidenceReference: "synthetic:no-real-source",
        approvingAuthorityRole: "PolicyRegistrar",
        policyEpoch: "task97:test:epoch-1",
      },
    },
  });
}

async function registerSyntheticRevisionScheme(
  system: Task97System,
): Promise<void> {
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

async function openOriginQuestion(
  system: Task97System,
  input = candidate(),
): Promise<UnknownRecord> {
  const result = (await call(
    system.resolution,
    "resolveSourceIdentityAndRevision",
    input,
  )) as UnknownRecord;
  expect(result.kind).toBe("HUMAN_JUDGEMENT_REQUIRED");
  expect((result.question as UnknownRecord).questionKey).toBe(
    "kec.source.identity.origin/v1",
  );
  return result.question as UnknownRecord;
}

async function record(
  system: Task97System,
  question: UnknownRecord,
  decision: string,
  changes: UnknownRecord = {},
): Promise<unknown> {
  return call(system.judgementActor, "recordJudgement", {
    questionKey: question.questionKey,
    applicabilityKey: question.applicabilityKey,
    policyCaseId: question.policyCaseId,
    evidenceSnapshotId: question.evidenceSnapshotId,
    candidateCoordinate: question.candidateCoordinate,
    actor: "task97:test:JudgementActor",
    decision,
    basis: [question.evidenceSnapshotId],
    ...changes,
  });
}

function identityOf(result: unknown): string {
  const handoff = established(result);
  return (handoff.sourceRevision as UnknownRecord).sourceIdentity as string;
}

describe("Task97 V1 judgement authenticity and replay RED contracts", () => {
  task97Contract("H", "same-identity-scope", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      await registerSyntheticRevisionScheme(system);
      await call(system.registrar, "seedAssertionClaim", {
        claimRegistryKey: "18:synthetic.identity|1:1|7:claim-B",
        sourceIdentity: "si:kec:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });
      const relation = (await call(
        system.resolution,
        "requestIdentityRelation",
        {
          candidate: candidate(),
          establishedClaimRegistryKey: "18:synthetic.identity|1:1|7:claim-B",
        },
      )) as UnknownRecord;
      await record(system, relation.question as UnknownRecord, "SAME_IDENTITY");
      system.spies.issueIdentity.mockClear();
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(identityOf(result)).toBe(
        "si:kec:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });

  task97Contract("I", "different-is-not-mint", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const relation = (await call(
        system.resolution,
        "requestIdentityRelation",
        {
          candidate: candidate(),
          establishedClaimRegistryKey: "18:synthetic.identity|1:1|7:claim-B",
        },
      )) as UnknownRecord;
      await record(
        system,
        relation.question as UnknownRecord,
        "DIFFERENT_IDENTITY",
      );
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(outcomeKind(result)).toBe("HUMAN_JUDGEMENT_REQUIRED");
      expect(
        ((result as UnknownRecord).question as UnknownRecord).questionKey,
      ).toBe("kec.source.identity.origin/v1");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });

  task97Contract("J", "unknown-is-not-decision", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const relation = (await call(
        system.resolution,
        "requestIdentityRelation",
        {
          candidate: candidate(),
          establishedClaimRegistryKey: "18:synthetic.identity|1:1|7:claim-B",
        },
      )) as UnknownRecord;
      await record(
        system,
        relation.question as UnknownRecord,
        "UNKNOWN_RELATIONSHIP",
      );
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(["UNRESOLVED", "HUMAN_JUDGEMENT_REQUIRED"]).toContain(
        outcomeKind(result),
      );
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
      expect(system.spies.associateIdentity).not.toHaveBeenCalled();
      expect(system.spies.admitBinding).not.toHaveBeenCalled();
    });
  });

  task97Contract("K", "conflicting-heads", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const question = await openOriginQuestion(system);
      await record(system, question, "ESTABLISH_NEW_IDENTITY", {
        recordId: "judgement:head:A",
      });
      await record(system, question, "DO_NOT_ESTABLISH", {
        recordId: "judgement:head:B",
      });
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(outcomeKind(result)).toBe("POLICY_CONTRADICTION");
      expect(reasonOf(result)).toBe("CONFLICTING_ACTIVE_JUDGEMENTS");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });

  task97Contract("K", "judgement-scope-violation", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      await call(system.registrar, "registerRevisionAssertionScheme", {
        epoch: "task97:test:epoch-1",
        scheme: {
          kind: "SOURCE_REVISION_ASSERTION_SCHEME",
          schemeId: "synthetic.revision",
          schemeVersion: "1",
          assertingAuthorityReference: "test:reviewed-policy-authority",
          revisionStateNamespace: "synthetic:test-only",
        },
      });
      const question = (await call(
        system.resolution,
        "requestRevisionRelation",
        candidate(),
      )) as UnknownRecord;
      await record(
        system,
        question.question as UnknownRecord,
        "ESTABLISH_NEW_IDENTITY",
      );
      const result = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(outcomeKind(result)).toBe("POLICY_CONTRADICTION");
      expect(reasonOf(result)).toBe("JUDGEMENT_SCOPE_VIOLATION");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
      expect(system.spies.issueRevision).not.toHaveBeenCalled();
    });
  });

  task97Contract("L", "ledger-lifecycle", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const question = await openOriginQuestion(system);
      const first = (await record(system, question, "DO_NOT_ESTABLISH", {
        recordId: "judgement:L:first",
      })) as UnknownRecord;
      const successor = (await record(
        system,
        question,
        "ESTABLISH_NEW_IDENTITY",
        {
          recordId: "judgement:L:successor",
          supersedes: first.recordId,
        },
      )) as UnknownRecord;
      expect(
        outcomeKind(
          await call(
            system.resolution,
            "resolveSourceIdentityAndRevision",
            candidate(),
          ),
        ),
      ).toBe("IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED");
      await record(system, question, "WITHDRAWN", {
        recordId: "judgement:L:withdrawn",
        supersedes: successor.recordId,
        withdraws: successor.recordId,
      });
      const withdrawn = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(outcomeKind(withdrawn)).toBe("HUMAN_JUDGEMENT_REQUIRED");
      const cycleFailure = await call(
        system.judgementActor,
        "attemptSupersessionCycle",
        {
          applicabilityKey: question.applicabilityKey,
        },
      ).catch((failure: unknown) => failure);
      expect(cycleFailure).toMatchObject({ name: "JudgementLifecycleCorrupt" });
    });
  });

  task97Contract("Z", "explicit-first-bootstrap", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const firstCandidate = candidate({
        observationId: "bootstrap:observation:A",
      });
      const question = await openOriginQuestion(system, firstCandidate);
      expect(question.allowedDecisions).toEqual([
        "ESTABLISH_NEW_IDENTITY",
        "DO_NOT_ESTABLISH",
        "UNKNOWN",
        "WITHDRAWN",
      ]);
      await record(system, question, "ESTABLISH_NEW_IDENTITY");
      const first = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        firstCandidate,
      );
      expect([
        "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
        "IDENTITY_AND_REVISION_ESTABLISHED",
      ]).toContain(outcomeKind(first));
      expect(system.spies.issueIdentity).toHaveBeenCalledTimes(1);

      const second = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate({
          observationId: "bootstrap:observation:B",
          acquisition: {
            ...(candidate().acquisition as UnknownRecord),
            observedBlobHash: { algorithm: "sha-256", digest: "c".repeat(64) },
          },
        }),
      );
      expect(outcomeKind(second)).toBe("HUMAN_JUDGEMENT_REQUIRED");
      expect(system.spies.issueIdentity).toHaveBeenCalledTimes(1);
    });
  });

  task97Contract("AA", "p1-authenticity", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const question = await openOriginQuestion(system);
      const fakeResolvedJudgement = Object.freeze({
        kind: "POLICY_QUESTION_RESOLVED",
        questionKey: "kec.source.identity.origin/v1",
        applicabilityKey: question.applicabilityKey,
        outcome: "ESTABLISH_NEW_IDENTITY",
        recordId: "caller-fabricated:not-in-ledger",
      });
      const attacked = await call(
        system.resolution,
        "establishIdentityFromResolvedJudgement",
        candidate(),
        fakeResolvedJudgement,
      ).catch((failure: unknown) => failure);
      expect(outcomeKind(attacked)).not.toMatch(/ESTABLISHED|NEW_IDENTITY/);
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();

      await record(system, question, "ESTABLISH_NEW_IDENTITY", {
        applicabilityKey: "forged:other-evidence-snapshot",
      });
      const forgedReplay = await call(
        system.resolution,
        "resolveSourceIdentityAndRevision",
        candidate(),
      );
      expect(outcomeKind(forgedReplay)).toBe("HUMAN_JUDGEMENT_REQUIRED");
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });

  task97Contract("AE", "metadata-not-authority", async () => {
    await withJudgementSystem(async (system) => {
      await registerJudgementOnlyScheme(system);
      const poison = "FORBIDDEN_METADATA_AUTHORITY_TOKEN";
      const input = candidate({
        observedMetadata: [
          { key: "publisher", value: `Ministry:${poison}` },
          { key: "official", value: poison },
          { key: "last-modified", value: poison },
        ],
      });
      const question = await openOriginQuestion(system, input);
      for (const coordinate of [
        question.applicabilityKey,
        question.candidateCoordinate,
        await call(system.resolution, "issuanceRequestKeyFor", input),
      ]) {
        expect(String(coordinate)).not.toContain(poison);
      }
      const sameUrlChangedBytes = candidate({
        observationId: "snapshot:changed-bytes",
        acquisition: {
          ...(input.acquisition as UnknownRecord),
          observedBlobHash: { algorithm: "sha-256", digest: "d".repeat(64) },
        },
      });
      const sameBytesChangedClaims = candidate({
        observationId: "snapshot:changed-claims",
        rawIdentityAssertions: [
          {
            ...(
              candidate().rawIdentityAssertions as readonly UnknownRecord[]
            )[0],
            rawValue: "claim-policy-changed",
          },
        ],
      });
      const differentObservation = candidate({
        observationId: "snapshot:different-observation",
      });
      const snapshots = await Promise.all(
        [
          input,
          sameUrlChangedBytes,
          sameBytesChangedClaims,
          differentObservation,
        ].map((value) => call(system.resolution, "evidenceSnapshotFor", value)),
      );
      expect(new Set(snapshots.map(String)).size).toBe(4);
      expect(system.spies.issueIdentity).not.toHaveBeenCalled();
    });
  });
});
