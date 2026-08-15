import type { Decision, Inference } from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type SelectionRefFixture = {
  selectionId: string;
};

type ContextRefFixture = {
  contextId: string;
};

type DecisionFixture = Decision<SelectionRefFixture, ContextRefFixture>;

const decisionShapeContract: Assert<
  Equal<
    DecisionFixture,
    {
      selection: SelectionRefFixture;
      context: ContextRefFixture;
    }
  >
> = true;
const decisionAcceptsDistinctPrimitiveValues: Assert<
  Equal<
    Decision<string, number>,
    {
      selection: string;
      context: number;
    }
  >
> = true;
const decisionAcceptsNullableValues: Assert<
  Equal<
    Decision<null, undefined>,
    {
      selection: null;
      context: undefined;
    }
  >
> = true;
const decisionAcceptsSymbolAndBoolean: Assert<
  Equal<
    Decision<symbol, boolean>,
    {
      selection: symbol;
      context: boolean;
    }
  >
> = true;
const decisionAcceptsSameReferenceType: Assert<
  Equal<
    Decision<string, string>,
    {
      selection: string;
      context: string;
    }
  >
> = true;

type ForbiddenDecisionOwnedField =
  | "recommendation"
  | "recommended"
  | "recommendationRef"
  | "recommendationScore"
  | "followedRecommendation"
  | "authority"
  | "authorityClass"
  | "evidence"
  | "evidenceId"
  | "citation"
  | "citationId"
  | "sourcePath"
  | "page"
  | "excerpt"
  | "chunkId"
  | "documentId"
  | "locator"
  | "provenance"
  | "applicable"
  | "applicability"
  | "compliant"
  | "compliance"
  | "permitted"
  | "available"
  | "status"
  | "proposed"
  | "approved"
  | "rejected"
  | "active"
  | "cancelled"
  | "superseded"
  | "approval"
  | "approvedBy"
  | "authorized"
  | "authorization"
  | "confidence"
  | "confidenceScore"
  | "probability"
  | "certainty"
  | "quality"
  | "success"
  | "successScore"
  | "score"
  | "rank"
  | "weight"
  | "precedent"
  | "precedence"
  | "winner"
  | "loser"
  | "preferred"
  | "best"
  | "priority"
  | "overrides"
  | "supersedes"
  | "supersededBy"
  | "basis"
  | "bases"
  | "rationale"
  | "reason"
  | "reasons"
  | "justification"
  | "id"
  | "decisionId"
  | "recordId"
  | "actor"
  | "actorId"
  | "user"
  | "userId"
  | "decisionMaker"
  | "decidedBy"
  | "timestamp"
  | "time"
  | "decidedAt"
  | "recordedAt"
  | "createdAt"
  | "explanation"
  | "reasoning"
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
  | "subject"
  | "alternative"
  | "candidate"
  | "members"
  | "options"
  | "valid"
  | "correct";

const decisionOwnsNoForbiddenFields: Assert<
  Equal<Extract<keyof DecisionFixture, ForbiddenDecisionOwnedField>, never>
> = true;

const selection: SelectionRefFixture = { selectionId: "selection-1" };
const context: ContextRefFixture = { contextId: "context-1" };

const contextualDecision: DecisionFixture = {
  selection,
  context,
};

const legacyDecision: DecisionFixture = {
  selection,
  context,
};

type SelectionWithMetadata = {
  optionId: string;
  model?: string;
  confidence?: number;
  authorityClass?: string;
};

const callerOwnedNestedMetadata: Decision<
  SelectionWithMetadata,
  ContextRefFixture
> = {
  selection: {
    optionId: "option-1",
    model: "caller-model",
    confidence: 0.75,
    authorityClass: "caller-owned",
  },
  context,
};

const decisionAsInferencePremise: Inference<
  string,
  ContextRefFixture,
  DecisionFixture
> = {
  claim: "later-claim",
  context,
  premises: [contextualDecision],
};

// @ts-expect-error Both decision generic arguments must be explicit.
type MissingAll = Decision;
type MissingContext =
  // @ts-expect-error The context generic argument must be explicit.
  Decision<SelectionRefFixture>;

void (null as MissingAll | null);
void (null as MissingContext | null);

// @ts-expect-error A decision requires its caller-supplied selection.
const missingSelection: DecisionFixture = {
  context,
};
// @ts-expect-error A decision requires its caller-supplied context.
const missingContext: DecisionFixture = {
  selection,
};

const wrongSelectionSlot: DecisionFixture = {
  // @ts-expect-error The selection slot preserves TSelectionRef exactly.
  selection: context,
  context,
};
const wrongContextSlot: DecisionFixture = {
  selection,
  // @ts-expect-error The context slot preserves TContextRef exactly.
  context: selection,
};

void decisionShapeContract;
void decisionAcceptsDistinctPrimitiveValues;
void decisionAcceptsNullableValues;
void decisionAcceptsSymbolAndBoolean;
void decisionAcceptsSameReferenceType;
void decisionOwnsNoForbiddenFields;
void contextualDecision;
void legacyDecision;
void callerOwnedNestedMetadata;
void decisionAsInferencePremise;
void missingSelection;
void missingContext;
void wrongSelectionSlot;
void wrongContextSlot;
