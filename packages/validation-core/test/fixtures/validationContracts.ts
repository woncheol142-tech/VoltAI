import type {
  ValidationCriterion,
  ValidationObservation,
  ValidationProfile,
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
type CriterionOutcome<Criterion> =
  Criterion extends ValidationCriterion<infer Outcome> ? Outcome : never;

type SubjectRef = {
  subjectId: string;
};

type MutableOutcome = {
  score: number;
};

type StructuredValidationResult = {
  issues: string[];
  approved: boolean;
};

type StringOutcome = "accepted" | "rejected";
type MixedCriterion = ValidationCriterion<string> | ValidationCriterion<number>;

declare const stringCriterion: ValidationCriterion<string>;
declare const numberCriterion: ValidationCriterion<number>;
declare const booleanCriterion: ValidationCriterion<boolean>;
declare const stringUnionCriterion: ValidationCriterion<StringOutcome>;
declare const mutableCriterion: ValidationCriterion<MutableOutcome>;
declare const structuredCriterion: ValidationCriterion<StructuredValidationResult>;
declare const confidenceCriterion: ValidationCriterion<number>;
declare const nullCriterion: ValidationCriterion<null>;
declare const undefinedCriterion: ValidationCriterion<undefined>;
declare const nullableStringCriterion: ValidationCriterion<string | null>;

type CriterionDoesNotResolveToAny = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    IsAny<ValidationCriterion<string>> extends true ? false : true
  >
>;
type CriterionExtendsString = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    ValidationCriterion<string> extends string ? true : false
  >
>;
type PlainStringIsNotCriterion = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    string extends ValidationCriterion<string> ? false : true
  >
>;
type StringCriterionWidensToUnknown = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    ValidationCriterion<string> extends ValidationCriterion<unknown>
      ? true
      : false
  >
>;
type UnknownCriterionDoesNotNarrowToString = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    ValidationCriterion<unknown> extends ValidationCriterion<string>
      ? false
      : true
  >
>;
type StringCriterionIsNotNumberCriterion = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    ValidationCriterion<string> extends ValidationCriterion<number>
      ? false
      : true
  >
>;
type NumberCriterionIsNotStringCriterion = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<number>,
    ValidationCriterion<number> extends ValidationCriterion<string>
      ? false
      : true
  >
>;
type CriterionOutcomeIsRecoverable = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string>,
    Equal<CriterionOutcome<ValidationCriterion<string>>, string>
  >
>;
type ObservationKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, string>,
    Equal<
      keyof ValidationObservation<SubjectRef, string>,
      "criterion" | "outcome" | "subject"
    >
  >
>;
type ObservationShapeIsExact = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, string>,
    Equal<
      ValidationObservation<SubjectRef, string>,
      {
        readonly subject: SubjectRef;
        readonly criterion: ValidationCriterion<string>;
        readonly outcome: string;
      }
    >
  >
>;
type ObservationSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, string>,
    Equal<ValidationObservation<SubjectRef, string>["subject"], SubjectRef>
  >
>;
type ObservationCriterionLinksToOutcome = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, string>,
    Equal<
      ValidationObservation<SubjectRef, string>["criterion"],
      ValidationCriterion<string>
    >
  >
>;
type ObservationOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, string>,
    Equal<ValidationObservation<SubjectRef, string>["outcome"], string>
  >
>;
type StringCriterionCannotFillNumberObservation = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, number>,
    ValidationCriterion<string> extends ValidationObservation<
      SubjectRef,
      number
    >["criterion"]
      ? false
      : true
  >
>;
type MutableOutcomePassesThroughUnchanged = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, MutableOutcome>,
    Equal<
      ValidationObservation<SubjectRef, MutableOutcome>["outcome"],
      MutableOutcome
    >
  >
>;
type BooleanOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, boolean>,
    Equal<ValidationObservation<SubjectRef, boolean>["outcome"], boolean>
  >
>;
type StringUnionOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, StringOutcome>,
    Equal<
      ValidationObservation<SubjectRef, StringOutcome>["outcome"],
      StringOutcome
    >
  >
>;
type StructuredOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, StructuredValidationResult>,
    Equal<
      ValidationObservation<SubjectRef, StructuredValidationResult>["outcome"],
      StructuredValidationResult
    >
  >
>;
type NumericOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, number>,
    Equal<ValidationObservation<SubjectRef, number>["outcome"], number>
  >
>;
type NullOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, null>,
    Equal<ValidationObservation<SubjectRef, null>["outcome"], null>
  >
>;
type UndefinedOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, undefined>,
    Equal<ValidationObservation<SubjectRef, undefined>["outcome"], undefined>
  >
>;
type NullableStringOutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<SubjectRef, string | null>,
    Equal<
      ValidationObservation<SubjectRef, string | null>["outcome"],
      string | null
    >
  >
>;
type NullSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<null, string>,
    Equal<ValidationObservation<null, string>["subject"], null>
  >
>;
type UndefinedSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    ValidationObservation<undefined, string>,
    Equal<ValidationObservation<undefined, string>["subject"], undefined>
  >
>;
type ProfileKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    ValidationProfile<ValidationCriterion<string>>,
    Equal<keyof ValidationProfile<ValidationCriterion<string>>, "criteria">
  >
>;
type ProfileShapeIsExact = Expect<
  ContractHoldsWhenResolved<
    ValidationProfile<ValidationCriterion<string>>,
    Equal<
      ValidationProfile<ValidationCriterion<string>>,
      {
        readonly criteria: readonly ValidationCriterion<string>[];
      }
    >
  >
>;
type ProfileCriteriaAreReadonly = Expect<
  ContractHoldsWhenResolved<
    ValidationProfile<ValidationCriterion<string>>,
    Equal<
      ValidationProfile<ValidationCriterion<string>>["criteria"],
      readonly ValidationCriterion<string>[]
    >
  >
>;
type ProfilePreservesHeterogeneousCriterionUnion = Expect<
  ContractHoldsWhenResolved<
    ValidationProfile<MixedCriterion>,
    Equal<ValidationProfile<MixedCriterion>["criteria"][number], MixedCriterion>
  >
>;

const stringObservation = {
  subject: { subjectId: "SUBJECT-001" },
  criterion: stringCriterion,
  outcome: "domain-owned",
} satisfies ValidationObservation<SubjectRef, string>;

const booleanObservation = {
  subject: { subjectId: "SUBJECT-002" },
  criterion: booleanCriterion,
  outcome: true,
} satisfies ValidationObservation<SubjectRef, boolean>;

const stringUnionObservation = {
  subject: { subjectId: "SUBJECT-003" },
  criterion: stringUnionCriterion,
  outcome: "accepted",
} satisfies ValidationObservation<SubjectRef, StringOutcome>;

const mutableOutcomeObservation = {
  subject: { subjectId: "SUBJECT-004" },
  criterion: mutableCriterion,
  outcome: { score: 1 },
} satisfies ValidationObservation<SubjectRef, MutableOutcome>;

mutableOutcomeObservation.outcome.score = 2;

const structuredObservation = {
  subject: { subjectId: "SUBJECT-005" },
  criterion: structuredCriterion,
  outcome: { issues: [], approved: true },
} satisfies ValidationObservation<SubjectRef, StructuredValidationResult>;

const confidenceObservation = {
  subject: { subjectId: "SUBJECT-006" },
  criterion: confidenceCriterion,
  outcome: 0.8,
} satisfies ValidationObservation<SubjectRef, number>;

const nullOutcomeObservation = {
  subject: { subjectId: "SUBJECT-007" },
  criterion: nullCriterion,
  outcome: null,
} satisfies ValidationObservation<SubjectRef, null>;

const undefinedOutcomeObservation = {
  subject: { subjectId: "SUBJECT-008" },
  criterion: undefinedCriterion,
  outcome: undefined,
} satisfies ValidationObservation<SubjectRef, undefined>;

const nullableOutcomeObservation = {
  subject: { subjectId: "SUBJECT-009" },
  criterion: nullableStringCriterion,
  outcome: null,
} satisfies ValidationObservation<SubjectRef, string | null>;

const nullSubjectObservation = {
  subject: null,
  criterion: stringCriterion,
  outcome: "present",
} satisfies ValidationObservation<null, string>;

const undefinedSubjectObservation = {
  subject: undefined,
  criterion: stringCriterion,
  outcome: "present",
} satisfies ValidationObservation<undefined, string>;

const emptyProfile = {
  criteria: [],
} satisfies ValidationProfile<ValidationCriterion<string>>;

const duplicateCriterionProfile = {
  criteria: [stringCriterion, stringCriterion],
} satisfies ValidationProfile<ValidationCriterion<string>>;

const stringThenNumberProfile = {
  criteria: [stringCriterion, numberCriterion],
} satisfies ValidationProfile<MixedCriterion>;

const numberThenStringProfile = {
  criteria: [numberCriterion, stringCriterion],
} satisfies ValidationProfile<MixedCriterion>;

export const validationRepresentabilityExamples = {
  stringObservation,
  booleanObservation,
  stringUnionObservation,
  mutableOutcomeObservation,
  structuredObservation,
  confidenceObservation,
  nullOutcomeObservation,
  undefinedOutcomeObservation,
  nullableOutcomeObservation,
  nullSubjectObservation,
  undefinedSubjectObservation,
  emptyProfile,
  duplicateCriterionProfile,
  stringThenNumberProfile,
  numberThenStringProfile,
};

export type ValidationContractChecks =
  | CriterionDoesNotResolveToAny
  | CriterionExtendsString
  | PlainStringIsNotCriterion
  | StringCriterionWidensToUnknown
  | UnknownCriterionDoesNotNarrowToString
  | StringCriterionIsNotNumberCriterion
  | NumberCriterionIsNotStringCriterion
  | CriterionOutcomeIsRecoverable
  | ObservationKeysAreExact
  | ObservationShapeIsExact
  | ObservationSubjectPassesThrough
  | ObservationCriterionLinksToOutcome
  | ObservationOutcomePassesThrough
  | StringCriterionCannotFillNumberObservation
  | MutableOutcomePassesThroughUnchanged
  | BooleanOutcomePassesThrough
  | StringUnionOutcomePassesThrough
  | StructuredOutcomePassesThrough
  | NumericOutcomePassesThrough
  | NullOutcomePassesThrough
  | UndefinedOutcomePassesThrough
  | NullableStringOutcomePassesThrough
  | NullSubjectPassesThrough
  | UndefinedSubjectPassesThrough
  | ProfileKeysAreExact
  | ProfileShapeIsExact
  | ProfileCriteriaAreReadonly
  | ProfilePreservesHeterogeneousCriterionUnion;
