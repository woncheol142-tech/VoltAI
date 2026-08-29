import type { ResolutionJudgement } from "../../../resolution-core/src/index.js";
import type {
  ImmutableJudgementRecord as ProductionJudgementRecord,
  JudgementAddress,
  JudgementLedger as ProductionJudgementLedger,
  JudgementRecordId,
  JudgementReplayResult,
  JudgementSupersession,
  ReplayApplicabilityKey,
} from "../../src/judgementLedgerTypes.js";
import {
  SqliteJudgementLedger,
  type JudgementLedgerFailurePoint,
} from "../../src/judgementLedger.js";

export type {
  JudgementAddress,
  JudgementRecordId,
  JudgementSupersession,
  ReplayApplicabilityKey,
};

type TestResolutionJudgement = ResolutionJudgement<
  { readonly policySubjectKey: string },
  { readonly policyContextKey: string },
  { readonly outcome: string }
>;

export type ImmutableJudgementRecord = ProductionJudgementRecord<
  TestResolutionJudgement,
  string
>;

export type ReplayResult = JudgementReplayResult<ImmutableJudgementRecord>;
export type LifecycleFailurePoint = JudgementLedgerFailurePoint;
export type JudgementLedger =
  ProductionJudgementLedger<ImmutableJudgementRecord>;

/**
 * Test-only control surface. GREEN may realize this with an adapter around a
 * production port; these controls are not part of ledger domain semantics.
 */
export interface JudgementLedgerTestDriver {
  seedRecord(record: ImmutableJudgementRecord): void;
  seedSupersession(relation: JudgementSupersession): void;
  failNextAt(point: LifecycleFailurePoint): void;
  recover(): void;
}

export type JudgementLedgerHarness = {
  readonly ledger: JudgementLedger;
  readonly driver: JudgementLedgerTestDriver;
};

class TestSqliteJudgementLedger extends SqliteJudgementLedger<ImmutableJudgementRecord> {
  private nextFailurePoint: LifecycleFailurePoint | undefined;

  failNextAt(point: LifecycleFailurePoint): void {
    this.nextFailurePoint = point;
  }

  recover(): void {
    this.nextFailurePoint = undefined;
  }

  seedSupersession(relation: JudgementSupersession): void {
    this.persistSupersession(relation);
  }

  protected override reachedFailurePoint(
    point: JudgementLedgerFailurePoint,
  ): void {
    if (this.nextFailurePoint === point) {
      this.nextFailurePoint = undefined;
      throw new Error(`injected judgement-ledger failure at ${point}`);
    }
  }
}

export function createJudgementLedgerHarness(): JudgementLedgerHarness {
  const ledger = new TestSqliteJudgementLedger(":memory:");
  return {
    ledger,
    driver: {
      seedRecord: (record) => ledger.persistRecord(record),
      seedSupersession: (relation) => ledger.seedSupersession(relation),
      failNextAt: (point) => ledger.failNextAt(point),
      recover: () => ledger.recover(),
    },
  };
}

export function judgementRecordId(value: string): JudgementRecordId {
  return value as JudgementRecordId;
}

export function replayApplicabilityKey(value: string): ReplayApplicabilityKey {
  return value as ReplayApplicabilityKey;
}

export function createJudgementRecord(
  id: JudgementRecordId,
  applicabilityKey: ReplayApplicabilityKey,
  outcome: string,
): ImmutableJudgementRecord {
  return Object.freeze({
    recordId: id,
    address: Object.freeze({
      namespace: "resolution-judgement-record/v1",
      recordKey: id,
    }),
    applicabilityKey,
    judgement: Object.freeze({
      subject: Object.freeze({ policySubjectKey: "subject:S" }),
      context: Object.freeze({ policyContextKey: "context:C" }),
      question:
        "question:Q" as ImmutableJudgementRecord["judgement"]["question"],
      outcome: Object.freeze({ outcome }),
    }),
    basis: Object.freeze(["basis:B"]),
  });
}

export function supersession(
  superseded: ImmutableJudgementRecord,
  superseding: ImmutableJudgementRecord,
): JudgementSupersession {
  return Object.freeze({
    superseded: superseded.address,
    superseding: superseding.address,
  });
}
