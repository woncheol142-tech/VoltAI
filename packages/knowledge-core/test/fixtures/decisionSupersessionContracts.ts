import type { DecisionSupersession } from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type SupersededIdFixture = {
  supersededRecordKey: string;
};

type SupersedingIdFixture = {
  supersedingRecordKey: number;
};

type DecisionSupersessionFixture = DecisionSupersession<
  SupersededIdFixture,
  SupersedingIdFixture
>;

const decisionSupersessionShapeContract: Assert<
  Equal<
    DecisionSupersessionFixture,
    {
      supersededDecisionRecordId: SupersededIdFixture;
      supersedingDecisionRecordId: SupersedingIdFixture;
    }
  >
> = true;
const supersededSlotContract: Assert<
  Equal<
    DecisionSupersessionFixture["supersededDecisionRecordId"],
    SupersededIdFixture
  >
> = true;
const supersedingSlotContract: Assert<
  Equal<
    DecisionSupersessionFixture["supersedingDecisionRecordId"],
    SupersedingIdFixture
  >
> = true;

type LegacyId = {
  legacyKey: number;
};

type ModernId = {
  modernKey: string;
};

const migrationEdge: DecisionSupersession<LegacyId, ModernId> = {
  supersededDecisionRecordId: { legacyKey: 1 },
  supersedingDecisionRecordId: { modernKey: "R-1" },
};

const reversedMigrationEdge: DecisionSupersession<LegacyId, ModernId> = {
  // @ts-expect-error The superseded slot preserves the first endpoint domain.
  supersededDecisionRecordId: { modernKey: "R-2" },
  // @ts-expect-error The superseding slot preserves the second endpoint domain.
  supersedingDecisionRecordId: { legacyKey: 2 },
};

const homogeneousEdge: DecisionSupersession<string, string> = {
  supersededDecisionRecordId: "R1",
  supersedingDecisionRecordId: "R2",
};

// Each caller-owned non-nullish representation remains legal in both slots.
const stringNumberEdge: DecisionSupersession<string, number> = {
  supersededDecisionRecordId: "R3",
  supersedingDecisionRecordId: 4,
};
const numberBooleanEdge: DecisionSupersession<number, boolean> = {
  supersededDecisionRecordId: 5,
  supersedingDecisionRecordId: false,
};
const booleanSymbolValue = Symbol("superseding-R6");
const booleanSymbolEdge: DecisionSupersession<boolean, symbol> = {
  supersededDecisionRecordId: true,
  supersedingDecisionRecordId: booleanSymbolValue,
};
const supersededSymbolValue = Symbol("superseded-R7");
const symbolBigintEdge: DecisionSupersession<symbol, bigint> = {
  supersededDecisionRecordId: supersededSymbolValue,
  supersedingDecisionRecordId: 8n,
};
const bigintObjectEdge: DecisionSupersession<bigint, { modernKey: string }> = {
  supersededDecisionRecordId: 9n,
  supersedingDecisionRecordId: { modernKey: "R10" },
};
const objectStringEdge: DecisionSupersession<{ legacyKey: number }, string> = {
  supersededDecisionRecordId: { legacyKey: 11 },
  supersedingDecisionRecordId: "R12",
};

type NullSupersededEndpoint =
  // @ts-expect-error The superseded endpoint cannot be null.
  DecisionSupersession<null, string>;
type UndefinedSupersededEndpoint =
  // @ts-expect-error The superseded endpoint cannot be undefined.
  DecisionSupersession<undefined, string>;
type NullSupersedingEndpoint =
  // @ts-expect-error The superseding endpoint cannot be null.
  DecisionSupersession<string, null>;
type UndefinedSupersedingEndpoint =
  // @ts-expect-error The superseding endpoint cannot be undefined.
  DecisionSupersession<string, undefined>;
type NullishUnionSupersededEndpoint =
  // @ts-expect-error A superseded endpoint union cannot include null.
  DecisionSupersession<string | null, string>;
type NullishUnionSupersedingEndpoint =
  // @ts-expect-error A superseding endpoint union cannot include undefined.
  DecisionSupersession<string, string | undefined>;

// @ts-expect-error Both DecisionSupersession generic arguments must be explicit.
type MissingAllGenericArguments = DecisionSupersession;
type MissingSupersedingGenericArgument =
  // @ts-expect-error The superseding endpoint generic argument must be explicit.
  DecisionSupersession<SupersededIdFixture>;
