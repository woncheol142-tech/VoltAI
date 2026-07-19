import type { DrawingPrimitiveClassificationDocument } from "../drawingClassification/types.js";
import type {
  DrawingLayoutDocument,
  PageBBox,
} from "../drawingLayout/types.js";
import type { DrawingPrimitiveDocument } from "../drawingPrimitive/types.js";
import type { DrawingSpatialRelationDocument } from "../drawingSpatial/types.js";

export type ElectricalObjectType =
  | "lighting"
  | "outlet"
  | "panel"
  | "breaker"
  | "transformer"
  | "ground"
  | "cable"
  | "conduit"
  | "equipment"
  | "annotation"
  | "unknown";

export type ElectricalObjectStatus = "accepted" | "review";

export type ElectricalAttribute<T> = {
  value: T;
  rawText: string;
  confidence: number;
  textEntityIds: string[];
  sourceRelationIds: string[];
  parserRuleId: string;
};

export type ElectricalObjectLabel = {
  textEntityType: "item" | "line";
  textEntityId: string;
  role: string;
};

export type ElectricalConfidenceComponents = {
  structural: number;
  label: number;
  spatial: number;
  attribute: number;
  consistency: number;
};

export type ElectricalObjectDiagnostics = {
  ruleId: string;
  confidenceComponents: ElectricalConfidenceComponents;
  conflicts: Array<Record<string, unknown>>;
};

export type CommonElectricalAttributes = {
  name: ElectricalAttribute<string> | null;
  tag: ElectricalAttribute<string> | null;
  phase: ElectricalAttribute<string> | null;
  capacity: ElectricalAttribute<string> | null;
  circuit: ElectricalAttribute<string> | null;
  voltage: ElectricalAttribute<string> | null;
  remarks: ElectricalAttribute<string> | null;
};

export type BreakerElectricalAttributes = CommonElectricalAttributes & {
  rating: ElectricalAttribute<string> | null;
  breakerKind: ElectricalAttribute<string>;
  poles: ElectricalAttribute<string> | null;
  frameAmpere: ElectricalAttribute<string> | null;
  tripAmpere: ElectricalAttribute<string> | null;
};

export type PanelElectricalAttributes = CommonElectricalAttributes & {
  rating: ElectricalAttribute<string> | null;
};

export type TransformerElectricalAttributes = CommonElectricalAttributes & {
  rating: ElectricalAttribute<string> | null;
};

export type CableElectricalAttributes = CommonElectricalAttributes & {
  rating: ElectricalAttribute<string> | null;
};

export type UnknownElectricalAttributes = Pick<
  CommonElectricalAttributes,
  "name" | "tag" | "remarks"
>;

type ElectricalObjectBase<
  TType extends ElectricalObjectType,
  TAttributes,
> = {
  id: string;
  type: TType;
  status: ElectricalObjectStatus;
  bbox: PageBBox;
  primitiveIds: string[];
  labels: ElectricalObjectLabel[];
  attributes: TAttributes;
  confidence: number;
  sourceRelationIds: string[];
  diagnostics: ElectricalObjectDiagnostics;
};

export type BreakerElectricalObject = ElectricalObjectBase<
  "breaker",
  BreakerElectricalAttributes
>;
export type PanelElectricalObject = ElectricalObjectBase<
  "panel",
  PanelElectricalAttributes
>;
export type TransformerElectricalObject = ElectricalObjectBase<
  "transformer",
  TransformerElectricalAttributes
>;
export type CableElectricalObject = ElectricalObjectBase<
  "cable",
  CableElectricalAttributes
>;
export type UnknownElectricalObject = ElectricalObjectBase<
  "unknown",
  UnknownElectricalAttributes
>;

type CommonTypedElectricalObject<TType extends Exclude<
  ElectricalObjectType,
  "breaker" | "panel" | "transformer" | "cable" | "unknown"
