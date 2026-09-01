import { randomBytes } from "node:crypto";

import {
  SqliteJudgementLedger,
  type ImmutableJudgementRecord,
  type JudgementRecordId,
  type ReplayApplicabilityKey,
} from "@voltai/decision-sqlite/judgement-ledger";

type JudgementPayload = Readonly<{
  decision: string;
  questionKey?: string;
  policyCaseId?: string;
  evidenceSnapshotId?: string;
  candidateCoordinate?: string;
  actor?: string;
  withdraws?: string;
}>;

type Task97JudgementRecord = ImmutableJudgementRecord<
  JudgementPayload,
  unknown
>;

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mintRecordId(): string {
  return `jr:kec:v1:${randomBytes(16).toString("hex")}`;
}

export class JudgementLifecycleCorrupt extends Error {
  constructor(message = "judgement lifecycle is corrupt") {
    super(message);
    this.name = "JudgementLifecycleCorrupt";
  }
}

export class JudgementStoreFailure extends Error {
  readonly category = "unavailable";

  constructor(message = "judgement store is unavailable") {
    super(message);
    this.name = "JudgementStoreFailure";
  }
}

export class JudgementActor {
  private readonly ledger: SqliteJudgementLedger<Task97JudgementRecord>;

  constructor(databasePath: string) {
    this.ledger = new SqliteJudgementLedger<Task97JudgementRecord>(
      databasePath,
    );
  }

  recordJudgement(input: Readonly<Record<string, unknown>>): Readonly<{
    recordId: string;
    applicabilityKey: string;
  }> {
    const id = optionalText(input.recordId) ?? mintRecordId();
    const applicabilityKey =
      optionalText(input.applicabilityKey) ?? `unscoped:${mintRecordId()}`;
    const payload: JudgementPayload = Object.freeze({
      decision: optionalText(input.decision) ?? "UNKNOWN",
      ...(optionalText(input.questionKey) === undefined
        ? {}
        : { questionKey: optionalText(input.questionKey) }),
      ...(optionalText(input.policyCaseId) === undefined
        ? {}
        : { policyCaseId: optionalText(input.policyCaseId) }),
      ...(optionalText(input.evidenceSnapshotId) === undefined
        ? {}
        : { evidenceSnapshotId: optionalText(input.evidenceSnapshotId) }),
      ...(optionalText(input.candidateCoordinate) === undefined
        ? {}
        : { candidateCoordinate: optionalText(input.candidateCoordinate) }),
      ...(optionalText(input.actor) === undefined
        ? {}
        : { actor: optionalText(input.actor) }),
      ...(optionalText(input.withdraws) === undefined
        ? {}
        : { withdraws: optionalText(input.withdraws) }),
    });
    const record: Task97JudgementRecord = Object.freeze({
      recordId: id as JudgementRecordId,
      address: Object.freeze({
        namespace: "kec:source-judgement-record:v1",
        recordKey: id,
      }),
      applicabilityKey: applicabilityKey as ReplayApplicabilityKey,
      judgement: payload,
      basis: Object.freeze(Array.isArray(input.basis) ? [...input.basis] : []),
    });
    const supersedes = optionalText(input.supersedes);
    if (supersedes === undefined) {
      this.ledger.persistRecord(record);
    } else {
      this.ledger.persistSupersedingJudgement({
        record,
        supersedes: {
          namespace: "kec:source-judgement-record:v1",
          recordKey: supersedes,
        },
      });
    }
    return Object.freeze({ recordId: id, applicabilityKey });
  }

