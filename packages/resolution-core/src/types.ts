declare const resolutionQuestionBrand: unique symbol;

export type ResolutionQuestion<TOutcome> = string & {
  readonly [resolutionQuestionBrand]: TOutcome;
};

export type ResolutionJudgement<TSubject, TContext, TOutcome> = {
  readonly subject: TSubject;
  readonly context: TContext;
  readonly question: ResolutionQuestion<TOutcome>;
  readonly outcome: TOutcome;
};
