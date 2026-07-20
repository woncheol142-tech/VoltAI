import type {
  ConstructionGraphEdge,
  DrawingElectricalObjectDocument,
  ElectricalObject,
} from "../drawingElectricalObjects/types.js";
import type {
  ElectricalRelationshipDocument,
  ElectricalRelationshipJsonValue,
  ElectricalRelationshipType,
} from "../drawingElectricalRelationships/types.js";

export type RelationshipEvidenceIndex = {
  readonly objectIds: readonly string[];
  readonly graphEdgeIds: readonly string[];
  readonly evidenceIds: readonly string[];
  objectById: ReadonlyMap<string, ElectricalObject>;
  graphEdgeById: ReadonlyMap<string, ConstructionGraphEdge>;
  evidenceByObjectId: ReadonlyMap<string, readonly string[]>;
  graphEdgesByObjectId: ReadonlyMap<string, readonly ConstructionGraphEdge[]>;
};

export type RelationshipInferenceContext = {
  document: DrawingElectricalObjectDocument;
  evidenceIndex: RelationshipEvidenceIndex;
};

export type RelationshipConfidenceComponents = {
  endpoint: number;
  ruleMatch: number;
  evidence: number;
  consistency: number;
};

export type RelationshipCandidate = {
  candidateId: string;
  ruleId: string;
  priority: number;
  sourceObjectId: string;
  targetObjectId: string;
  relationshipType: ElectricalRelationshipType;
  hardGatePassed: boolean;
  spatialSpecificity: number;
  confidenceComponents: RelationshipConfidenceComponents;
  rawConfidence: number;
  confidence: number;
  evidenceIds: string[];
  attributes: Record<string, ElectricalRelationshipJsonValue>;
  diagnostics: Record<string, ElectricalRelationshipJsonValue>;
};

export type RelationshipRuleOutput = readonly unknown[];

export type RelationshipRule = {
  readonly id: string;
  readonly relationshipType: ElectricalRelationshipType;
  readonly priority: number;
  generate(context: RelationshipInferenceContext): RelationshipRuleOutput;
};

export type RelationshipCandidateConflict = {
  winnerId: string | null;
  loserId: string;
  reason: string;
};

export type RelationshipResolutionResult = {
  selectedCandidates: RelationshipCandidate[];
  excludedCandidates: RelationshipCandidate[];
  conflicts: RelationshipCandidateConflict[];
  warnings: string[];
};

export type RelationshipInferenceOptions = {
  rules?: readonly RelationshipRule[];
};

export type RelationshipInferenceResult = ElectricalRelationshipDocument;
