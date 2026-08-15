export type DecisionRecordKeyCodec<
  TDecisionRecordId extends NonNullable<unknown>,
> = {
  encode: (value: TDecisionRecordId) => string;
  decode: (value: unknown) => TDecisionRecordId;
};
