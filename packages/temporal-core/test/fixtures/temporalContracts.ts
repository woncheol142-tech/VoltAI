import type { TemporalAssertion, TemporalRole } from "../../src/index.js";

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
type TemporalRoleValue<Role> =
  Role extends TemporalRole<infer TemporalValue> ? TemporalValue : never;

type RequirementRef = {
  requirementId: string;
};

type MutableTemporalValue = {
  revision: number;
};

type DomainRange = {
  start: string;
  end: string;
};

declare const stringRole: TemporalRole<string>;
declare const nullableStringRole: TemporalRole<string | null>;
declare const mutableValueRole: TemporalRole<MutableTemporalValue>;
declare const validityRangeRole: TemporalRole<DomainRange>;
declare const nullRole: TemporalRole<null>;
declare const undefinedRole: TemporalRole<undefined>;

type TemporalRoleDoesNotResolveToAny = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<string>,
    IsAny<TemporalRole<string>> extends true ? false : true
  >
>;
type StringRoleExtendsString = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<string>,
    TemporalRole<string> extends string ? true : false
  >
>;
type PlainStringIsNotAStringRole = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<string>,
    string extends TemporalRole<string> ? false : true
  >
>;
type StringRoleIsNotANumberRole = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<string>,
    TemporalRole<string> extends TemporalRole<number> ? false : true
  >
>;
type NumberRoleIsNotAStringRole = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<number>,
    TemporalRole<number> extends TemporalRole<string> ? false : true
  >
>;
type StringRoleMayWidenToUnknownRole = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<string>,
    TemporalRole<string> extends TemporalRole<unknown> ? true : false
  >
>;
type RolePreservesItsTemporalValueAssociation = Expect<
  ContractHoldsWhenResolved<
    TemporalRole<string>,
    Equal<TemporalRoleValue<TemporalRole<string>>, string>
  >
>;
type AssertionKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string>,
    Equal<
      keyof TemporalAssertion<RequirementRef, string>,
      "role" | "subject" | "temporalValue"
    >
  >
>;
type AssertionSubjectIsCallerOwned = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string>,
    Equal<TemporalAssertion<RequirementRef, string>["subject"], RequirementRef>
  >
>;
type AssertionRoleIsLinkedToTemporalValue = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string>,
    Equal<
      TemporalAssertion<RequirementRef, string>["role"],
      TemporalRole<string>
    >
  >
>;
type AssertionTemporalValueIsCallerOwned = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string>,
    Equal<TemporalAssertion<RequirementRef, string>["temporalValue"], string>
  >
>;
type StringRoleCannotFillNumberAssertionRole = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, number>,
    TemporalRole<string> extends TemporalAssertion<
      RequirementRef,
      number
    >["role"]
      ? false
      : true
  >
>;
type NumberRoleCannotFillStringAssertionRole = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string>,
    TemporalRole<number> extends TemporalAssertion<
      RequirementRef,
      string
    >["role"]
      ? false
      : true
  >
>;
type PrimitiveSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<string, string>,
    Equal<TemporalAssertion<string, string>["subject"], string>
  >
>;
type ObjectSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string>,
    Equal<TemporalAssertion<RequirementRef, string>["subject"], RequirementRef>
  >
>;
type NullSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<null, string>,
    Equal<TemporalAssertion<null, string>["subject"], null>
  >
>;
type UndefinedSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<undefined, string>,
    Equal<TemporalAssertion<undefined, string>["subject"], undefined>
  >
>;
type NullableStringValuePassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, string | null>,
    Equal<
      TemporalAssertion<RequirementRef, string | null>["temporalValue"],
      string | null
    >
  >
>;
type MutableValuePassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, MutableTemporalValue>,
    Equal<
      TemporalAssertion<RequirementRef, MutableTemporalValue>["temporalValue"],
      MutableTemporalValue
    >
  >
>;
type StructuredRangeValuePassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, DomainRange>,
    Equal<
      TemporalAssertion<RequirementRef, DomainRange>["temporalValue"],
      DomainRange
    >
  >
>;
type NullTemporalValuePassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, null>,
    Equal<TemporalAssertion<RequirementRef, null>["temporalValue"], null>
  >
>;
type UndefinedTemporalValuePassesThrough = Expect<
  ContractHoldsWhenResolved<
    TemporalAssertion<RequirementRef, undefined>,
    Equal<
      TemporalAssertion<RequirementRef, undefined>["temporalValue"],
      undefined
    >
  >
>;

const stringAssertion = {
  subject: { requirementId: "REQ-001" },
  role: stringRole,
  temporalValue: "2026-08-17",
} satisfies TemporalAssertion<RequirementRef, string>;

const nullableStringAssertion = {
  subject: { requirementId: "REQ-002" },
  role: nullableStringRole,
  temporalValue: null,
} satisfies TemporalAssertion<RequirementRef, string | null>;

const mutableValueAssertion = {
  subject: { requirementId: "REQ-003" },
  role: mutableValueRole,
  temporalValue: { revision: 1 },
} satisfies TemporalAssertion<RequirementRef, MutableTemporalValue>;

mutableValueAssertion.temporalValue.revision = 2;

const rangeAssertion = {
  subject: { requirementId: "REQ-004" },
  role: validityRangeRole,
  temporalValue: {
    start: "2026-01-01",
    end: "2025-01-01",
  },
} satisfies TemporalAssertion<RequirementRef, DomainRange>;

const nullSubjectAssertion = {
  subject: null,
  role: stringRole,
  temporalValue: "caller-defined",
} satisfies TemporalAssertion<null, string>;

const undefinedSubjectAssertion = {
  subject: undefined,
  role: stringRole,
  temporalValue: "caller-defined",
} satisfies TemporalAssertion<undefined, string>;

const primitiveSubjectAssertion = {
  subject: 42,
  role: stringRole,
  temporalValue: "caller-defined",
} satisfies TemporalAssertion<number, string>;

const nullValueAssertion = {
  subject: { requirementId: "REQ-005" },
  role: nullRole,
  temporalValue: null,
} satisfies TemporalAssertion<RequirementRef, null>;

const undefinedValueAssertion = {
  subject: { requirementId: "REQ-006" },
  role: undefinedRole,
  temporalValue: undefined,
} satisfies TemporalAssertion<RequirementRef, undefined>;

export const temporalRepresentabilityExamples = {
  stringAssertion,
  nullableStringAssertion,
  mutableValueAssertion,
  rangeAssertion,
  nullSubjectAssertion,
  undefinedSubjectAssertion,
  primitiveSubjectAssertion,
  nullValueAssertion,
  undefinedValueAssertion,
};

export type TemporalContractChecks =
  | TemporalRoleDoesNotResolveToAny
  | StringRoleExtendsString
  | PlainStringIsNotAStringRole
  | StringRoleIsNotANumberRole
  | NumberRoleIsNotAStringRole
  | StringRoleMayWidenToUnknownRole
  | RolePreservesItsTemporalValueAssociation
  | AssertionKeysAreExact
  | AssertionSubjectIsCallerOwned
  | AssertionRoleIsLinkedToTemporalValue
  | AssertionTemporalValueIsCallerOwned
  | StringRoleCannotFillNumberAssertionRole
  | NumberRoleCannotFillStringAssertionRole
  | PrimitiveSubjectPassesThrough
  | ObjectSubjectPassesThrough
  | NullSubjectPassesThrough
  | UndefinedSubjectPassesThrough
  | NullableStringValuePassesThrough
  | MutableValuePassesThrough
  | StructuredRangeValuePassesThrough
  | NullTemporalValuePassesThrough
  | UndefinedTemporalValuePassesThrough;
