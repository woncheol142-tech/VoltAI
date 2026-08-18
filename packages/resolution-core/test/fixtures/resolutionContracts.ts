import type {
  ResolutionJudgement,
  ResolutionQuestion,
} from "../../src/index.js";

type Expect<Result extends true> = Result;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
type ContractsAreResolved =
  IsAny<ResolutionQuestion<string>> extends true
    ? false
    : IsAny<ResolutionJudgement<string, string, string>> extends true
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
type QuestionOutcome<Question> =
  Question extends ResolutionQuestion<infer Outcome> ? Outcome : never;

type MutableSubject = {
  values: string[];
};

type MutableContext = {
  conditions: string[];
};

type MutableOutcome = {
  refs: string[];
};

type RequirementTarget = {
  requirementSetId: string;
};

type ProjectContext = {
  projectId: string;
};

type RequirementOutcome = {
  governingRequirementRefs: string[];
};

type SourceTarget = {
  sourceId: string;
};

type AsOfContext = {
  asOf: string;
  projectId: string;
};

type RevisionOutcome =
  { kind: "revision"; revisionRef: string } | { kind: "none" };

type DesignOptionTarget = {
  optionId: string;
};

type InstallationContext = {
  location: string;
};

type AlternativeOutcome = {
  permitted: string[];
  preferred?: string;
};

type MaterialTarget = {
  materialId: string;
};

type OperatingContext = {
  projectId: string;
  temperatureCelsius: number;
};

type MaterialOutcome = {
  specificationRefs: string[];
};

declare const stringQuestion: ResolutionQuestion<string>;
declare const numberQuestion: ResolutionQuestion<number>;
declare const mutableQuestion: ResolutionQuestion<MutableOutcome>;
declare const requirementQuestion: ResolutionQuestion<RequirementOutcome>;
declare const revisionQuestion: ResolutionQuestion<RevisionOutcome>;
declare const alternativeQuestion: ResolutionQuestion<AlternativeOutcome>;
declare const materialQuestion: ResolutionQuestion<MaterialOutcome>;

type QuestionDoesNotResolveToAny = Expect<
  ContractHoldsWhenResolved<
    IsAny<ResolutionQuestion<string>> extends true ? false : true
  >
>;
type QuestionExtendsString = Expect<
  ContractHoldsWhenResolved<
    ResolutionQuestion<string> extends string ? true : false
  >
>;
type PlainStringIsNotQuestion = Expect<
  ContractHoldsWhenResolved<
    string extends ResolutionQuestion<string> ? false : true
  >
>;
type StringQuestionIsNotNumberQuestion = Expect<
  ContractHoldsWhenResolved<
    Equal<ResolutionQuestion<string>, ResolutionQuestion<number>> extends true
      ? false
      : true
  >
>;
type QuestionOutcomeIsRecoverable = Expect<
  ContractHoldsWhenResolved<
    Equal<QuestionOutcome<ResolutionQuestion<MutableOutcome>>, MutableOutcome>
  >
>;
type JudgementKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    Equal<
      keyof ResolutionJudgement<MutableSubject, MutableContext, MutableOutcome>,
      "context" | "outcome" | "question" | "subject"
    >
  >
>;
type JudgementShapeIsExact = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<MutableSubject, MutableContext, MutableOutcome>,
      {
        readonly subject: MutableSubject;
        readonly context: MutableContext;
        readonly question: ResolutionQuestion<MutableOutcome>;
        readonly outcome: MutableOutcome;
      }
    >
  >
>;
type SubjectPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<
        MutableSubject,
        MutableContext,
        MutableOutcome
      >["subject"],
      MutableSubject
    >
  >
>;
type ContextPassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<
        MutableSubject,
        MutableContext,
        MutableOutcome
      >["context"],
      MutableContext
    >
  >
>;
type QuestionLinksToOutcome = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<
        MutableSubject,
        MutableContext,
        MutableOutcome
      >["question"],
      ResolutionQuestion<MutableOutcome>
    >
  >
>;
type OutcomePassesThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<
        MutableSubject,
        MutableContext,
        MutableOutcome
      >["outcome"],
      MutableOutcome
    >
  >
>;
type NullQuestionIsAllowed = Expect<
  ContractHoldsWhenResolved<
    Equal<QuestionOutcome<ResolutionQuestion<null>>, null>
  >
