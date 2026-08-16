import type {
  DecisionRecordKeyCodec,
  DecisionValueCodec,
  JsonValue,
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

export type StoredDecisionRecord = {
  readonly address: StoredDecisionAddress;
  readonly selection: JsonValue;
  readonly context: JsonValue;
};

export type StoredDecisionSupersession = {
  readonly supersededNamespace: string;
  readonly supersededRecordKey: string;
  readonly supersedingNamespace: string;
  readonly supersedingRecordKey: string;
};
