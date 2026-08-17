declare const temporalRoleBrand: unique symbol;

export type TemporalRole<TTemporalValue> = string & {
  readonly [temporalRoleBrand]: TTemporalValue;
};

export type TemporalAssertion<TSubject, TTemporalValue> = {
  readonly subject: TSubject;
  readonly role: TemporalRole<TTemporalValue>;
  readonly temporalValue: TTemporalValue;
};
