import type {
  DecisionBasis,
  Inference,
  RequirementApplicability,
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

type RecordIdFixture = {
  recordId: string;
};

type BasisFixture = {
  basisId: string;
};

type DecisionBasisFixture = DecisionBasis<RecordIdFixture, BasisFixture>;

const decisionBasisShapeContract: Assert<
  Equal<
    DecisionBasisFixture,
    {
      decisionRecordId: RecordIdFixture;
      basis: BasisFixture;
    }
  >
> = true;
const decisionRecordIdSlotContract: Assert<
  Equal<DecisionBasisFixture["decisionRecordId"], RecordIdFixture>
> = true;
const basisSlotContract: Assert<
  Equal<DecisionBasisFixture["basis"], BasisFixture>
> = true;

const basisFixture: BasisFixture = { basisId: "basis-1" };

const stringIdRelation: DecisionBasis<string, BasisFixture> = {
  decisionRecordId: "R1",
  basis: basisFixture,
};
const numberIdRelation: DecisionBasis<number, BasisFixture> = {
  decisionRecordId: 2,
  basis: basisFixture,
};
const booleanIdRelation: DecisionBasis<boolean, BasisFixture> = {
  decisionRecordId: false,
  basis: basisFixture,
};
const symbolRecordId = Symbol("R3");
const symbolIdRelation: DecisionBasis<symbol, BasisFixture> = {
  decisionRecordId: symbolRecordId,
  basis: basisFixture,
};
const bigintIdRelation: DecisionBasis<bigint, BasisFixture> = {
  decisionRecordId: 4n,
  basis: basisFixture,
};
const objectIdRelation: DecisionBasis<{ recordKey: string }, BasisFixture> = {
  decisionRecordId: { recordKey: "R5" },
  basis: basisFixture,
};

type NullDecisionRecordId =
  // @ts-expect-error A DecisionBasis target identity cannot be null.
  DecisionBasis<null, BasisFixture>;
type UndefinedDecisionRecordId =
  // @ts-expect-error A DecisionBasis target identity cannot be undefined.
  DecisionBasis<undefined, BasisFixture>;

const stringBasis: DecisionBasis<string, string> = {
  decisionRecordId: "R6",
  basis: "customer instruction",
};
const numberBasis: DecisionBasis<string, number> = {
  decisionRecordId: "R7",
  basis: 7,
};
const booleanBasis: DecisionBasis<string, boolean> = {
  decisionRecordId: "R8",
  basis: true,
};
const symbolBasisValue = Symbol("basis-9");
const symbolBasis: DecisionBasis<string, symbol> = {
  decisionRecordId: "R9",
  basis: symbolBasisValue,
};
const bigintBasis: DecisionBasis<string, bigint> = {
  decisionRecordId: "R10",
  basis: 10n,
};
const objectBasis: DecisionBasis<string, { basisKey: string }> = {
  decisionRecordId: "R11",
  basis: { basisKey: "basis-11" },
};

type InferenceBasis = Inference<
  { claimId: string },
  { contextId: string },
  { premiseId: string }
>;
const inferenceBasis: DecisionBasis<string, InferenceBasis> = {
  decisionRecordId: "R12",
  basis: {
    claim: { claimId: "claim-12" },
    context: { contextId: "context-12" },
    premises: [{ premiseId: "premise-12" }],
  },
};

type ApplicabilityBasis = RequirementApplicability<
  { requirementId: string },
  { contextId: string }
>;
const applicabilityBasis: DecisionBasis<string, ApplicabilityBasis> = {
  decisionRecordId: "R13",
  basis: {
    requirement: { requirementId: "requirement-13" },
    context: { contextId: "context-13" },
    status: "applicable",
  },
};

type NullBasis =
  // @ts-expect-error A DecisionBasis requires an actual non-nullish basis.
  DecisionBasis<string, null>;
type UndefinedBasis =
  // @ts-expect-error A DecisionBasis requires an actual non-nullish basis.
  DecisionBasis<string, undefined>;

type ExplicitUnknownBasis = {
  kind: "unknown";
};
const explicitUnknownBasis: DecisionBasis<string, ExplicitUnknownBasis> = {
  decisionRecordId: "R14",
  basis: { kind: "unknown" },
};

type LegacyNullBasis = {
  kind: "legacy-null";
};
const legacyNullBasis: DecisionBasis<string, LegacyNullBasis> = {
  decisionRecordId: "R15",
  basis: { kind: "legacy-null" },
};

// @ts-expect-error Both DecisionBasis generic arguments must be explicit.
type MissingAllGenericArguments = DecisionBasis;
type MissingBasisArgument =
  // @ts-expect-error The basis generic argument must be explicit.
  DecisionBasis<RecordIdFixture>;

const recordId: RecordIdFixture = { recordId: "R16" };
const anotherRecordId: RecordIdFixture = { recordId: "R17" };
const anotherBasis: BasisFixture = { basisId: "basis-2" };

const mutableRelation: DecisionBasisFixture = {
  decisionRecordId: recordId,
  basis: basisFixture,
};
mutableRelation.decisionRecordId = anotherRecordId;
mutableRelation.basis = anotherBasis;

const wrongDecisionRecordIdSlot: DecisionBasisFixture = {
  // @ts-expect-error The target slot preserves TDecisionRecordId exactly.
  decisionRecordId: basisFixture,
  basis: basisFixture,
};
const wrongBasisSlot: DecisionBasisFixture = {
  decisionRecordId: recordId,
  // @ts-expect-error The basis slot preserves TBasis exactly.
  basis: recordId,
};

// @ts-expect-error A DecisionBasis requires its DecisionRecord identity target.
const missingDecisionRecordId: DecisionBasisFixture = {
  basis: basisFixture,
};
// @ts-expect-error A DecisionBasis requires one actual basis value.
const missingBasis: DecisionBasisFixture = {
  decisionRecordId: recordId,
};
const wrongTargetName: DecisionBasisFixture = {
  // @ts-expect-error A DecisionRecord value or alternate target name is not the ID slot.
  decisionRecord: recordId,
  basis: basisFixture,
};

type CompoundBasis = {
  kind: "compound";
  members: readonly [{ requirementId: string }, { conditionId: string }];
};
const compoundBasis: DecisionBasis<string, CompoundBasis> = {
  decisionRecordId: "R17",
  basis: {
    kind: "compound",
    members: [
      { requirementId: "requirement-17" },
      { conditionId: "condition-17" },
    ],
  },
};

const callerOwnedArrayBasis: DecisionBasis<string, readonly string[]> = {
  decisionRecordId: "R17",
  basis: ["basis-X", "basis-Y"],
};

type CallerOwnedModelBasis = {
  kind: "model-output";
  model: string;
  reasoning: string;
};
const callerOwnedModelBasis: DecisionBasis<string, CallerOwnedModelBasis> = {
  decisionRecordId: "R17",
  basis: {
    kind: "model-output",
    model: "caller-model",
    reasoning: "caller-owned rationale reference",
  },
};

const relationR17X: DecisionBasis<string, BasisFixture> = {
  decisionRecordId: "R17",
  basis: { basisId: "X" },
};
const relationR17Y: DecisionBasis<string, BasisFixture> = {
  decisionRecordId: "R17",
  basis: { basisId: "Y" },
};
const duplicateRelationR17X: DecisionBasis<string, BasisFixture> = {
  decisionRecordId: "R17",
  basis: { basisId: "X" },
};

type DecisionRecordShapedOpaqueId = {
  readonly id: string;
  decision: {
    selection: string;
    context: string;
  };
};
const decisionRecordShapedObjectId: DecisionBasis<
  DecisionRecordShapedOpaqueId,
  BasisFixture
> = {
  decisionRecordId: {
    id: "caller-selected-object-id",
    decision: { selection: "selection", context: "context" },
  },
  basis: basisFixture,
};

type ForbiddenDecisionBasisOwnedField =
  | "decisionRecord"
  | "decision"
  | "record"
  | "subject"
  | "ref"
  | "context"
  | "selection"
  | "id"
  | "basisId"
  | "relationId"
  | "actor"
  | "actorId"
  | "user"
  | "userId"
  | "recordedBy"
  | "author"
  | "time"
  | "timestamp"
  | "recordedAt"
  | "createdAt"
  | "decidedAt"
  | "source"
  | "sourceType"
  | "provenance"
  | "importedFrom"
  | "ingestionSource"
  | "authority"
  | "authorityClass"
  | "confidence"
  | "confidenceScore"
  | "score"
  | "weight"
  | "rank"
  | "priority"
  | "importance"
  | "status"
  | "active"
  | "current"
  | "valid"
  | "invalid"
  | "sufficient"
  | "insufficient"
  | "complete"
  | "completeness"
  | "exhaustive"
  | "validated"
  | "verified"
  | "correct"
  | "compliant"
  | "compliance"
  | "applicable"
  | "applicability"
  | "recommendation"
  | "recommended"
  | "preferred"
  | "best"
  | "winner"
  | "precedent"
  | "precedence"
  | "reasoning"
  | "explanation"
  | "rationale"
  | "reason"
  | "chainOfThought"
  | "internalReasoning"
  | "model"
  | "provider"
  | "votes"
  | "agreement"
  | "consensus"
  | "modelConsensus"
  | "supersedes"
  | "supersededBy"
  | "revision"
  | "version"
  | "metadata"
  | "recordMetadata"
  | "collection"
  | "table"
  | "schema"
  | "repository"
  | "store"
  | "premises"
  | "claim"
  | "bases"
  | "basisType"
  | "kind";

const decisionBasisOwnsNoForbiddenFields: Assert<
  Equal<
    Extract<keyof DecisionBasisFixture, ForbiddenDecisionBasisOwnedField>,
    never
  >
> = true;

const extraFieldAttack: DecisionBasisFixture = {
  decisionRecordId: recordId,
  basis: basisFixture,
  // @ts-expect-error Unlisted fields are rejected independently of the forbidden union.
  note: "not core-owned",
};

void decisionBasisShapeContract;
void decisionRecordIdSlotContract;
void basisSlotContract;
void stringIdRelation;
void numberIdRelation;
void booleanIdRelation;
void symbolIdRelation;
void bigintIdRelation;
void objectIdRelation;
void (null as NullDecisionRecordId | null);
void (null as UndefinedDecisionRecordId | null);
void stringBasis;
void numberBasis;
void booleanBasis;
void symbolBasis;
void bigintBasis;
void objectBasis;
void inferenceBasis;
void applicabilityBasis;
void (null as NullBasis | null);
void (null as UndefinedBasis | null);
void explicitUnknownBasis;
void legacyNullBasis;
void (null as MissingAllGenericArguments | null);
void (null as MissingBasisArgument | null);
void mutableRelation;
void wrongDecisionRecordIdSlot;
void wrongBasisSlot;
void missingDecisionRecordId;
void missingBasis;
void wrongTargetName;
void compoundBasis;
void callerOwnedArrayBasis;
void callerOwnedModelBasis;
void relationR17X;
void relationR17Y;
void duplicateRelationR17X;
void decisionRecordShapedObjectId;
void decisionBasisOwnsNoForbiddenFields;
void extraFieldAttack;
