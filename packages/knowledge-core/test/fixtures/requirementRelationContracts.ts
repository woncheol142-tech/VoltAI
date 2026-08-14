import type {
  ApplicabilityStatus,
  ConflictStatus,
  RequirementApplicability,
  RequirementConflict,
} from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type RequirementRefFixture = {
  requirementId: string;
};

type ContextRefFixture = {
  contextId: string;
};

type ApplicabilityFixture = RequirementApplicability<
  RequirementRefFixture,
  ContextRefFixture
>;
type ConflictFixture = RequirementConflict<
  RequirementRefFixture,
  ContextRefFixture
>;

const applicabilityStatusContract: Assert<
  Equal<ApplicabilityStatus, "applicable" | "not-applicable" | "undetermined">
> = true;
const conflictStatusContract: Assert<
  Equal<ConflictStatus, "conflict" | "no-conflict" | "undetermined">
> = true;
const applicabilityShapeContract: Assert<
  Equal<
    ApplicabilityFixture,
    {
      requirement: RequirementRefFixture;
      context: ContextRefFixture;
      status: ApplicabilityStatus;
    }
  >
> = true;
const conflictShapeContract: Assert<
  Equal<
    ConflictFixture,
    {
      members: readonly [RequirementRefFixture, RequirementRefFixture];
      context: ContextRefFixture;
      status: ConflictStatus;
    }
  >
> = true;
const applicabilityAcceptsOpaqueRefs: Assert<
  Equal<
    RequirementApplicability<string, number>,
    {
      requirement: string;
      context: number;
      status: ApplicabilityStatus;
    }
  >
> = true;
const conflictAcceptsOpaqueRefs: Assert<
  Equal<
    RequirementConflict<string, number>,
    {
      members: readonly [string, string];
      context: number;
      status: ConflictStatus;
    }
  >
> = true;
const applicabilityAcceptsNullableRefs: Assert<
  Equal<
    RequirementApplicability<null, undefined>,
    {
      requirement: null;
      context: undefined;
      status: ApplicabilityStatus;
    }
  >
> = true;
const conflictAcceptsNullableRefs: Assert<
  Equal<
    RequirementConflict<null, undefined>,
    {
      members: readonly [null, null];
      context: undefined;
      status: ConflictStatus;
    }
  >
> = true;

type ForbiddenRelationField =
  | "evidence"
  | "evidenceId"
  | "sourcePath"
  | "page"
  | "excerpt"
  | "documentId"
  | "chunkId"
  | "locator"
  | "metadata"
  | "collection"
  | "sourceType"
  | "similarity"
  | "authority"
  | "authorityClass"
  | "missingConditions"
  | "missingFacts"
  | "undeterminedReasons"
  | "conditionIds"
  | "contextFacts"
  | "subject"
  | "incompatibility"
  | "winner"
  | "loser"
  | "preferred"
  | "override"
  | "overrides"
  | "supersedes"
  | "higherAuthority"
  | "lowerAuthority"
  | "priority"
  | "rank"
  | "weight"
  | "precedence"
  | "precedenceScore"
  | "confidence"
  | "confidenceScore";

const applicabilityOwnsNoForbiddenFields: Assert<
  Equal<Extract<keyof ApplicabilityFixture, ForbiddenRelationField>, never>
> = true;
const conflictOwnsNoForbiddenFields: Assert<
  Equal<Extract<keyof ConflictFixture, ForbiddenRelationField>, never>
> = true;

const requirement: RequirementRefFixture = { requirementId: "requirement-1" };
const otherRequirement: RequirementRefFixture = {
  requirementId: "requirement-2",
};
const context: ContextRefFixture = { contextId: "context-1" };

const applicable: ApplicabilityFixture = {
  requirement,
  context,
  status: "applicable",
};
const conflict: ConflictFixture = {
  members: [requirement, otherRequirement],
  context,
  status: "conflict",
};

// @ts-expect-error Both relation generic arguments must be explicit.
type MissingApplicabilityArguments = RequirementApplicability;
type MissingApplicabilityContext =
  // @ts-expect-error The context-reference generic argument must be explicit.
  RequirementApplicability<RequirementRefFixture>;
// @ts-expect-error Both relation generic arguments must be explicit.
type MissingConflictArguments = RequirementConflict;
// @ts-expect-error The context-reference generic argument must be explicit.
type MissingConflictContext = RequirementConflict<RequirementRefFixture>;

void (null as MissingApplicabilityArguments | null);
void (null as MissingApplicabilityContext | null);
void (null as MissingConflictArguments | null);
void (null as MissingConflictContext | null);