type ExcessGenericArgument =
  // @ts-expect-error DecisionSupersession has exactly two generic arguments.
  DecisionSupersession<SupersededIdFixture, SupersedingIdFixture, string>;

const supersededId: SupersededIdFixture = {
  supersededRecordKey: "legacy-R13",
};
const anotherSupersededId: SupersededIdFixture = {
  supersededRecordKey: "legacy-R14",
};
const supersedingId: SupersedingIdFixture = { supersedingRecordKey: 15 };
const anotherSupersedingId: SupersedingIdFixture = {
  supersedingRecordKey: 16,
};

const mutableRelation: DecisionSupersessionFixture = {
  supersededDecisionRecordId: supersededId,
  supersedingDecisionRecordId: supersedingId,
};
mutableRelation.supersededDecisionRecordId = anotherSupersededId;
mutableRelation.supersedingDecisionRecordId = anotherSupersedingId;

// @ts-expect-error A direct relation requires its superseded endpoint.
const missingSupersededEndpoint: DecisionSupersessionFixture = {
  supersedingDecisionRecordId: supersedingId,
};
// @ts-expect-error A direct relation requires its superseding endpoint.
const missingSupersedingEndpoint: DecisionSupersessionFixture = {
  supersededDecisionRecordId: supersededId,
};

type ForbiddenDecisionSupersessionOwnedField =
  | "superseded"
  | "superseding"
  | "decisionRecord"
  | "decision"
  | "record"
  | "predecessorDecisionRecordId"
  | "successorDecisionRecordId"
  | "fromDecisionRecordId"
  | "toDecisionRecordId"
  | "replacementDecisionRecordId"
  | "supersedesDecisionRecordId"
  | "supersededByDecisionRecordId"
  | "members"
  | "supersededDecisionRecordIds"
  | "supersedingDecisionRecordIds"
  | "context"
  | "scope"
  | "selection"
  | "subject"
  | "id"
  | "relationId"
  | "supersessionId"
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
  | "effectiveAt"
  | "supersededAt"
  | "source"
  | "sourceType"
  | "provenance"
  | "importedFrom"
  | "ingestionSource"
  | "reason"
  | "rationale"
  | "basis"
  | "bases"
  | "explanation"
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
  | "isCurrent"
  | "cancelled"
  | "replaced"
  | "valid"
  | "invalid"
  | "correct"
  | "compliant"
  | "compliance"
  | "applicable"
  | "applicability"
  | "verified"
  | "validated"
  | "recommendation"
  | "recommended"
  | "preferred"
  | "best"
  | "winner"
  | "precedent"
  | "precedence"
  | "revision"
  | "version"
  | "model"
  | "provider"
  | "votes"
  | "agreement"
  | "consensus"
  | "modelConsensus"
  | "reasoning"
  | "chainOfThought"
  | "internalReasoning"
  | "metadata"
  | "recordMetadata"
  | "collection"
  | "table"
  | "schema"
  | "repository"
  | "store";

const decisionSupersessionOwnsNoForbiddenFields: Assert<
  Equal<
    Extract<
      keyof DecisionSupersessionFixture,
      ForbiddenDecisionSupersessionOwnedField
    >,
    never
  >
> = true;

const extraFieldAttack: DecisionSupersessionFixture = {
  supersededDecisionRecordId: supersededId,
  supersedingDecisionRecordId: supersedingId,
  // @ts-expect-error Unlisted fields are rejected independently of the forbidden union.
  note: "not core-owned",
};

void decisionSupersessionShapeContract;
void supersededSlotContract;
void supersedingSlotContract;
void migrationEdge;
void reversedMigrationEdge;
void homogeneousEdge;
void stringNumberEdge;
void numberBooleanEdge;
void booleanSymbolEdge;
void symbolBigintEdge;
void bigintObjectEdge;
void objectStringEdge;
void (null as NullSupersededEndpoint | null);
void (null as UndefinedSupersededEndpoint | null);
void (null as NullSupersedingEndpoint | null);
void (null as UndefinedSupersedingEndpoint | null);
void (null as NullishUnionSupersededEndpoint | null);
void (null as NullishUnionSupersedingEndpoint | null);
void (null as MissingAllGenericArguments | null);
void (null as MissingSupersedingGenericArgument | null);
void (null as ExcessGenericArgument | null);
void mutableRelation;
void missingSupersededEndpoint;
void missingSupersedingEndpoint;
void decisionSupersessionOwnsNoForbiddenFields;
void extraFieldAttack;
