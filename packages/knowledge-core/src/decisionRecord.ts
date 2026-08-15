import type { Decision } from "./decision.js";

export type DecisionRecord<
  TDecisionRecordId extends NonNullable<unknown>,
  TSelectionRef,
  TContextRef,
> = {
  readonly id: TDecisionRecordId;
  decision: Decision<TSelectionRef, TContextRef>;
};