// @ts-expect-error ApplicabilityStatus is not boolean.
const applicabilityTrue: ApplicabilityStatus = true;
// @ts-expect-error ApplicabilityStatus is not boolean.
const applicabilityFalse: ApplicabilityStatus = false;
// @ts-expect-error ApplicabilityStatus is a closed semantic union.
const applicabilityMaybe: ApplicabilityStatus = "maybe";
// @ts-expect-error ApplicabilityStatus does not use unknown as a status.
const applicabilityUnknown: ApplicabilityStatus = "unknown";
// @ts-expect-error Conflict terminology is not an applicability status.
const applicabilityConflict: ApplicabilityStatus = "conflict";
// @ts-expect-error ApplicabilityStatus is not numeric.
const applicabilityNumber: ApplicabilityStatus = 1;

// @ts-expect-error ConflictStatus is not boolean.
const conflictTrue: ConflictStatus = true;
// @ts-expect-error ConflictStatus is not boolean.
const conflictFalse: ConflictStatus = false;
// @ts-expect-error Compatibility is not represented by ConflictStatus.
const conflictCompatible: ConflictStatus = "compatible";
// @ts-expect-error Incompatibility is not represented by ConflictStatus.
const conflictIncompatible: ConflictStatus = "incompatible";
// @ts-expect-error ConflictStatus does not use unknown as a status.
const conflictUnknown: ConflictStatus = "unknown";
// @ts-expect-error ConflictStatus does not encode precedence outcomes.
const conflictWinner: ConflictStatus = "winner";
// @ts-expect-error ConflictStatus is not numeric.
const conflictNumber: ConflictStatus = 1;

// @ts-expect-error Applicability requires its caller-supplied context.
const applicabilityWithoutContext: ApplicabilityFixture = {
  requirement,
  status: "applicable",
};
const applicabilityWithEvidence: ApplicabilityFixture = {
  requirement,
  context,
  status: "applicable",
  // @ts-expect-error Evidence is not a Task68 relation field.
  evidence: { evidenceId: "evidence-1" },
};
const applicabilityWithProvenance: ApplicabilityFixture = {
  requirement,
  context,
  status: "applicable",
  // @ts-expect-error Provenance remains owned by the caller's reference type.
  sourcePath: "standards/example.pdf",
};
const applicabilityWithMissingConditions: ApplicabilityFixture = {
  requirement,
  context,
  status: "undetermined",
  // @ts-expect-error Task68 has no missing-condition vocabulary.
  missingConditions: ["project date"],
};

const conflictWithOneMember: ConflictFixture = {
  // @ts-expect-error A conflict relation has exactly two members.
  members: [requirement],
  context,
  status: "undetermined",
};
const conflictWithThreeMembers: ConflictFixture = {
  // @ts-expect-error A conflict relation has exactly two members.
  members: [requirement, otherRequirement, requirement],
  context,
  status: "undetermined",
};
// @ts-expect-error A conflict relation requires its caller-supplied context.
const conflictWithoutContext: ConflictFixture = {
  members: [requirement, otherRequirement],
  status: "no-conflict",
};
const conflictWithBooleanStatus: ConflictFixture = {
  members: [requirement, otherRequirement],
  context,
  // @ts-expect-error ConflictStatus is not boolean.
  status: false,
};
const conflictWithWinner: ConflictFixture = {
  members: [requirement, otherRequirement],
  context,
  status: "conflict",
  // @ts-expect-error Task68 does not choose a winner.
  winner: requirement,
};
const conflictWithProvenance: ConflictFixture = {
  members: [requirement, otherRequirement],
  context,
  status: "conflict",
  // @ts-expect-error Provenance remains owned by the caller's reference type.
  sourcePath: "standards/example.pdf",
};

void applicabilityStatusContract;
void conflictStatusContract;
void applicabilityShapeContract;
void conflictShapeContract;
void applicabilityAcceptsOpaqueRefs;
void conflictAcceptsOpaqueRefs;
void applicabilityAcceptsNullableRefs;
void conflictAcceptsNullableRefs;
void applicabilityOwnsNoForbiddenFields;
void conflictOwnsNoForbiddenFields;
void applicable;
void conflict;
void applicabilityTrue;
void applicabilityFalse;
void applicabilityMaybe;
void applicabilityUnknown;
void applicabilityConflict;
void applicabilityNumber;
void conflictTrue;
void conflictFalse;
void conflictCompatible;
void conflictIncompatible;
void conflictUnknown;
void conflictWinner;
void conflictNumber;
void applicabilityWithoutContext;
void applicabilityWithEvidence;
void applicabilityWithProvenance;
void applicabilityWithMissingConditions;
void conflictWithOneMember;
void conflictWithThreeMembers;
void conflictWithoutContext;
void conflictWithBooleanStatus;
void conflictWithWinner;
void conflictWithProvenance;