>> = ElectricalObjectBase<TType, CommonElectricalAttributes>;

export type LightingElectricalObject = CommonTypedElectricalObject<"lighting">;
export type OutletElectricalObject = CommonTypedElectricalObject<"outlet">;
export type GroundElectricalObject = CommonTypedElectricalObject<"ground">;
export type ConduitElectricalObject = CommonTypedElectricalObject<"conduit">;
export type EquipmentElectricalObject = CommonTypedElectricalObject<"equipment">;
export type AnnotationElectricalObject = CommonTypedElectricalObject<"annotation">;

export type ElectricalObject =
  | LightingElectricalObject
  | OutletElectricalObject
  | PanelElectricalObject
  | BreakerElectricalObject
  | TransformerElectricalObject
  | GroundElectricalObject
  | CableElectricalObject
  | ConduitElectricalObject
  | EquipmentElectricalObject
  | AnnotationElectricalObject
  | UnknownElectricalObject;

export type BuildElectricalObjectsInput = {
  layout: DrawingLayoutDocument;
  primitive: DrawingPrimitiveDocument;
  classification: DrawingPrimitiveClassificationDocument;
  spatial: DrawingSpatialRelationDocument;
};

export type ElectricalConstructionContext = BuildElectricalObjectsInput;

export type ElectricalObjectCandidate = {
  id: string;
  ruleId: string;
  type: ElectricalObjectType;
  priority: number;
  primaryPrimitiveIds: string[];
  supportingPrimitiveIds: string[];
  contextPrimitiveIds: string[];
  labelIds: string[];
  sourceRelationIds: string[];
  attributes: Record<string, unknown>;
  structuralScore: number;
  labelScore: number;
  spatialScore: number;
  attributeScore: number;
  consistencyScore: number;
  confidence: number;
  hardGatePassed: boolean;
  spatialSpecificity: string;
  exactLexicalMatch: boolean;
  primaryPrimitiveSourceOrder: number;
  shareSupportingPrimitives: boolean;
  diagnostics: Record<string, unknown>;
};

export type ElectricalObjectRule<
  TCandidate extends ElectricalObjectCandidate = ElectricalObjectCandidate,
> = {
  readonly id: string;
  readonly type: ElectricalObjectType;
  readonly priority: number;
  generate(context: ElectricalConstructionContext): readonly TCandidate[];
};

export type CandidateConflict = {
  winnerId: string;
  loserId: string;
  reason: string;
};

export type CandidateResolution = {
  acceptedCandidates: ElectricalObjectCandidate[];
  reviewCandidates: ElectricalObjectCandidate[];
  excludedCandidates: ElectricalObjectCandidate[];
  conflicts: CandidateConflict[];
};

export type ConstructionGraphEdgeType =
  | "bbox-touch"
  | "endpoint-contact"
  | "shared-primitive"
  | "spatial-adjacent";

export type ConstructionGraphEdge = {
  id: string;
  type: ConstructionGraphEdgeType;
  objectIds: [string, string];
  primitiveIds: string[];
  sourceRelationIds: string[];
};

export type ConstructionGraphComponent = {
  id: string;
  objectIds: string[];
  edgeIds: string[];
};

export type ConstructionGraph = {
  objectIds: string[];
  edges: ConstructionGraphEdge[];
  components: ConstructionGraphComponent[];
};

export type ElectricalObjectStatistics = {
  candidateCount: number;
  acceptedObjectCount: number;
  reviewObjectCount: number;
  excludedCandidateCount: number;
  conflictCount: number;
  objectCountByType: Record<ElectricalObjectType, number>;
  warningCount: number;
};

export type DrawingElectricalObjectDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  page: number;
  pageWidth: number;
  pageHeight: number;
  objectCount: number;
  objects: ElectricalObject[];
  constructionGraph: ConstructionGraph;
  statistics: ElectricalObjectStatistics;
  warnings: string[];
};
