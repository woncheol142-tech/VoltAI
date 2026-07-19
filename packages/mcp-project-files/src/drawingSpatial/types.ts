import type { PrimitiveClassificationKind } from "../drawingClassification/types.js";

export type SpatialTopology =
  | "contains"
  | "inside"
  | "overlaps"
  | "touches"
  | "disjoint";

export type SpatialRelationType =
  | "contains"
  | "inside"
  | "intersects"
  | "touches"
  | "overlaps"
  | "nearest"
  | "aligned"
  | "adjacent";

export type SpatialTextEntityType = "item" | "line";

export type SpatialRelationGeometry = {
  basis: "page-bbox";
  topology: SpatialTopology;
  horizontalGapPt: number;
  verticalGapPt: number;
  centerDeltaXPt: number;
  centerDeltaYPt: number;
  intersectionAreaPt2: number;
};

export type SpatialRelation = {
  id: string;
  textEntityType: SpatialTextEntityType;
  textEntityId: string;
  primitiveId: string;
  primitiveKind: PrimitiveClassificationKind;
  primitiveSourceOrder: number;
  relationTypes: SpatialRelationType[];
  distancePt: number;
  rank: number | null;
  geometry: SpatialRelationGeometry;
};

export type SpatialRelationPolicy = {
  geometryBasis: "page-bbox";
  cellSizePt: 8;
  touchEpsilonPt: 0.01;
  adjacentDistancePt: 2;
  nearestRadiusPt: 8;
  alignmentTolerancePt: 1;
  maxProximityPerTextEntity: 8;
};

export type SpatialTopologyStatistics = {
  contains: number;
  inside: number;
  overlaps: number;
  touches: number;
  disjoint: number;
};

export type SpatialRelationTypeStatistics = {
  contains: number;
  inside: number;
  intersects: number;
  touches: number;
  overlaps: number;
  nearest: number;
  aligned: number;
  adjacent: number;
};

export type SpatialRelationStatistics = {
  textEntityCount: number;
  candidatePairCount: number;
  relationCount: number;
  topology: SpatialTopologyStatistics;
  relationTypes: SpatialRelationTypeStatistics;
  proximityTruncatedEntityCount: number;
  gridBucketCount: number;
  gridReferenceCount: number;
  overflowPrimitiveCount: number;
};

export type DrawingSpatialRelationDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  page: number;
  pageWidth: number;
  pageHeight: number;
  textItemCount: number;
  textLineCount: number;
  primitiveCount: number;
  relationCount: number;
  policy: SpatialRelationPolicy;
  statistics: SpatialRelationStatistics;
  relations: SpatialRelation[];
  warnings: string[];
};

