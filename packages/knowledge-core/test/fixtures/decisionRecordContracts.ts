import type { Decision, DecisionRecord } from "../../src/index.js";

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

type SelectionRefFixture = {
  selectionId: string;
};

type ContextRefFixture = {
  contextId: string;
};

type DecisionRecordFixture = DecisionRecord<
  RecordIdFixture,
  SelectionRefFixture,
  ContextRefFixture
>;

const decisionRecordShapeContract: Assert<
  Equal<
    DecisionRecordFixture,
    {
      readonly id: RecordIdFixture;
      decision: Decision<SelectionRefFixture, ContextRefFixture>;
    }
  >
> = true;
const decisionPayloadContract: Assert<
  Equal<
    DecisionRecordFixture["decision"],
    Decision<SelectionRefFixture, ContextRefFixture>
  >
> = true;

const stringIdRecord: DecisionRecord<string, number, boolean> = {
  id: "record-1",
  decision: { selection: 1, context: true },
};
const numberIdRecord: DecisionRecord<number, string, string> = {
  id: 2,
  decision: { selection: "selection-2", context: "context-2" },
};
const booleanIdRecord: DecisionRecord<boolean, string, number> = {
  id: false,
  decision: { selection: "selection-3", context: 3 },
};
const symbolId = Symbol("record-4");
const symbolIdRecord: DecisionRecord<symbol, string, number> = {
  id: symbolId,
  decision: { selection: "selection-4", context: 4 },
};
const bigintIdRecord: DecisionRecord<bigint, string, number> = {
  id: 5n,
  decision: { selection: "selection-5", context: 5 },
};
const objectIdRecord: DecisionRecord<{ recordKey: string }, string, number> = {
  id: { recordKey: "record-6" },
  decision: { selection: "selection-6", context: 6 },
};
const sameTypeSlotsRecord: DecisionRecord<string, string, string> = {
  id: "record-7",
  decision: { selection: "selection-7", context: "context-7" },
};

type NullId =
  // @ts-expect-error A DecisionRecord identity cannot be null.
  DecisionRecord<null, SelectionRefFixture, ContextRefFixture>;
type UndefinedId =
  // @ts-expect-error A DecisionRecord identity cannot be undefined.
  DecisionRecord<undefined, SelectionRefFixture, ContextRefFixture>;

// @ts-expect-error All three DecisionRecord generic arguments must be explicit.
type MissingAll = DecisionRecord;
type MissingSelectionAndContext =
  // @ts-expect-error Selection and context generic arguments must be explicit.
  DecisionRecord<RecordIdFixture>;
type MissingContext =
  // @ts-expect-error The context generic argument must be explicit.
  DecisionRecord<RecordIdFixture, SelectionRefFixture>;

const selection: SelectionRefFixture = { selectionId: "selection-A" };
const alternativeSelection: SelectionRefFixture = {
  selectionId: "selection-A-1",
};
const context: ContextRefFixture = { contextId: "context-P1" };

const stableIdentityRecord: DecisionRecordFixture = {
  id: { recordId: "stable-record" },
  decision: { selection, context },
};
// @ts-expect-error DecisionRecord id is stable in the public type.
stableIdentityRecord.id = { recordId: "replacement-record" };
stableIdentityRecord.decision = {
  selection: alternativeSelection,
  context,
};
stableIdentityRecord.decision.selection = selection;
stableIdentityRecord.decision.context = context;

const wrongIdRecord: DecisionRecordFixture = {
  // @ts-expect-error The id slot preserves TDecisionRecordId exactly.
  id: "record-id",
  decision: { selection, context },
};
const wrongSelectionRecord: DecisionRecordFixture = {
  id: { recordId: "wrong-selection" },
  decision: {
    // @ts-expect-error The selection slot preserves TSelectionRef exactly.
    selection: context,
    context,
  },
};
const wrongContextRecord: DecisionRecordFixture = {
  id: { recordId: "wrong-context" },
  decision: {
    selection,
    // @ts-expect-error The context slot preserves TContextRef exactly.
    context: selection,
  },
};

const legacyRecord: DecisionRecord<
  { recordKey: string },
  SelectionRefFixture,
  ContextRefFixture
