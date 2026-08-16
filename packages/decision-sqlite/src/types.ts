import type {
  DecisionRecordKeyCodec,
  DecisionValueCodec,
} from "@voltai/knowledge-core";

export type DecisionIdentityNamespace<
  TDecisionRecordId extends NonNullable<unknown>,
> = {
  readonly namespace: string;
  readonly keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>;
};

export type DecisionRecordValueCodecs<TSelection, TContext> = {
  readonly selection: DecisionValueCodec<TSelection>;
  readonly context: DecisionValueCodec<TContext>;
};

export type StoredDecisionAddress = {
  readonly namespace: string;
  readonly recordKey: string;
};

export type StoredDecisionSupersession = {
  readonly supersededNamespace: string;
  readonly supersededRecordKey: string;
  readonly supersedingNamespace: string;
  readonly supersedingRecordKey: string;
};
