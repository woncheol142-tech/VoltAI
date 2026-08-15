import type { Inference } from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type ClaimRefFixture = {
  claimId: string;
};

type ContextRefFixture = {
  contextId: string;
};

type PremiseFixture = {
  premiseId: string;
};

type InferenceFixture = Inference<
  ClaimRefFixture,
  ContextRefFixture,
  PremiseFixture
>;

const inferenceShapeContract: Assert<
  Equal<
    InferenceFixture,
    {
      claim: ClaimRefFixture;
      context: ContextRefFixture;
      premises: readonly [PremiseFixture, ...PremiseFixture[]];
    }
  >
> = true;
const inferenceAcceptsOpaqueValues: Assert<
  Equal<
    Inference<string, number, boolean>,
    {
      claim: string;
      context: number;
      premises: readonly [boolean, ...boolean[]];
    }
  >
> = true;
const inferenceAcceptsNullableValues: Assert<
  Equal<
    Inference<null, undefined, symbol>,
    {
      claim: null;
      context: undefined;
      premises: readonly [symbol, ...symbol[]];
    }
  >
> = true;

type ForbiddenInferenceField =
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
  | "collection"
  | "sourceType"
  | "similarity"
  | "status"
  | "supported"
  | "unsupported"
  | "established"
  | "candidate"
  | "valid"
  | "invalid"
  | "confidence"
  | "confidenceScore"
  | "probability"
  | "certainty"
  | "explanation"
  | "reasoning"
  | "reasoningTrace"
  | "chainOfThought"
  | "internalReasoning"
  | "model"
  | "provider"
  | "votes"
  | "agreement"
  | "consensus"
  | "selfConsistency"
  | "winner"
  | "loser"
  | "preferred"
  | "recommended"
  | "best"
  | "overrides"
  | "supersedes"
  | "higherAuthority"
  | "lowerAuthority"
  | "priority"
  | "rank"
  | "weight"
  | "score"
  | "precedence"
  | "precedenceScore"
  | "recommendationScore"
  | "missingFacts"
  | "missingConditions";

const inferenceOwnsNoForbiddenFields: Assert<
  Equal<Extract<keyof InferenceFixture, ForbiddenInferenceField>, never>
> = true;

const claim: ClaimRefFixture = { claimId: "claim-1" };
const context: ContextRefFixture = { contextId: "context-1" };
const premise: PremiseFixture = { premiseId: "premise-1" };
const otherPremise: PremiseFixture = { premiseId: "premise-2" };

const singlePremise: InferenceFixture = {
  claim,
  context,
  premises: [premise],
};
const multiplePremises: InferenceFixture = {
  claim,
  context,
  premises: [premise, otherPremise],
};

type CallerOwnedPremise =
  | { kind: "evidence"; evidenceId: string }
  | { kind: "applicability"; requirementId: string; status: string }
  | { kind: "conflict"; memberIds: readonly [string, string] }
  | { kind: "model-output"; model: string; outputId: string };

const callerOwnedPremiseUnion: Inference<
  ClaimRefFixture,
  ContextRefFixture,
  CallerOwnedPremise
> = {
  claim,
  context,
  premises: [
    { kind: "evidence", evidenceId: "evidence-1" },
    { kind: "applicability", requirementId: "requirement-1", status: "open" },
    { kind: "conflict", memberIds: ["requirement-1", "requirement-2"] },
    { kind: "model-output", model: "caller-model", outputId: "output-1" },
  ],
};

type PremiseWithCallerOwnedMetadata = {
  authorityClass: string;
  sourcePath: string;
  page: number;
  model: string;
};

const premiseWithCallerOwnedMetadata: Inference<
  ClaimRefFixture,
  ContextRefFixture,
  PremiseWithCallerOwnedMetadata
> = {
  claim,
  context,
  premises: [
    {
      authorityClass: "caller-owned",
      sourcePath: "caller/source.pdf",
      page: 1,
      model: "caller-model",
    },
  ],
};

type ModelPremise = {
  model: string;
  outputId: string;
};

const modelOutputPremise: Inference<
  ClaimRefFixture,
  ContextRefFixture,
  ModelPremise
> = {
  claim,
  context,
  premises: [{ model: "caller-model", outputId: "output-2" }],
};

// @ts-expect-error All inference generic arguments must be explicit.
type MissingAll = Inference;
type MissingContextAndPremise =
  // @ts-expect-error Context and premise generic arguments must be explicit.
  Inference<ClaimRefFixture>;
type MissingPremise =
  // @ts-expect-error The premise generic argument must be explicit.
  Inference<ClaimRefFixture, ContextRefFixture>;

void (null as MissingAll | null);
void (null as MissingContextAndPremise | null);
void (null as MissingPremise | null);

const emptyPremises: InferenceFixture = {
  claim,
  context,
  // @ts-expect-error An inference requires at least one premise.
  premises: [],
};

// @ts-expect-error An inference requires its caller-supplied claim.
const missingClaim: InferenceFixture = {
  context,
  premises: [premise],
};
// @ts-expect-error An inference requires its caller-supplied context.
const missingContext: InferenceFixture = {
  claim,
  premises: [premise],
};
// @ts-expect-error An inference requires its non-empty premises field.
const missingPremises: InferenceFixture = {
  claim,
  context,
};

const wrongClaimSlot: InferenceFixture = {
  // @ts-expect-error The claim slot preserves TClaimRef exactly.
  claim: premise,
  context,
  premises: [premise],
};
const wrongContextSlot: InferenceFixture = {
  claim,
  // @ts-expect-error The context slot preserves TContextRef exactly.
  context: claim,
  premises: [premise],
};
const wrongPremiseSlot: InferenceFixture = {
  claim,
  context,
  // @ts-expect-error Every premise slot preserves TPremise exactly.
  premises: [claim],
};
const wrongLaterPremiseSlot: InferenceFixture = {
  claim,
  context,
  // @ts-expect-error The variadic premise tail cannot widen to unknown.
  premises: [premise, claim],
};

void inferenceShapeContract;
void inferenceAcceptsOpaqueValues;
void inferenceAcceptsNullableValues;
void inferenceOwnsNoForbiddenFields;
void singlePremise;
void multiplePremises;
void callerOwnedPremiseUnion;
void premiseWithCallerOwnedMetadata;
void modelOutputPremise;
void emptyPremises;
void missingClaim;
void missingContext;
void missingPremises;
void wrongClaimSlot;
void wrongContextSlot;
void wrongPremiseSlot;
void wrongLaterPremiseSlot;
