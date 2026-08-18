import type { Evidence, Requirement } from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type Content = {
  readonly contentMarker: "content";
};
type Origin = {
  readonly originMarker: "origin";
};
type RequirementId = {
  readonly requirementMarker: "requirement-id";
};
type Statement = {
  readonly statementMarker: "statement";
};

type EvidenceFixture = Evidence<Content, Origin>;
type RequirementFixture = Requirement<RequirementId, Statement>;

const evidenceShape: Assert<
  Equal<
    EvidenceFixture,
    {
      readonly content: Content;
      readonly origin: Origin;
    }
  >
> = true;
const requirementShape: Assert<
  Equal<
    RequirementFixture,
    {
      readonly id: RequirementId;
      readonly statement: Statement;
    }
  >
> = true;

const evidenceContentLinkage: Assert<
  Equal<EvidenceFixture["content"], Content>
> = true;
const evidenceOriginLinkage: Assert<Equal<EvidenceFixture["origin"], Origin>> =
  true;
const requirementIdLinkage: Assert<
  Equal<RequirementFixture["id"], RequirementId>
> = true;
const requirementStatementLinkage: Assert<
  Equal<RequirementFixture["statement"], Statement>
> = true;

// @ts-expect-error Both Evidence generic arguments must be explicit.
type MissingEvidenceArguments = Evidence;
type MissingEvidenceOrigin =
  // @ts-expect-error The Evidence origin generic argument must be explicit.
  Evidence<Content>;
type ExtraEvidenceArgument =
  // @ts-expect-error Evidence has exactly two generic arguments.
  Evidence<Content, Origin, string>;

// @ts-expect-error Both Requirement generic arguments must be explicit.
type MissingRequirementArguments = Requirement;
type MissingRequirementStatement =
  // @ts-expect-error The Requirement statement generic argument must be explicit.
  Requirement<RequirementId>;
type ExtraRequirementArgument =
  // @ts-expect-error Requirement has exactly two generic arguments.
  Requirement<RequirementId, Statement, string>;

type NullEvidenceContent =
  // @ts-expect-error Evidence content rejects bare null.
  Evidence<null, Origin>;
type UndefinedEvidenceContent =
  // @ts-expect-error Evidence content rejects bare undefined.
  Evidence<undefined, Origin>;
type NullEvidenceOrigin =
  // @ts-expect-error Evidence origin rejects bare null.
  Evidence<Content, null>;
type UndefinedEvidenceOrigin =
  // @ts-expect-error Evidence origin rejects bare undefined.
  Evidence<Content, undefined>;

type NullRequirementId =
  // @ts-expect-error Requirement identity rejects bare null.
  Requirement<null, Statement>;
type UndefinedRequirementId =
  // @ts-expect-error Requirement identity rejects bare undefined.
  Requirement<undefined, Statement>;
type NullRequirementStatement =
  // @ts-expect-error Requirement statement rejects bare null.
  Requirement<RequirementId, null>;
type UndefinedRequirementStatement =
  // @ts-expect-error Requirement statement rejects bare undefined.
  Requirement<RequirementId, undefined>;

const textualEvidence: Evidence<string, { readonly sourcePath: string }> = {
  content: "section 3.2 requires clearance",
  origin: { sourcePath: "standards/example.pdf" },
};
const calculationEvidence: Evidence<
  { readonly voltageDropPercent: number },
  { readonly calculationId: string }
> = {
  content: { voltageDropPercent: 2.8 },
  origin: { calculationId: "calculation-17" },
};
const drawingEvidence: Evidence<
  { readonly conduitDiameterMm: number },
  { readonly drawingNo: string; readonly entityHandle: string }
> = {
  content: { conduitDiameterMm: 32 },
  origin: { drawingNo: "E-101", entityHandle: "2AF" },
};
const observationEvidence: Evidence<
  string,
  { readonly observerId: string; readonly observedAt: string }
> = {
  content: "clearance observed",
  origin: {
    observerId: "observer-4",
    observedAt: "2026-08-18T09:00:00+09:00",
  },
};

const textualRequirement: Requirement<
  { readonly namespace: "kec"; readonly key: string },
  string
> = {
  id: { namespace: "kec", key: "clearance-1" },
  statement: "Maintain the required clearance.",
};
const structuredRequirement: Requirement<
  { readonly namespace: "project"; readonly key: string },
  { readonly minClearanceMm: number }
> = {
  id: { namespace: "project", key: "clearance-2" },
  statement: { minClearanceMm: 300 },
};

type MutableContent = {
  values: string[];
};
type MutableStatement = {
  clauses: string[];
};

const evidenceDoesNotDeepReadonly: Assert<
  Equal<Evidence<MutableContent, Origin>["content"], MutableContent>
> = true;
const requirementDoesNotDeepReadonly: Assert<
  Equal<
    Requirement<RequirementId, MutableStatement>["statement"],
    MutableStatement
  >
> = true;

const mutablePayloadEvidence: Evidence<MutableContent, Origin> = {
  content: { values: ["initial"] },
  origin: { originMarker: "origin" },
};
mutablePayloadEvidence.content.values.push("caller mutation remains valid");
// @ts-expect-error Evidence content is readonly.
mutablePayloadEvidence.content = { values: ["replacement"] };
// @ts-expect-error Evidence origin is readonly.
mutablePayloadEvidence.origin = { originMarker: "origin" };

const mutablePayloadRequirement: Requirement<RequirementId, MutableStatement> =
  {
    id: { requirementMarker: "requirement-id" },
    statement: { clauses: ["initial"] },
  };
mutablePayloadRequirement.statement.clauses.push(
  "caller mutation remains valid",
);
// @ts-expect-error Requirement id is readonly.
mutablePayloadRequirement.id = { requirementMarker: "requirement-id" };
// @ts-expect-error Requirement statement is readonly.
mutablePayloadRequirement.statement = { clauses: ["replacement"] };

declare const evidence: Evidence<string, Origin>;
declare const requirement: Requirement<RequirementId, string>;

// @ts-expect-error Evidence is not a Requirement.
const evidenceAsRequirement: Requirement<RequirementId, string> = evidence;
// @ts-expect-error Requirement is not Evidence.
const requirementAsEvidence: Evidence<string, Origin> = requirement;

void evidenceShape;
void requirementShape;
void evidenceContentLinkage;
void evidenceOriginLinkage;
void requirementIdLinkage;
void requirementStatementLinkage;
void (null as MissingEvidenceArguments | null);
void (null as MissingEvidenceOrigin | null);
void (null as ExtraEvidenceArgument | null);
void (null as MissingRequirementArguments | null);
void (null as MissingRequirementStatement | null);
void (null as ExtraRequirementArgument | null);
void (null as NullEvidenceContent | null);
void (null as UndefinedEvidenceContent | null);
void (null as NullEvidenceOrigin | null);
void (null as UndefinedEvidenceOrigin | null);
void (null as NullRequirementId | null);
void (null as UndefinedRequirementId | null);
void (null as NullRequirementStatement | null);
void (null as UndefinedRequirementStatement | null);
void textualEvidence;
void calculationEvidence;
void drawingEvidence;
void observationEvidence;
void textualRequirement;
void structuredRequirement;
void evidenceDoesNotDeepReadonly;
void requirementDoesNotDeepReadonly;
void mutablePayloadEvidence;
void mutablePayloadRequirement;
void evidenceAsRequirement;
void requirementAsEvidence;
