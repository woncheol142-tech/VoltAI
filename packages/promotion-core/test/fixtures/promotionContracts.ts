import type { ValidationCriterion } from "@voltai/validation-core";

import type {
  PromotionGate,
  PromotionGateAssessment,
  PromotionGateCriterionDependency,
} from "../../src/index.js";

type Expect<Result extends true> = Result;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
type ContractsAreResolved =
  IsAny<PromotionGate<string>> extends true
    ? false
    : IsAny<ValidationCriterion<string>> extends true
      ? false
      : true;
type ContractHoldsWhenResolved<Result extends boolean> =
  ContractsAreResolved extends true ? Result : true;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type GateAssessment<Gate> =
  Gate extends PromotionGate<infer Assessment> ? Assessment : never;

type SubjectRef = {
  subjectId: string;
};

type MutableAssessment = {
  score: number;
};

type StructuredAssessment = {
  issues: string[];
  approved: boolean;
};

type AssessmentLabel = "eligible" | "ineligible" | "review";

declare const stringGate: PromotionGate<string>;
declare const numberGate: PromotionGate<number>;
declare const booleanGate: PromotionGate<boolean>;
declare const labelGate: PromotionGate<AssessmentLabel>;
declare const mutableGate: PromotionGate<MutableAssessment>;
declare const structuredGate: PromotionGate<StructuredAssessment>;
declare const nullGate: PromotionGate<null>;
declare const undefinedGate: PromotionGate<undefined>;
declare const stringCriterion: ValidationCriterion<string>;
declare const numberCriterion: ValidationCriterion<number>;

type GateDoesNotResolveToAny = Expect<
  ContractHoldsWhenResolved<
    IsAny<PromotionGate<string>> extends true ? false : true
  >
>;
type GateExtendsString = Expect<
  ContractHoldsWhenResolved<PromotionGate<string> extends string ? true : false>
>;
type PlainStringIsNotGate = Expect<
  ContractHoldsWhenResolved<string extends PromotionGate<string> ? false : true>
>;
type StringGateWidensToUnknown = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<string> extends PromotionGate<unknown> ? true : false
  >
>;
type UnknownGateDoesNotNarrowToString = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<unknown> extends PromotionGate<string> ? false : true
  >
>;
type StringGateIsNotNumberGate = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<string> extends PromotionGate<number> ? false : true
  >
>;
type NumberGateIsNotStringGate = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<number> extends PromotionGate<string> ? false : true
  >
>;
type GateAssessmentIsRecoverable = Expect<
  ContractHoldsWhenResolved<
    Equal<GateAssessment<PromotionGate<string>>, string>
  >
>;
type CriterionIsNotGate = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string> extends PromotionGate<string> ? false : true
  >
>;
type GateIsNotCriterion = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<string> extends ValidationCriterion<string> ? false : true
  >
>;
type DependencyKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    Equal<
      keyof PromotionGateCriterionDependency<string, number>,
      "criterion" | "gate"
    >
  >
>;
type DependencyShapeIsExact = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateCriterionDependency<string, number>,
      {
        readonly gate: PromotionGate<string>;
        readonly criterion: ValidationCriterion<number>;
      }
    >
  >
>;
type DependencyGateIsLinkedToAssessment = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateCriterionDependency<string, number>["gate"],
      PromotionGate<string>
    >
  >
>;
type DependencyCriterionIsLinkedToOutcome = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateCriterionDependency<string, number>["criterion"],
      ValidationCriterion<number>
    >
  >
>;
type StringGateCannotFillNumberAssessmentDependency = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<string> extends PromotionGateCriterionDependency<
      number,
      string
    >["gate"]
      ? false
      : true
  >
>;
type StringCriterionCannotFillNumberOutcomeDependency = Expect<
  ContractHoldsWhenResolved<
    ValidationCriterion<string> extends PromotionGateCriterionDependency<
      string,
      number
    >["criterion"]
      ? false
      : true
  >
>;
type DependencyHasNoAssessment = Expect<
  ContractHoldsWhenResolved<
    "assessment" extends keyof PromotionGateCriterionDependency<string, number>
      ? false
      : true
  >
>;
type DependencyHasNoOutcome = Expect<
  ContractHoldsWhenResolved<
    "outcome" extends keyof PromotionGateCriterionDependency<string, number>
      ? false
      : true
  >
>;
type DependencyHasNoPredicate = Expect<
  ContractHoldsWhenResolved<
    "predicate" extends keyof PromotionGateCriterionDependency<string, number>
      ? false
      : true
  >
>;
type GateAssessmentKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    Equal<
      keyof PromotionGateAssessment<SubjectRef, string>,
      "assessment" | "gate" | "subject"
    >
  >
>;
type GateAssessmentShapeIsExact = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateAssessment<SubjectRef, string>,
      {
        readonly subject: SubjectRef;
        readonly gate: PromotionGate<string>;
        readonly assessment: string;
      }
    >
  >
>;
type GateAssessmentSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<PromotionGateAssessment<SubjectRef, string>["subject"], SubjectRef>
  >
>;
type GateAssessmentGateIsLinked = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateAssessment<SubjectRef, string>["gate"],
      PromotionGate<string>
    >
  >
>;
type GateAssessmentValuePassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<PromotionGateAssessment<SubjectRef, string>["assessment"], string>
  >
