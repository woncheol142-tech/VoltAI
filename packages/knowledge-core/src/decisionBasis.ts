export type DecisionBasis<
  TDecisionRecordId extends NonNullable<unknown>,
  TBasis extends NonNullable<unknown>,
> = {
  decisionRecordId: TDecisionRecordId;
  basis: TBasis;
};
