import { createHash } from "node:crypto";

import { createKecSourcePolicy } from "@voltai/kec-source-policy";
import {
  openJudgementActor,
  openJudgementReplay,
  type Task97JudgementResolution,
} from "@voltai/kec-source-policy-judgement";
import {
  openPolicyResolutionStore,
  SourceResolutionStoreFailure,
  type PolicyResolutionStore,
} from "@voltai/kec-source-policy-sqlite";
import type {
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
} from "@voltai/source-core";

import { questionKeys } from "./questions.js";
import type {
  EstablishedSourceRevision,
  ObservedSourceCandidate,
  ResolutionInstrumentation,
  ResolutionQuestion,
  Task97ResolutionOutcome,
} from "./types.js";

type UnknownRecord = Readonly<Record<string, unknown>>;
type Outcome = Task97ResolutionOutcome;
type Candidate = ObservedSourceCandidate;

function lp(values: readonly string[]): string {
  return values.map((value) => `${value.length}:${value}`).join("|");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function claimKey(
  assertion: Readonly<{
    schemeId: string;
    schemeVersion: string;
    canonicalValue: string;
  }>,
): string {
  return lp([
    assertion.schemeId,
    assertion.schemeVersion,
    assertion.canonicalValue,
  ]);
}

function canonicalValue(
  rawValue: string,
  scheme: Readonly<Record<string, unknown>>,
): string {
  const declaration = scheme.canonicalization as
    Readonly<Record<string, unknown>> | undefined;
  const transformations = Array.isArray(
    declaration?.equivalencePreservingTransformations,
  )
    ? declaration.equivalencePreservingTransformations
    : [];
  let value = rawValue;
  for (const transformation of transformations) {
    if (transformation === "CASE_FOLD") value = value.toUpperCase();
    if (transformation === "STRIP_SLASH") value = value.replaceAll("/", "");
    if (transformation === "STRIP_LEADING_ZEROES")
      value = value.replace(/(^|[^0-9])0+(?=[0-9])/g, "$1");
  }
  return value;
}

function evidenceSnapshot(candidate: ObservedSourceCandidate): string {
  return `es:kec:v1:${digest({
    observationId: candidate.observationId,
    acquisition: candidate.acquisition,
    rawIdentityAssertions: candidate.rawIdentityAssertions,
    rawRevisionAssertions: candidate.rawRevisionAssertions,
  })}`;
}

function policyCase(candidate: ObservedSourceCandidate): string {
  return `pc:kec:v1:${digest({ identity: candidate.rawIdentityAssertions, revision: candidate.rawRevisionAssertions })}`;
}

function makeQuestion(
  candidate: ObservedSourceCandidate,
  questionKey: string,
  coordinate: string,
  policyEpoch: string,
  allowedDecisions: readonly string[],
): ResolutionQuestion {
  const evidenceSnapshotId = evidenceSnapshot(candidate);
  const policyCaseId = policyCase(candidate);
  return Object.freeze({
    questionKey,
    applicabilityKey: lp([
      questionKey,
      policyCaseId,
      evidenceSnapshotId,
      coordinate,
      policyEpoch,
    ]),
    policyCaseId,
    evidenceSnapshotId,
    candidateCoordinate: coordinate,
    allowedDecisions: Object.freeze([...allowedDecisions]),
  });
}

function originQuestion(
  candidate: ObservedSourceCandidate,
  coordinate: string,
  epoch: string,
): ResolutionQuestion {
  return makeQuestion(
    candidate,
    questionKeys.identityOrigin,
    coordinate,
    epoch,
    ["ESTABLISH_NEW_IDENTITY", "DO_NOT_ESTABLISH", "UNKNOWN", "WITHDRAWN"],
  );
}

function partial(
  sourceIdentity: string,
  identityBasis: unknown,
  revisionOutcome: string,
  reason: string,
): Task97ResolutionOutcome {
  return Object.freeze({
    kind: "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED",
    sourceIdentity,
    identityBasis,
    revisionOutcome,
    reason,
  });
}

function replayScopeFailure(
  replay: Task97JudgementResolution,
  allowed: readonly string[],
): Task97ResolutionOutcome | undefined {
  if (replay.kind === "CONFLICTING_ACTIVE_JUDGEMENTS")
    return {
      kind: "POLICY_CONTRADICTION",
      stage: "IDENTITY",
      reason: "CONFLICTING_ACTIVE_JUDGEMENTS",
    };
  if (replay.kind === "LIFECYCLE_CORRUPT")
    return {
      kind: "POLICY_CONTRADICTION",
      stage: "IDENTITY",
      reason: "JUDGEMENT_LIFECYCLE_CORRUPT",
    };
  if (
    replay.kind === "SINGLE_ACTIVE_JUDGEMENT" &&
    !allowed.includes(replay.decision)
  )
    return {
      kind: "POLICY_CONTRADICTION",
      stage: "IDENTITY",
      reason: "JUDGEMENT_SCOPE_VIOLATION",
    };
  return undefined;
}

export class KecSourceResolutionRuntime {
  private readonly store: PolicyResolutionStore;
  private readonly replay;
  private readonly judgementActor;
  private closed = false;

  constructor(
    private readonly options: Readonly<{
      policyDatabasePath: string;
      judgementDatabasePath: string;
      policyEpoch: string;
      testInstrumentation?: ResolutionInstrumentation;
    }>,
  ) {
    this.store = openPolicyResolutionStore({
      databasePath: options.policyDatabasePath,
      testInstrumentation: options.testInstrumentation,
    });
    this.replay = openJudgementReplay({
      databasePath: options.judgementDatabasePath,
    });
    this.judgementActor = openJudgementActor({
      databasePath: options.judgementDatabasePath,
    });
  }

  async resolveSourceIdentityAndRevision(input: Candidate): Promise<Outcome> {
    const candidate = input;
    this.assertOpen();
    this.store.persistAcquisition(candidate as unknown as UnknownRecord);
    const identityAssertion = candidate.rawIdentityAssertions.find(
      (entry) => entry.bindingStatus === "BOUND",
    );
    if (identityAssertion === undefined)
      return {
        kind: "POLICY_LOOKUP_REQUIRED",
        stage: "IDENTITY",
        reason: "BOUND_IDENTITY_ASSERTION_REQUIRED",
      };
    const configuration = this.store.configuration(this.options.policyEpoch);
    const registered = configuration.registeredSchemes.find(
      (scheme) =>
        scheme.schemeId === identityAssertion.schemeId &&
        scheme.version === identityAssertion.schemeVersion,
    );
    const active = configuration.activeAutomaticOriginSchemeVersions.find(
      (designation) =>
        designation.schemeId === identityAssertion.schemeId &&
        designation.version === identityAssertion.schemeVersion,
    );
    if (registered === undefined)
      return {
        kind: "POLICY_LOOKUP_REQUIRED",
        stage: "POLICY_CONFIGURATION",
        reason:
          configuration.activeAutomaticOriginSchemeVersions.length === 0
            ? "NO_ACTIVE_ORIGIN_SCHEME"
            : "SCHEME_VERSION_NOT_REGISTERED",
      };
    const producedCanonical = canonicalValue(
      identityAssertion.rawValue,
      registered as unknown as UnknownRecord,
    );
    const canonicalization = (await this.policy().canonicalizeAssertionClaims({
      scheme: registered,
      observations: [
        {
          rawValue: identityAssertion.rawValue,
          producedCanonical,
        },
      ],
    })) as UnknownRecord;
    if (canonicalization.kind !== "ASSERTION_CLAIMS_CANONICALIZED") {
      return {
        kind: "POLICY_CONTRADICTION",
        stage: "IDENTITY",
        reason: String(
          canonicalization.reason ?? "ASSERTION_CANONICALIZATION_COLLISION",
        ),
      };
    }
    const coordinate = claimKey({
      schemeId: identityAssertion.schemeId,
      schemeVersion: identityAssertion.schemeVersion,
      canonicalValue: producedCanonical,
    });
    const crosswalkEdges = this.store.crosswalkEdges(this.options.policyEpoch);
    const relationValidation = (await this.policy().validateAssertionRelations({
      claims: [
        ...new Set([
          coordinate,
          ...crosswalkEdges.flatMap((edge) => [edge.left, edge.right]),
        ]),
      ],
      edges: crosswalkEdges,
    })) as UnknownRecord;
    if (relationValidation.kind !== "ASSERTION_RELATIONS_VALID") {
      return {
        kind: "POLICY_CONTRADICTION",
        stage: "IDENTITY",
        reason: "CONFLICTING_ASSERTION_RELATIONS",
      };
    }

    const pendingRevision = this.store.loadPendingQuestion(
      questionKeys.revisionRelation,
      coordinate,
    );
    if (pendingRevision !== undefined) {
      const replay = this.replay.replay(
        String((pendingRevision.question as UnknownRecord).applicabilityKey),
      );
      const failure = replayScopeFailure(replay, [
        "SAME_REVISION",
        "DIFFERENT_REVISION",
        "UNKNOWN_RELATIONSHIP",
        "WITHDRAWN",
      ]);
      if (failure !== undefined) return failure;
    }

    let identity: string | undefined;
    let identityBasis: unknown;

    if (active !== undefined && registered.originIssuanceCapability === "YES") {
      const policy = this.policy();
      const transition = this.store.originTransition({
        epoch: this.options.policyEpoch,
        successorSchemeId: registered.schemeId,
        successorVersion: registered.version,
      });
      const result = (await policy.establishIdentityAtomically({
        assertion: {
          observationId: candidate.observationId,
          schemeId: identityAssertion.schemeId,
          schemeVersion: identityAssertion.schemeVersion,
          rawValue: identityAssertion.rawValue,
          canonicalValue: producedCanonical,
          bindingStatus: "BOUND",
        },
        registeredSchemes: configuration.registeredSchemes,
        activeAutomaticOriginSchemeVersions:
          configuration.activeAutomaticOriginSchemeVersions,
        policyEpoch: this.options.policyEpoch,
        ...(transition ?? {}),
        requestKey: this.issuanceRequestKeyFor(candidate),
        immutableRequestContent: {
          claimRegistryKey: coordinate,
          evidenceSnapshotId: evidenceSnapshot(candidate),
        },
      })) as UnknownRecord;
      if (typeof result.sourceIdentity !== "string")
        return {
          kind: "IDENTITY_ISSUANCE_CONFLICT",
          reason: String(result.reason ?? "IDENTITY_NOT_ESTABLISHED"),
        };
      identity = result.sourceIdentity;
      identityBasis = Object.freeze({
        kind: String(result.kind),
        claimRegistryKey: coordinate,
        schemeId: registered.schemeId,
        schemeVersion: registered.version,
      });
    } else {
      const relation = this.store.loadPendingQuestion(
        questionKeys.identityRelation,
        coordinate,
      );
      if (relation !== undefined) {
        const replay = this.replay.replay(
          String((relation.question as UnknownRecord).applicabilityKey),
        );
        const failure = replayScopeFailure(replay, [
          "SAME_IDENTITY",
          "DIFFERENT_IDENTITY",
          "UNKNOWN_RELATIONSHIP",
          "WITHDRAWN",
        ]);
        if (failure !== undefined) return failure;
        if (
          replay.kind === "SINGLE_ACTIVE_JUDGEMENT" &&
          replay.decision === "SAME_IDENTITY" &&
          typeof relation.targetClaim === "string"
        ) {
          const target = this.store.identityFor(relation.targetClaim);
          if (target !== undefined) {
            identity = this.store.associateIdentity(coordinate, target);
            identityBasis = {
              kind: "AUTHORITATIVE_SAME_IDENTITY_JUDGEMENT",
              judgementRecordId: replay.recordId,
            };
          }
        }
        if (
          replay.kind === "SINGLE_ACTIVE_JUDGEMENT" &&
          replay.decision === "UNKNOWN_RELATIONSHIP"
        )
          return {
            kind: "UNRESOLVED",
            stage: "IDENTITY",
            reason: "UNKNOWN_IDENTITY_RELATIONSHIP",
          };
      }
      if (identity === undefined) {
        const question = originQuestion(
          candidate,
          coordinate,
          this.options.policyEpoch,
        );
        const replay = this.replay.replay(question.applicabilityKey);
        const failure = replayScopeFailure(replay, question.allowedDecisions);
        if (failure !== undefined) return failure;
        if (
          replay.kind !== "SINGLE_ACTIVE_JUDGEMENT" ||
          replay.decision === "WITHDRAWN" ||
          replay.decision !== "ESTABLISH_NEW_IDENTITY"
        )
          return {
            kind: "HUMAN_JUDGEMENT_REQUIRED",
            stage: "IDENTITY",
            reason: "EXPLICIT_ORIGIN_JUDGEMENT_REQUIRED",
            question,
          };
        const result =
          (await this.policy().establishIdentityFromResolvedJudgement({
            assertion: {
              observationId: candidate.observationId,
              schemeId: identityAssertion.schemeId,
              schemeVersion: identityAssertion.schemeVersion,
              rawValue: identityAssertion.rawValue,
              canonicalValue: producedCanonical,
              bindingStatus: "BOUND",
            },
            questionKey: question.questionKey,
            policyCaseId: question.policyCaseId,
            evidenceSnapshotId: question.evidenceSnapshotId,
            applicabilityKey: question.applicabilityKey,
            judgementRecordId: replay.recordId,
            policyEpoch: this.options.policyEpoch,
            requestKey: this.issuanceRequestKeyFor(candidate),
            immutableRequestContent: {
              claimRegistryKey: coordinate,
              evidenceSnapshotId: question.evidenceSnapshotId,
            },
          })) as UnknownRecord;
        if (typeof result.sourceIdentity !== "string")
          return {
            kind: "HUMAN_JUDGEMENT_REQUIRED",
            stage: "IDENTITY",
            reason: "AUTHORITATIVE_JUDGEMENT_REQUIRED",
            question,
          };
        identity = result.sourceIdentity;
        identityBasis = {
          kind: String(result.kind),
          judgementRecordId: replay.recordId,
          claimRegistryKey: coordinate,
        };
      }
    }
    this.store.sealEpoch(this.options.policyEpoch);
    return this.resolveRevision(candidate, identity, identityBasis);
  }

  requestIdentityRelation(
    input: Readonly<{
      candidate: ObservedSourceCandidate;
      establishedClaimRegistryKey: string;
    }>,
  ): Readonly<{
    kind: "HUMAN_JUDGEMENT_REQUIRED";
    question: ResolutionQuestion;
  }> {
    const assertion = input.candidate.rawIdentityAssertions[0];
    const configuration = this.store.configuration(this.options.policyEpoch);
    const registered = configuration.registeredSchemes.find(
      (scheme) =>
        scheme.schemeId === assertion.schemeId &&
        scheme.version === assertion.schemeVersion,
    );
    const coordinate = claimKey({
      schemeId: assertion.schemeId,
      schemeVersion: assertion.schemeVersion,
      canonicalValue:
        registered === undefined
          ? assertion.rawValue
          : canonicalValue(assertion.rawValue, registered as UnknownRecord),
    });
    const question = makeQuestion(
      input.candidate,
      questionKeys.identityRelation,
      lp([coordinate, input.establishedClaimRegistryKey]),
      this.options.policyEpoch,
      [
        "SAME_IDENTITY",
        "DIFFERENT_IDENTITY",
        "UNKNOWN_RELATIONSHIP",
        "WITHDRAWN",
      ],
    );
    this.store.savePendingQuestion(questionKeys.identityRelation, coordinate, {
      question,
      targetClaim: input.establishedClaimRegistryKey,
    });
    return { kind: "HUMAN_JUDGEMENT_REQUIRED", question };
  }

  requestRevisionRelation(candidate: ObservedSourceCandidate): Readonly<{
    kind: "HUMAN_JUDGEMENT_REQUIRED";
    question: ResolutionQuestion;
  }> {
    const assertion = candidate.rawIdentityAssertions[0];
    const configuration = this.store.configuration(this.options.policyEpoch);
    const registered = configuration.registeredSchemes.find(
      (scheme) =>
        scheme.schemeId === assertion.schemeId &&
        scheme.version === assertion.schemeVersion,
    );
    const coordinate = claimKey({
      schemeId: assertion.schemeId,
      schemeVersion: assertion.schemeVersion,
      canonicalValue:
        registered === undefined
          ? assertion.rawValue
          : canonicalValue(assertion.rawValue, registered as UnknownRecord),
    });
    const question = makeQuestion(
      candidate,
      questionKeys.revisionRelation,
      coordinate,
      this.options.policyEpoch,
      [
        "SAME_REVISION",
        "DIFFERENT_REVISION",
        "UNKNOWN_RELATIONSHIP",
        "WITHDRAWN",
      ],
    );
    this.store.savePendingQuestion(questionKeys.revisionRelation, coordinate, {
      question,
    });
    return { kind: "HUMAN_JUDGEMENT_REQUIRED", question };
  }

  establishIdentityFromResolvedJudgement(
    candidate: ObservedSourceCandidate,
  ): Task97ResolutionOutcome {
    const assertion = candidate.rawIdentityAssertions[0];
    return {
      kind: "HUMAN_JUDGEMENT_REQUIRED",
      stage: "IDENTITY",
      reason: "AUTHORITATIVE_JUDGEMENT_REFERENCE_REQUIRED",
      question: originQuestion(
        candidate,
        claimKey({
          schemeId: assertion.schemeId,
          schemeVersion: assertion.schemeVersion,
          canonicalValue: assertion.rawValue,
        }),
        this.options.policyEpoch,
      ),
    };
  }

  evidenceSnapshotFor(candidate: ObservedSourceCandidate): string {
    return evidenceSnapshot(candidate);
  }
  issuanceRequestKeyFor(candidate: ObservedSourceCandidate): string {
    const assertion = candidate.rawIdentityAssertions[0];
    return `ir:kec:v1:${digest({ epoch: this.options.policyEpoch, evidenceSnapshotId: evidenceSnapshot(candidate), assertion: { schemeId: assertion.schemeId, schemeVersion: assertion.schemeVersion, rawValue: assertion.rawValue } })}`;
  }

  evaluateCrossVersionCorrespondence(input: UnknownRecord): UnknownRecord {
    const predecessor = input.predecessor as UnknownRecord;
    const successor = input.successor as UnknownRecord;
    const correspondence = this.store.crossVersionCorrespondence({
      epoch: this.options.policyEpoch,
      predecessorSchemeId: String(predecessor.schemeId),
      predecessorVersion: String(predecessor.version),
      successorSchemeId: String(successor.schemeId),
      successorVersion: String(successor.version),
    }) as UnknownRecord | undefined;
    if (correspondence?.kind === "DISJOINT_IDENTIFIER_SPACE")
      return { kind: "CORRESPONDENCE_DISJOINT" };
    if (
      correspondence?.kind === "EXPLICIT_CLAIM_MAPPING" &&
      Array.isArray(correspondence.mappings)
    ) {
      if (
        correspondence.mappings.some((entry) => {
          const value = entry as UnknownRecord;
          return (
            value.from === predecessor.canonicalValue &&
            value.to === successor.canonicalValue
          );
        })
      )
        return { kind: "CORRESPONDENCE_ESTABLISHED" };
    }
    return {
      kind: "POLICY_LOOKUP_REQUIRED",
      reason: "CROSS_VERSION_CORRESPONDENCE_UNRESOLVED",
    };
  }

  async resolveRevisionFromJudgement(
    input: UnknownRecord,
  ): Promise<Task97ResolutionOutcome> {
    const candidate = input.candidate as ObservedSourceCandidate;
    const identityPhase = await this.resolveSourceIdentityAndRevision({
      ...candidate,
      rawRevisionAssertions: [],
    });
    if (
      identityPhase.kind !== "IDENTITY_ESTABLISHED_REVISION_NOT_ESTABLISHED"
    ) {
      return identityPhase;
    }
    if (input.decision === "UNKNOWN_RELATIONSHIP")
      return partial(
        identityPhase.sourceIdentity,
        identityPhase.identityBasis,
        "UNRESOLVED",
        "UNKNOWN_REVISION_RELATIONSHIP",
      );
    return partial(
      identityPhase.sourceIdentity,
      identityPhase.identityBasis,
      "HUMAN_JUDGEMENT_REQUIRED",
      "REVISION_JUDGEMENT_REQUIRED",
    );
  }

  loadEstablishedSourceRevision(query: SourceRevision): unknown {
    return this.store.loadEstablished(query) ?? { kind: "NOT_ESTABLISHED" };
  }

  recordAcquisitionAttestation(
    input: Readonly<{
      sourceRevision: SourceRevision;
      blobHash: Readonly<{ algorithm: string; digest: string }>;
      locator: unknown;
      decision: string;
      actor: string;
      supersedes?: string;
    }>,
  ): UnknownRecord {
    const candidateCoordinate = lp([
      input.sourceRevision.sourceIdentity,
      input.sourceRevision.revisionKey,
      input.blobHash.algorithm,
      input.blobHash.digest,
    ]);
    const evidenceSnapshotId = `es:kec:v1:${digest({
      sourceRevision: input.sourceRevision,
      blobHash: input.blobHash,
      locator: input.locator,
    })}`;
    const policyCaseId = `pc:kec:v1:${digest({
      sourceRevision: input.sourceRevision,
      blobHash: input.blobHash,
    })}`;
    const applicabilityKey = lp([
      questionKeys.acquisitionContent,
      policyCaseId,
      evidenceSnapshotId,
      candidateCoordinate,
      this.options.policyEpoch,
    ]);
    const recorded = this.judgementActor.recordJudgement({
      questionKey: questionKeys.acquisitionContent,
      applicabilityKey,
      policyCaseId,
      evidenceSnapshotId,
      candidateCoordinate,
      decision: input.decision,
      actor: input.actor,
      basis: [evidenceSnapshotId],
      ...(input.supersedes === undefined
        ? {}
        : { supersedes: input.supersedes }),
    });
    return Object.freeze({ ...recorded, evidenceSnapshotId });
  }

  replayAcquisitionAttestation(
    input: Readonly<{
      sourceRevision: SourceRevision;
      blobHash: Readonly<{ algorithm: string; digest: string }>;
      locator: unknown;
    }>,
  ): UnknownRecord {
    const candidateCoordinate = lp([
      input.sourceRevision.sourceIdentity,
      input.sourceRevision.revisionKey,
      input.blobHash.algorithm,
      input.blobHash.digest,
    ]);
    const evidenceSnapshotId = `es:kec:v1:${digest(input)}`;
    const policyCaseId = `pc:kec:v1:${digest({
      sourceRevision: input.sourceRevision,
      blobHash: input.blobHash,
    })}`;
    const applicabilityKey = lp([
      questionKeys.acquisitionContent,
      policyCaseId,
      evidenceSnapshotId,
      candidateCoordinate,
      this.options.policyEpoch,
    ]);
    return this.replay.replay(applicabilityKey) as unknown as UnknownRecord;
  }

  probeConfigurationReadiness(): Readonly<{
    bootstrapConfigured: boolean;
    realProbeReady: boolean;
  }> {
    const bootstrapConfigured = this.store.bootstrapConfigured(
      this.options.policyEpoch,
    );
    return Object.freeze({
      bootstrapConfigured,
      realProbeReady: bootstrapConfigured,
    });
  }
  close(): void {
    if (this.closed) return;
    this.store.close();
    this.replay.close();
    this.judgementActor.close();
    this.closed = true;
  }

  private async resolveRevision(
    candidate: ObservedSourceCandidate,
    identity: string,
    identityBasis: unknown,
  ): Promise<Task97ResolutionOutcome> {
    const revisionAssertion = candidate.rawRevisionAssertions.find(
      (entry) => entry.bindingStatus === "BOUND",
    );
    if (revisionAssertion === undefined)
      return partial(
        identity,
        identityBasis,
        "UNRESOLVED",
        "INSUFFICIENT_REVISION_EVIDENCE",
      );
    const configuration = this.store.configuration(this.options.policyEpoch);
    const registered = configuration.registeredRevisionSchemes.find(
      (entry) =>
        entry.schemeId === revisionAssertion.schemeId &&
        entry.schemeVersion === revisionAssertion.schemeVersion,
    );
    if (registered === undefined) {
      return partial(
        identity,
        identityBasis,
        "POLICY_LOOKUP_REQUIRED",
        "REVISION_SCHEME_NOT_REGISTERED",
      );
    }
    const revisionClaimKey = lp([
      identity,
      revisionAssertion.schemeId,
      revisionAssertion.schemeVersion,
      revisionAssertion.rawRevisionState,
    ]);
    const existing = this.store.revisionFor(revisionClaimKey);
    if (existing !== undefined)
      return {
        kind: "IDENTITY_AND_REVISION_ESTABLISHED",
        established: existing as EstablishedSourceRevision,
      };
    const policyResult = (await this.policy().establishRevision({
      sourceIdentity: identity,
      revisionAssertionScheme: registered,
      revisionAssertion: {
        schemeId: revisionAssertion.schemeId,
        schemeVersion: revisionAssertion.schemeVersion,
        revisionState: revisionAssertion.rawRevisionState,
        bindingStatus: "BOUND",
      },
    })) as UnknownRecord;
    if (
      policyResult.kind !== "SOURCE_REVISION_ESTABLISHED" ||
      typeof policyResult.sourceRevisionKey !== "string"
    ) {
      return partial(
        identity,
        identityBasis,
        "UNRESOLVED",
        String(policyResult.reason ?? "REVISION_POLICY_NOT_ESTABLISHED"),
      );
    }
    const proposed: SourceRevision = Object.freeze({
      sourceIdentity: identity as SourceIdentity,
      revisionKey: policyResult.sourceRevisionKey as SourceRevisionKey,
    });
    const revisionBasis = Object.freeze({
      kind: "REGISTERED_REVISION_ASSERTION",
      schemeId: revisionAssertion.schemeId,
      schemeVersion: revisionAssertion.schemeVersion,
      rawRevisionState: revisionAssertion.rawRevisionState,
    });
    const resolutionRecordRef = `rr:kec:v1:${digest({ revisionClaimKey, evidenceSnapshotId: evidenceSnapshot(candidate) })}`;
    const established = this.store.associateRevision({
      revisionClaimKey,
      proposed,
      identityBasis,
      revisionBasis,
      resolutionRecordRef,
    });
    return {
      kind: "IDENTITY_AND_REVISION_ESTABLISHED",
      established: established as EstablishedSourceRevision,
    };
  }

  private policy() {
    return createKecSourcePolicy({
      opaqueIdentityIssuer: {
        issue: async () => {
          this.options.testInstrumentation?.issueIdentity?.();
          return this.store.issueIdentity();
        },
      },
      assertionClaimRegistry: {
        identityFor: (key) => this.store.identityFor(key),
        associateAtomically: (key, value) =>
          this.store.associateIdentity(key, value as SourceIdentity),
      },
      issuanceRequestRegistry: {
        outcomeFor: (key) => this.store.issuanceOutcome(key),
        register: (key, content, outcome) =>
          this.store.registerIssuance(key, content, outcome),
      },
      opaqueRevisionKeyIssuer: {
        issue: async () => {
          this.options.testInstrumentation?.issueRevision?.();
          return this.store.issueRevisionKey();
        },
      },
      sourceRevisionRegistry: {
        register: () => undefined,
      },
      resolvedJudgementAuthority: {
        resolveReference: (input) =>
          this.replay.resolveReference(input) as never,
      },
    });
  }

  private assertOpen(): void {
    if (this.closed)
      throw new SourceResolutionStoreFailure(
        "unavailable",
        "source resolution is closed",
      );
  }
}