>;
type StringGateCannotFillNumberAssessment = Expect<
  ContractHoldsWhenResolved<
    PromotionGate<string> extends PromotionGateAssessment<
      SubjectRef,
      number
    >["gate"]
      ? false
      : true
  >
>;
type BooleanAssessmentPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<PromotionGateAssessment<SubjectRef, boolean>["assessment"], boolean>
  >
>;
type StringUnionAssessmentPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateAssessment<SubjectRef, AssessmentLabel>["assessment"],
      AssessmentLabel
    >
  >
>;
type StructuredAssessmentPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateAssessment<SubjectRef, StructuredAssessment>["assessment"],
      StructuredAssessment
    >
  >
>;
type MutableAssessmentPassesThroughUnchanged = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateAssessment<SubjectRef, MutableAssessment>["assessment"],
      MutableAssessment
    >
  >
>;
type NullAssessmentPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<PromotionGateAssessment<SubjectRef, null>["assessment"], null>
  >
>;
type UndefinedAssessmentPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      PromotionGateAssessment<SubjectRef, undefined>["assessment"],
      undefined
    >
  >
>;
type NullSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<PromotionGateAssessment<null, string>["subject"], null>
  >
>;
type UndefinedSubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<PromotionGateAssessment<undefined, string>["subject"], undefined>
  >
>;

const stringDependency = {
  gate: stringGate,
  criterion: stringCriterion,
} satisfies PromotionGateCriterionDependency<string, string>;

const anotherDependencyForTheSameGate = {
  gate: stringGate,
  criterion: numberCriterion,
} satisfies PromotionGateCriterionDependency<string, number>;

const booleanAssessment = {
  subject: { subjectId: "SUBJECT-001" },
  gate: booleanGate,
  assessment: true,
} satisfies PromotionGateAssessment<SubjectRef, boolean>;

const stringUnionAssessment = {
  subject: { subjectId: "SUBJECT-002" },
  gate: labelGate,
  assessment: "review",
} satisfies PromotionGateAssessment<SubjectRef, AssessmentLabel>;

const mutableAssessment = {
  subject: { subjectId: "SUBJECT-003" },
  gate: mutableGate,
  assessment: { score: 1 },
} satisfies PromotionGateAssessment<SubjectRef, MutableAssessment>;

mutableAssessment.assessment.score = 2;

const structuredAssessment = {
  subject: { subjectId: "SUBJECT-004" },
  gate: structuredGate,
  assessment: { issues: [], approved: false },
} satisfies PromotionGateAssessment<SubjectRef, StructuredAssessment>;

const numberAssessment = {
  subject: { subjectId: "SUBJECT-005" },
  gate: numberGate,
  assessment: 0.8,
} satisfies PromotionGateAssessment<SubjectRef, number>;

const nullAssessment = {
  subject: { subjectId: "SUBJECT-006" },
  gate: nullGate,
  assessment: null,
} satisfies PromotionGateAssessment<SubjectRef, null>;

const undefinedAssessment = {
  subject: { subjectId: "SUBJECT-007" },
  gate: undefinedGate,
  assessment: undefined,
} satisfies PromotionGateAssessment<SubjectRef, undefined>;

const nullSubjectAssessment = {
  subject: null,
  gate: stringGate,
  assessment: "domain-owned",
} satisfies PromotionGateAssessment<null, string>;

const undefinedSubjectAssessment = {
  subject: undefined,
  gate: stringGate,
  assessment: "domain-owned",
} satisfies PromotionGateAssessment<undefined, string>;

export const promotionRepresentabilityExamples = {
  stringDependency,
  anotherDependencyForTheSameGate,
  booleanAssessment,
  stringUnionAssessment,
  mutableAssessment,
  structuredAssessment,
  numberAssessment,
  nullAssessment,
  undefinedAssessment,
  nullSubjectAssessment,
  undefinedSubjectAssessment,
};

export type PromotionContractChecks =
  | GateDoesNotResolveToAny
  | GateExtendsString
  | PlainStringIsNotGate
  | StringGateWidensToUnknown
  | UnknownGateDoesNotNarrowToString
  | StringGateIsNotNumberGate
  | NumberGateIsNotStringGate
  | GateAssessmentIsRecoverable
  | CriterionIsNotGate
  | GateIsNotCriterion
  | DependencyKeysAreExact
  | DependencyShapeIsExact
  | DependencyGateIsLinkedToAssessment
  | DependencyCriterionIsLinkedToOutcome
  | StringGateCannotFillNumberAssessmentDependency
  | StringCriterionCannotFillNumberOutcomeDependency
  | DependencyHasNoAssessment
  | DependencyHasNoOutcome
  | DependencyHasNoPredicate
  | GateAssessmentKeysAreExact
  | GateAssessmentShapeIsExact
  | GateAssessmentSubjectPassesThrough
  | GateAssessmentGateIsLinked
  | GateAssessmentValuePassesThrough
  | StringGateCannotFillNumberAssessment
  | BooleanAssessmentPassesThrough
  | StringUnionAssessmentPassesThrough
  | StructuredAssessmentPassesThrough
  | MutableAssessmentPassesThroughUnchanged
  | NullAssessmentPassesThrough
  | UndefinedAssessmentPassesThrough
  | NullSubjectPassesThrough
  | UndefinedSubjectPassesThrough;
