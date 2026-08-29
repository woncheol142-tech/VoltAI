declare const judgementRecordIdBrand: unique symbol;
declare const replayApplicabilityKeyBrand: unique symbol;

export type JudgementRecordId = string & {
  readonly [judgementRecordIdBrand]: true;
};

export type ReplayApplicabilityKey = string & {
  readonly [replayApplicabilityKeyBrand]: true;
};

export type JudgementAddress = {
  readonly namespace: string;
  readonly recordKey: string;
};

export type ImmutableJudgementRecord<TJudgement = unknown, TBasis = unknown> = {
  readonly recordId: JudgementRecordId;
  readonly address: JudgementAddress;
  readonly applicabilityKey: ReplayApplicabilityKey;
  readonly judgement: TJudgement;
  readonly basis: readonly TBasis[];
};

export type JudgementSupersession = {
  readonly superseded: JudgementAddress;
  readonly superseding: JudgementAddress;
};

export type JudgementReplayResult<TRecord extends ImmutableJudgementRecord> =
  | { readonly kind: "SINGLE_ACTIVE_JUDGEMENT"; readonly record: TRecord }
  | { readonly kind: "NO_ACTIVE_JUDGEMENT" }
  | {
      readonly kind: "CONFLICTING_ACTIVE_JUDGEMENTS";
      readonly records: readonly TRecord[];
    }
  | { readonly kind: "PERSISTENCE_UNAVAILABLE" }
  | { readonly kind: "LIFECYCLE_CORRUPT" };

export interface JudgementLedger<TRecord extends ImmutableJudgementRecord> {
  persistRecord(record: TRecord): void;
  persistSupersedingJudgement(input: {
    readonly record: TRecord;
    readonly supersedes: JudgementAddress;
  }): void;
  recordsFor(applicabilityKey: ReplayApplicabilityKey): readonly TRecord[];
  supersessionsFor(
    applicabilityKey: ReplayApplicabilityKey,
  ): readonly JudgementSupersession[];
  replay(
    applicabilityKey: ReplayApplicabilityKey,
  ): JudgementReplayResult<TRecord>;
}
