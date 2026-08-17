declare const validationCriterionBrand: unique symbol;

export type ValidationCriterion<TOutcome> = string & {
  readonly [validationCriterionBrand]: TOutcome;
};

export type ValidationObservation<TSubject, TOutcome> = {
  readonly subject: TSubject;
  readonly criterion: ValidationCriterion<TOutcome>;
  readonly outcome: TOutcome;
};

export type ValidationProfile<TCriterion extends ValidationCriterion<unknown>> =
  {
    readonly criteria: readonly TCriterion[];
  };
