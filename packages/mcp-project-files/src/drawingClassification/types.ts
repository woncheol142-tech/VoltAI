import type {
  NormalizedBBox,
  PageBBox,
} from "../drawingPrimitive/types.js";

export type PrimitiveClassificationKind =
  | "zeroLength"
  | "tiny"
  | "compoundPath"
  | "curve"
  | "rectangleCandidate"
  | "closedPolygon"
  | "polyline"
  | "line"
  | "unknown";

export type PrimitiveClassificationDiagnostics = {
  commandCount: number;
  subpathCount: number;
  closedSubpathCount: number;
  lineSegmentCount: number;
  curveSegmentCount: number;
  meaningfulEdgeCount: number;
  duplicateGroupId: string | null;
  duplicateCount: number;
};

export type PrimitiveClassificationGeometry = {
  bbox: NormalizedBBox;
  pageBBox: PageBBox;
};

export type PrimitiveClassification = {
  primitiveId: string;
  kind: PrimitiveClassificationKind;
  confidence: number;
  diagnostics: PrimitiveClassificationDiagnostics;
  geometry: PrimitiveClassificationGeometry;
};

export type PrimitiveClassificationStatistics = {
  zeroLength: number;
  tiny: number;
  compoundPath: number;
  curve: number;
  rectangleCandidate: number;
  closedPolygon: number;
  polyline: number;
  line: number;
  unknown: number;
  duplicateGroupCount: number;
  duplicateMemberCount: number;
};

export type DrawingPrimitiveClassificationDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  page: number;
  primitiveCount: number;
  classificationCount: number;
  statistics: PrimitiveClassificationStatistics;
  classifications: PrimitiveClassification[];
  warnings: string[];
};
