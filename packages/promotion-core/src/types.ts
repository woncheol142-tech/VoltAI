import type { ValidationCriterion } from "@voltai/validation-core";

declare const promotionGateBrand: unique symbol;

export type PromotionGate<TAssessment> = string & {
  readonly [promotionGateBrand]: TAssessment;
};

export type PromotionGateCriterionDependency<TAssessment, TOutcome> = {
  readonly gate: PromotionGate<TAssessment>;
  readonly criterion: ValidationCriterion<TOutcome>;
};

export type PromotionGateAssessment<TSubject, TAssessment> = {
  readonly subject: TSubject;
  readonly gate: PromotionGate<TAssessment>;
  readonly assessment: TAssessment;
};
