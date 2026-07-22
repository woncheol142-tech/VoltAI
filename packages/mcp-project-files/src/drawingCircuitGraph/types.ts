import type { PageBBox } from "../drawingLayout/types.js";

export type CircuitJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CircuitJsonValue[]
  | CircuitJsonObject;

export type CircuitJsonObject = {
  readonly [key: string]: CircuitJsonValue;
};

export enum CircuitNodeType {
  LIGHTING = "LIGHTING",
  OUTLET = "OUTLET",
  PANEL = "PANEL",
  BREAKER = "BREAKER",
  TRANSFORMER = "TRANSFORMER",
  GROUND = "GROUND",
  CABLE = "CABLE",
  CONDUIT = "CONDUIT",
  EQUIPMENT = "EQUIPMENT",
  ANNOTATION = "ANNOTATION",
  UNKNOWN_OBJECT = "UNKNOWN_OBJECT",
  INTERMEDIATE = "INTERMEDIATE",
}

export enum CircuitEdgeType {
  CONNECTED = "CONNECTED",
  CONTAINS = "CONTAINS",
  REFERENCE = "REFERENCE",
  CONTROL = "CONTROL",
  POWER = "POWER",
  SIGNAL = "SIGNAL",
  GROUND = "GROUND",
}

export type CircuitEdgeDirection = "FORWARD" | "UNDIRECTED";

export enum CircuitBoundaryType {
  PAGE = "PAGE",
  DOCUMENT = "DOCUMENT",
  EXTERNAL = "EXTERNAL",
}

export enum CircuitBoundaryRole {
  INCOMING = "INCOMING",
  OUTGOING = "OUTGOING",
  BIDIRECTIONAL = "BIDIRECTIONAL",
}

export enum CircuitGraphWarningCode {
  DISCONNECTED_GRAPH = "DISCONNECTED_GRAPH",
  REFERENCE_CYCLE = "REFERENCE_CYCLE",
  UNRESOLVED_BOUNDARY = "UNRESOLVED_BOUNDARY",
}

export type CircuitNodeMetadata = {
  readonly role: string;
  readonly details: CircuitJsonObject;
};

export type CircuitEdgeMetadata = {
  readonly segmentRole: string;
  readonly evidenceIds: readonly string[];
  readonly details: CircuitJsonObject;
};

export type CircuitComponentMetadata = {
  readonly details: CircuitJsonObject;
};

export type CircuitBoundaryMetadata = {
  readonly details: CircuitJsonObject;
};

export type CircuitNode = {
  readonly nodeId: string;
  readonly objectIds: readonly string[];
  readonly nodeType: CircuitNodeType;
  readonly displayName: string | null;
  readonly location: Readonly<PageBBox> | null;
  readonly attributes: CircuitJsonObject;
  readonly metadata: CircuitNodeMetadata;
};

export type CircuitEdge = {
  readonly edgeId: string;
  readonly relationshipId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly edgeType: CircuitEdgeType;
  readonly direction: CircuitEdgeDirection;
  readonly confidence: number;
  readonly attributes: CircuitJsonObject;
  readonly metadata: CircuitEdgeMetadata;
};

export type CircuitComponent = {
  readonly componentId: string;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly metadata: CircuitComponentMetadata;
};

export type CircuitBoundary = {
  readonly boundaryId: string;
  readonly nodeId: string;
  readonly externalReferenceId: string;
  readonly boundaryType: CircuitBoundaryType;
  readonly boundaryRole: CircuitBoundaryRole;
  readonly metadata: CircuitBoundaryMetadata;
};

export type CircuitGraphStatistics = {
  readonly nodeTypeCounts: Readonly<Record<CircuitNodeType, number>>;
  readonly edgeTypeCounts: Readonly<Record<CircuitEdgeType, number>>;
  readonly isolatedNodeCount: number;
  readonly connectedComponentCount: number;
};

export type CircuitGraphWarning = {
  readonly code: CircuitGraphWarningCode;
  readonly message: string;
  readonly relatedIds: readonly string[];
  readonly metadata: CircuitJsonObject;
};

export type CircuitMetadata = {
  readonly projectionProfile: string;
  readonly projectionProfileVersion: number;
  readonly objectDocumentSchemaVersion: number;
  readonly relationshipDocumentSchemaVersion: number;
};

export type CircuitGraphDocument = {
  readonly schemaVersion: 1;
  readonly graphId: string;
  readonly source: string;
  readonly sourceSha256: string;
  readonly page: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly componentCount: number;
  readonly boundaryCount: number;
  readonly nodes: readonly CircuitNode[];
  readonly edges: readonly CircuitEdge[];
  readonly components: readonly CircuitComponent[];
  readonly boundaries: readonly CircuitBoundary[];
  readonly statistics: CircuitGraphStatistics;
  readonly warnings: readonly CircuitGraphWarning[];
  readonly metadata: CircuitMetadata;
};