> = {
  id: { recordKey: "legacy-17" },
  decision: {
    selection,
    context,
  },
};

const repeatedDecisionR1: DecisionRecord<
  string,
  SelectionRefFixture,
  ContextRefFixture
> = {
  id: "R1",
  decision: { selection, context },
};
const interveningDecisionR2: DecisionRecord<
  string,
  SelectionRefFixture,
  ContextRefFixture
> = {
  id: "R2",
  decision: { selection: alternativeSelection, context },
};
const repeatedDecisionR3: DecisionRecord<
  string,
  SelectionRefFixture,
  ContextRefFixture
> = {
  id: "R3",
  decision: { selection, context },
};
const repeatedPayloadContract: Assert<
  Equal<typeof repeatedDecisionR1.decision, typeof repeatedDecisionR3.decision>
> = true;

type SelectionWithMetadata = {
  optionId: string;
  confidence?: number;
  authorityClass?: string;
  model?: string;
};

const callerOwnedNestedMetadata: DecisionRecord<
  { recordKey: string },
  SelectionWithMetadata,
  ContextRefFixture
> = {
  id: { recordKey: "metadata-record" },
  decision: {
    selection: {
      optionId: "option-1",
      confidence: 0.75,
      authorityClass: "caller-owned",
      model: "caller-model",
    },
    context,
  },
};

type ForbiddenDecisionRecordOwnedField =
  | "ref"
  | "record"
  | "identity"
  | "recordId"
  | "decisionId"
  | "selection"
  | "context"
  | "actor"
  | "actorId"
  | "user"
  | "userId"
  | "decisionMaker"
  | "decidedBy"
  | "time"
  | "timestamp"
  | "decidedAt"
  | "recordedAt"
  | "createdAt"
  | "basis"
  | "bases"
  | "rationale"
  | "reason"
  | "reasons"
  | "justification"
  | "supersedes"
  | "supersededBy"
  | "revision"
  | "version"
  | "status"
  | "active"
  | "current"
  | "superseded"
  | "cancelled"
  | "approved"
  | "rejected"
  | "proposed"
  | "authority"
  | "authorityClass"
  | "evidence"
  | "evidenceId"
  | "provenance"
  | "applicable"
  | "applicability"
  | "compliant"
  | "compliance"
  | "valid"
  | "correct"
  | "confidence"
  | "confidenceScore"
  | "quality"
  | "success"
  | "successScore"
  | "score"
  | "rank"
  | "weight"
  | "recommendation"
  | "recommended"
  | "recommendationRef"
  | "precedent"
  | "precedence"
  | "winner"
  | "preferred"
  | "best"
  | "priority"
  | "reasoning"
  | "explanation"
  | "reasoningTrace"
  | "chainOfThought"
  | "internalReasoning"
  | "modelReasoning"
  | "model"
  | "provider"
  | "votes"
  | "agreement"
  | "consensus"
  | "modelConsensus"
  | "selfConsistency"
  | "metadata"
  | "recordMetadata"
  | "source"
  | "sourceType"
  | "ingestionSource"
  | "importedFrom"
  | "similarity"
  | "usageCount";

const decisionRecordOwnsNoForbiddenFields: Assert<
  Equal<
    Extract<keyof DecisionRecordFixture, ForbiddenDecisionRecordOwnedField>,
    never
  >
> = true;

void decisionRecordShapeContract;
void decisionPayloadContract;
void stringIdRecord;
void numberIdRecord;
void booleanIdRecord;
void symbolIdRecord;
void bigintIdRecord;
void objectIdRecord;
void sameTypeSlotsRecord;
void (null as NullId | null);
void (null as UndefinedId | null);
void (null as MissingAll | null);
void (null as MissingSelectionAndContext | null);
void (null as MissingContext | null);
void stableIdentityRecord;
void wrongIdRecord;
void wrongSelectionRecord;
void wrongContextRecord;
void legacyRecord;
void repeatedDecisionR1;
void interveningDecisionR2;
void repeatedDecisionR3;
void repeatedPayloadContract;
void callerOwnedNestedMetadata;
void decisionRecordOwnsNoForbiddenFields;
