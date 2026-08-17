import type {
  ContextBinding,
  ContextDescriptor,
  ContextDimension,
} from "../../src/index.js";

type Expect<Result extends true> = Result;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
type ContractHoldsWhenResolved<Value, Result extends boolean> =
  IsAny<Value> extends true ? true : Result;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type DimensionValue<Dimension> =
  Dimension extends ContextDimension<infer Value> ? Value : never;

type MutableContextValue = {
  value: number;
};

type Voltage = {
  magnitude: number;
};

declare const stringDimension: ContextDimension<string>;
declare const mutableDimension: ContextDimension<MutableContextValue>;
declare const voltageDimension: ContextDimension<Voltage>;
declare const jurisdictionDimension: ContextDimension<string>;

type VoltageBinding = ContextBinding<Voltage> & {
  readonly dimension: typeof voltageDimension;
};
type JurisdictionBinding = ContextBinding<string> & {
  readonly dimension: typeof jurisdictionDimension;
};
type DomainBinding = VoltageBinding | JurisdictionBinding;
type DomainContext = ContextDescriptor<DomainBinding>;

type DimensionDefaultIsUnknown = Expect<
  ContractHoldsWhenResolved<
    ContextDimension,
    Equal<ContextDimension, ContextDimension<unknown>>
  >
>;
type StringDimensionExtendsString = Expect<
  ContractHoldsWhenResolved<
    ContextDimension<string>,
    ContextDimension<string> extends string ? true : false
  >
>;
type PlainStringIsNotAStringDimension = Expect<
  ContractHoldsWhenResolved<
    ContextDimension<string>,
    string extends ContextDimension<string> ? false : true
  >
>;
type StringDimensionIsNotANumberDimension = Expect<
  ContractHoldsWhenResolved<
    ContextDimension<string>,
    ContextDimension<string> extends ContextDimension<number> ? false : true
  >
>;
type NumberDimensionIsNotAStringDimension = Expect<
  ContractHoldsWhenResolved<
    ContextDimension<number>,
    ContextDimension<number> extends ContextDimension<string> ? false : true
  >
>;
type DimensionPreservesItsValueAssociation = Expect<
  ContractHoldsWhenResolved<
    ContextDimension<string>,
    Equal<DimensionValue<ContextDimension<string>>, string>
  >
>;
type BindingKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    ContextBinding<string>,
    Equal<keyof ContextBinding<string>, "dimension" | "value">
  >
>;
type BindingDimensionIsLinkedToValueType = Expect<
  ContractHoldsWhenResolved<
    ContextBinding<string>,
    Equal<ContextBinding<string>["dimension"], ContextDimension<string>>
  >
>;
type BindingValueIsLinkedToValueType = Expect<
  ContractHoldsWhenResolved<
    ContextBinding<string>,
    Equal<ContextBinding<string>["value"], string>
  >
>;
type BindingRejectsMismatchedDimensionType = Expect<
  ContractHoldsWhenResolved<
    ContextBinding<number>,
    ContextBinding<number> extends {
      readonly dimension: typeof stringDimension;
      readonly value: number;
    }
      ? false
      : true
  >
>;
type MutableValuePassesThroughUnchanged = Expect<
  ContractHoldsWhenResolved<
    ContextBinding<MutableContextValue>,
    Equal<ContextBinding<MutableContextValue>["value"], MutableContextValue>
  >
>;
type DescriptorKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    ContextDescriptor,
    Equal<keyof ContextDescriptor, "bindings">
  >
>;
type DescriptorDefaultIsUnknownBinding = Expect<
  ContractHoldsWhenResolved<
    ContextDescriptor,
    Equal<ContextDescriptor, ContextDescriptor<ContextBinding<unknown>>>
  >
>;
type DescriptorBindingsAreReadonly = Expect<
  ContractHoldsWhenResolved<
    ContextDescriptor,
    Equal<ContextDescriptor["bindings"], readonly ContextBinding<unknown>[]>
  >
>;
type DescriptorPreservesCallerBindingUnion = Expect<
  ContractHoldsWhenResolved<
    DomainContext,
    Equal<DomainContext["bindings"][number], DomainBinding>
  >
>;

const stringBinding = {
  dimension: stringDimension,
  value: "declared-value",
} satisfies ContextBinding<string>;

const mutableBinding = {
  dimension: mutableDimension,
  value: { value: 1 },
} satisfies ContextBinding<MutableContextValue>;

const duplicateJurisdictionBindings = [
  { dimension: jurisdictionDimension, value: "KR" },
  { dimension: jurisdictionDimension, value: "US" },
] satisfies readonly DomainBinding[];

const domainContext = {
  bindings: [
    { dimension: voltageDimension, value: { magnitude: 220 } },
    { dimension: jurisdictionDimension, value: "KR" },
  ],
} satisfies DomainContext;

export const contextRepresentabilityExamples = {
  stringBinding,
  mutableBinding,
  duplicateJurisdictionBindings,
  domainContext,
};

export type ContextContractChecks =
  | DimensionDefaultIsUnknown
  | StringDimensionExtendsString
  | PlainStringIsNotAStringDimension
  | StringDimensionIsNotANumberDimension
  | NumberDimensionIsNotAStringDimension
  | DimensionPreservesItsValueAssociation
  | BindingKeysAreExact
  | BindingDimensionIsLinkedToValueType
  | BindingValueIsLinkedToValueType
  | BindingRejectsMismatchedDimensionType
  | MutableValuePassesThroughUnchanged
  | DescriptorKeysAreExact
  | DescriptorDefaultIsUnknownBinding
  | DescriptorBindingsAreReadonly
  | DescriptorPreservesCallerBindingUnion;
