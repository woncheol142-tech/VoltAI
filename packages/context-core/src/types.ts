declare const contextDimensionBrand: unique symbol;

export type ContextDimension<TValue = unknown> = string & {
  readonly [contextDimensionBrand]: TValue;
};

export type ContextBinding<TValue = unknown> = {
  readonly dimension: ContextDimension<TValue>;
  readonly value: TValue;
};

export type ContextDescriptor<
  TBinding extends ContextBinding<unknown> = ContextBinding<unknown>,
> = {
  readonly bindings: readonly TBinding[];
};
