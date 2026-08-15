import type { AlternativeOption } from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type SubjectRefFixture = {
  subjectId: string;
};

type AlternativeRefFixture = {
  alternativeId: string;
};

type ContextRefFixture = {
  contextId: string;
};

type AlternativeFixture = AlternativeOption<
  SubjectRefFixture,
  AlternativeRefFixture,
  ContextRefFixture
>;

const alternativeShapeContract: Assert<
  Equal<
    AlternativeFixture,
    {
      subject: SubjectRefFixture;
      alternative: AlternativeRefFixture;
      context: ContextRefFixture;
    }
  >
> = true;
const alternativeAcceptsDistinctOpaqueValues: Assert<
  Equal<
    AlternativeOption<string, number, boolean>,
    {
      subject: string;
      alternative: number;
      context: boolean;
    }
  >
> = true;
const alternativeAcceptsNullableValues: Assert<
  Equal<
    AlternativeOption<null, undefined, symbol>,
    {
      subject: null;
      alternative: undefined;
      context: symbol;
    }
  >
> = true;
const alternativeAcceptsSameReferenceType: Assert<
  Equal<
    AlternativeOption<SubjectRefFixture, SubjectRefFixture, ContextRefFixture>,
    {
      subject: SubjectRefFixture;
      alternative: SubjectRefFixture;
      context: ContextRefFixture;
    }
  >
> = true;

type ForbiddenAlternativeField =
  | "status"
  | "applicable"
  | "applicability"
  | "available"
  | "unavailable"
  | "possible"
  | "impossible"
  | "permitted"
  | "compliant"
  | "recommended"
  | "preferred"
  | "winner"
  | "loser"
  | "best"
  | "rank"
  | "priority"
  | "weight"
  | "score"
  | "precedence"
  | "overrides"
  | "supersedes"
  | "authority"
  | "authorityClass"
  | "sourcePath"
  | "evidence"
  | "confidence"
  | "chosen"
  | "approved"
  | "approvedBy"
  | "members"
  | "options"
  | "candidate";

const alternativeOwnsNoForbiddenFields: Assert<
  Equal<Extract<keyof AlternativeFixture, ForbiddenAlternativeField>, never>
> = true;

const subject: SubjectRefFixture = { subjectId: "subject-1" };
const alternative: AlternativeRefFixture = {
  alternativeId: "alternative-1",
};
const context: ContextRefFixture = { contextId: "context-1" };

const directionalAlternative: AlternativeFixture = {
  subject,
  alternative,
  context,
};
const sameValueSelfRelation: AlternativeOption<
  SubjectRefFixture,
  SubjectRefFixture,
  ContextRefFixture
> = {
  subject,
  alternative: subject,
  context,
};

// @ts-expect-error All alternative generic arguments must be explicit.
type MissingAll = AlternativeOption;
type MissingTwo =
  // @ts-expect-error Alternative and context generic arguments must be explicit.
  AlternativeOption<SubjectRefFixture>;
type MissingContext =
  // @ts-expect-error The context generic argument must be explicit.
  AlternativeOption<SubjectRefFixture, AlternativeRefFixture>;

void (null as MissingAll | null);
void (null as MissingTwo | null);
void (null as MissingContext | null);

// @ts-expect-error A directional alternative requires its subject.
const missingSubject: AlternativeFixture = {
  alternative,
  context,
};
// @ts-expect-error A directional alternative requires its candidate alternative.
const missingAlternative: AlternativeFixture = {
  subject,
  context,
};
// @ts-expect-error A directional alternative requires its context.
const missingContextField: AlternativeFixture = {
  subject,
  alternative,
};

const membersTupleSubstitute: AlternativeFixture = {
  // @ts-expect-error A symmetric members tuple cannot replace directional fields.
  members: [subject, alternative],
  context,
};
const optionsArraySubstitute: AlternativeFixture = {
  // @ts-expect-error An options array cannot replace directional fields.
  options: [subject, alternative],
  context,
};
const candidateOnlySubstitute: AlternativeFixture = {
  // @ts-expect-error A candidate-only shape cannot replace the relation.
  candidate: alternative,
  context,
};
// @ts-expect-error A subject-only shape cannot replace the relation.
const subjectOnlySubstitute: AlternativeFixture = {
  subject,
  context,
};

const wrongSubjectSlot: AlternativeFixture = {
  // @ts-expect-error The subject slot preserves TSubjectRef exactly.
  subject: alternative,
  alternative,
  context,
};
const wrongAlternativeSlot: AlternativeFixture = {
  subject,
  // @ts-expect-error The alternative slot preserves TAlternativeRef exactly.
  alternative: subject,
  context,
};
const wrongContextSlot: AlternativeFixture = {
  subject,
  alternative,
  // @ts-expect-error The context slot preserves TContextRef exactly.
  context: subject,
};

void alternativeShapeContract;
void alternativeAcceptsDistinctOpaqueValues;
void alternativeAcceptsNullableValues;
void alternativeAcceptsSameReferenceType;
void alternativeOwnsNoForbiddenFields;
void directionalAlternative;
void sameValueSelfRelation;
void missingSubject;
void missingAlternative;
void missingContextField;
void membersTupleSubstitute;
void optionsArraySubstitute;
void candidateOnlySubstitute;
void subjectOnlySubstitute;
void wrongSubjectSlot;
void wrongAlternativeSlot;
void wrongContextSlot;
