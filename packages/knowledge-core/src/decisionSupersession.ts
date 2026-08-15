export type DecisionSupersession<
  TSupersededDecisionRecordId extends NonNullable<unknown>,
  TSupersedingDecisionRecordId extends NonNullable<unknown>,
> = {
  supersededDecisionRecordId: TSupersededDecisionRecordId;
  supersedingDecisionRecordId: TSupersedingDecisionRecordId;
};