  attemptSupersessionCycle(_input: Readonly<Record<string, unknown>>): never {
    const applicabilityKey = optionalText(_input.applicabilityKey);
    if (applicabilityKey === undefined) {
      throw new TypeError("applicabilityKey is required");
    }
    const namespace = "kec:source-judgement-record:v1";
    const firstId = mintRecordId();
    const secondId = mintRecordId();
    const first: Task97JudgementRecord = Object.freeze({
      recordId: firstId as JudgementRecordId,
      address: Object.freeze({ namespace, recordKey: firstId }),
      applicabilityKey: applicabilityKey as ReplayApplicabilityKey,
      judgement: Object.freeze({ decision: "UNKNOWN" }),
      basis: Object.freeze([]),
    });
    const second: Task97JudgementRecord = Object.freeze({
      recordId: secondId as JudgementRecordId,
      address: Object.freeze({ namespace, recordKey: secondId }),
      applicabilityKey: applicabilityKey as ReplayApplicabilityKey,
      judgement: Object.freeze({ decision: "UNKNOWN" }),
      basis: Object.freeze([]),
    });
    this.ledger.persistRecord(first);
    this.ledger.persistSupersedingJudgement({
      record: second,
      supersedes: first.address,
    });
    this.ledger.persistSupersedingJudgement({
      record: first,
      supersedes: second.address,
    });
    if (
      this.ledger.replay(first.applicabilityKey).kind === "LIFECYCLE_CORRUPT"
    ) {
      throw new JudgementLifecycleCorrupt();
    }
    throw new Error("ledger accepted a supersession cycle");
  }

  close(): void {
    // The existing ledger intentionally has no public close capability.
  }
}

export type Task97JudgementResolution =
  | Readonly<{ kind: "NO_ACTIVE_JUDGEMENT" }>
  | Readonly<{
      kind: "SINGLE_ACTIVE_JUDGEMENT";
      recordId: string;
      decision: string;
      questionKey?: string;
      evidenceSnapshotId?: string;
      applicabilityKey: string;
    }>
  | Readonly<{ kind: "CONFLICTING_ACTIVE_JUDGEMENTS" }>
  | Readonly<{ kind: "PERSISTENCE_UNAVAILABLE" }>
  | Readonly<{ kind: "LIFECYCLE_CORRUPT" }>;

export class JudgementReplayAdapter {
  private readonly ledger: SqliteJudgementLedger<Task97JudgementRecord>;

  constructor(databasePath: string) {
    this.ledger = new SqliteJudgementLedger<Task97JudgementRecord>(
      databasePath,
    );
  }

  replay(applicabilityKey: string): Task97JudgementResolution {
    const result = this.ledger.replay(
      applicabilityKey as ReplayApplicabilityKey,
    );
    if (result.kind === "LIFECYCLE_CORRUPT") {
      throw new JudgementLifecycleCorrupt();
    }
    if (result.kind === "PERSISTENCE_UNAVAILABLE") {
      throw new JudgementStoreFailure();
    }
    if (result.kind !== "SINGLE_ACTIVE_JUDGEMENT") return result;
    return Object.freeze({
      kind: result.kind,
      recordId: result.record.recordId,
      decision: result.record.judgement.decision,
      questionKey: result.record.judgement.questionKey,
      evidenceSnapshotId: result.record.judgement.evidenceSnapshotId,
      applicabilityKey: result.record.applicabilityKey,
    });
  }

  resolveReference(
    input: Readonly<Record<string, string>>,
  ): Readonly<Record<string, unknown>> {
    const replay = this.replay(input.applicabilityKey);
    if (
      replay.kind !== "SINGLE_ACTIVE_JUDGEMENT" ||
      replay.recordId !== input.recordId ||
      replay.questionKey !== input.questionKey
    ) {
      return { kind: "NOT_AUTHORITATIVE" };
    }
    return Object.freeze({
      kind: "AUTHORITATIVE_JUDGEMENT",
      decision: replay.decision,
      recordId: replay.recordId,
      applicabilityKey: replay.applicabilityKey,
    });
  }

  close(): void {
    // The existing ledger intentionally has no public close capability.
  }
}

export function openJudgementActor(
  input: Readonly<{
    databasePath: string;
  }>,
): JudgementActor {
  return new JudgementActor(input.databasePath);
}

export function openJudgementReplay(
  input: Readonly<{
    databasePath: string;
  }>,
): JudgementReplayAdapter {
  return new JudgementReplayAdapter(input.databasePath);
}
