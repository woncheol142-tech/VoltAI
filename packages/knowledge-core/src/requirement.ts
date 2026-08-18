export type Requirement<
  TRequirementId extends NonNullable<unknown>,
  TStatement extends NonNullable<unknown>,
> = {
  readonly id: TRequirementId;
  readonly statement: TStatement;
};