>;
type UndefinedQuestionIsAllowed = Expect<
  ContractHoldsWhenResolved<
    Equal<QuestionOutcome<ResolutionQuestion<undefined>>, undefined>
  >
>;
type UnknownQuestionIsAllowed = Expect<
  ContractHoldsWhenResolved<
    Equal<QuestionOutcome<ResolutionQuestion<unknown>>, unknown>
  >
>;
type NullGenericsPassThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<null, null, null>,
      {
        readonly subject: null;
        readonly context: null;
        readonly question: ResolutionQuestion<null>;
        readonly outcome: null;
      }
    >
  >
>;
type UndefinedGenericsPassThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<undefined, undefined, undefined>,
      {
        readonly subject: undefined;
        readonly context: undefined;
        readonly question: ResolutionQuestion<undefined>;
        readonly outcome: undefined;
      }
    >
  >
>;
type UnknownGenericsPassThrough = Expect<
  ContractHoldsWhenResolved<
    Equal<
      ResolutionJudgement<unknown, unknown, unknown>,
      {
        readonly subject: unknown;
        readonly context: unknown;
        readonly question: ResolutionQuestion<unknown>;
        readonly outcome: unknown;
      }
    >
  >
>;

declare const mutableJudgement: ResolutionJudgement<
  MutableSubject,
  MutableContext,
  MutableOutcome
>;

mutableJudgement.subject.values.push("subject remains mutable");
mutableJudgement.context.conditions.push("context remains mutable");
mutableJudgement.outcome.refs.push("outcome remains mutable");

const requirementGovernance = {
  subject: { requirementSetId: "requirements-1" },
  context: { projectId: "project-1" },
  question: requirementQuestion,
  outcome: { governingRequirementRefs: ["requirement-1", "requirement-2"] },
} satisfies ResolutionJudgement<
  RequirementTarget,
  ProjectContext,
  RequirementOutcome
>;

const sourceRevision = {
  subject: { sourceId: "source-1" },
  context: { asOf: "2026-08-18", projectId: "project-1" },
  question: revisionQuestion,
  outcome: { kind: "none" },
} satisfies ResolutionJudgement<SourceTarget, AsOfContext, RevisionOutcome>;

const alternativeResolution = {
  subject: { optionId: "option-1" },
  context: { location: "installation-zone-1" },
  question: alternativeQuestion,
  outcome: { permitted: ["alternative-1"], preferred: "alternative-1" },
} satisfies ResolutionJudgement<
  DesignOptionTarget,
  InstallationContext,
  AlternativeOutcome
>;

const materialSpecification = {
  subject: { materialId: "material-1" },
  context: { projectId: "project-1", temperatureCelsius: 80 },
  question: materialQuestion,
  outcome: { specificationRefs: ["material-spec-1"] },
} satisfies ResolutionJudgement<
  MaterialTarget,
  OperatingContext,
  MaterialOutcome
>;

const firstJudgement = {
  subject: "subject-1",
  context: "context-1",
  question: stringQuestion,
  outcome: "outcome-1",
} satisfies ResolutionJudgement<string, string, string>;

const secondJudgement = {
  subject: "subject-1",
  context: "context-1",
  question: stringQuestion,
  outcome: "outcome-2",
} satisfies ResolutionJudgement<string, string, string>;

const coexistingJudgements: ResolutionJudgement<string, string, string>[] = [
  firstJudgement,
  secondJudgement,
];

export const resolutionRepresentabilityExamples = {
  requirementGovernance,
  sourceRevision,
  alternativeResolution,
  materialSpecification,
  coexistingJudgements,
  numberQuestion,
  mutableQuestion,
};

export type ResolutionContractChecks =
  | QuestionDoesNotResolveToAny
  | QuestionExtendsString
  | PlainStringIsNotQuestion
  | StringQuestionIsNotNumberQuestion
  | QuestionOutcomeIsRecoverable
  | JudgementKeysAreExact
  | JudgementShapeIsExact
  | SubjectPassesThrough
  | ContextPassesThrough
  | QuestionLinksToOutcome
  | OutcomePassesThrough
  | NullQuestionIsAllowed
  | UndefinedQuestionIsAllowed
  | UnknownQuestionIsAllowed
  | NullGenericsPassThrough
  | UndefinedGenericsPassThrough
  | UnknownGenericsPassThrough;
