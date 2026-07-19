import { createHash } from "node:crypto";

import type {
  DrawingLayoutDocument,
  DrawingTextItem,
  DrawingTextLine,
  PageBBox as TextPageBBox,
} from "../drawingLayout/types.js";
import type {
  DrawingPrimitiveClassificationDocument,
  PrimitiveClassification,
} from "../drawingClassification/types.js";
import type {
  DrawingPaintedPath,
  DrawingPrimitiveDocument,
  PageBBox,
} from "../drawingPrimitive/types.js";
import {
  analyzeSpatialGeometry,
  isBeyondSpatialDistance,
  SpatialGeometryUnrepresentableError,
} from "./geometry.js";
import { createSpatialHashGrid } from "./spatialHashGrid.js";
import type {
  DrawingSpatialRelationDocument,
  SpatialRelation,
  SpatialRelationGeometry,
  SpatialRelationPolicy,
  SpatialRelationStatistics,
  SpatialRelationType,
  SpatialTextEntityType,
  SpatialTopology,
} from "./types.js";

const POLICY: SpatialRelationPolicy = {
  geometryBasis: "page-bbox",
  cellSizePt: 8,
  touchEpsilonPt: 0.01,
  adjacentDistancePt: 2,
  nearestRadiusPt: 8,
  alignmentTolerancePt: 1,
  maxProximityPerTextEntity: 8,
};

const TOPOLOGY_PRIORITY: Record<SpatialTopology, number> = {
  contains: 0,
  inside: 1,
  overlaps: 2,
  touches: 3,
  disjoint: 4,
};

type BuildDrawingSpatialRelationsInput = {
  layout: DrawingLayoutDocument;
  primitive: DrawingPrimitiveDocument;
  classification: DrawingPrimitiveClassificationDocument;
};

type CanonicalTextEntity = {
  type: SpatialTextEntityType;
  id: string;
  pageBBox: TextPageBBox;
  order: number;
};

type RelationCandidate = {
  primitive: DrawingPaintedPath;
  classification: PrimitiveClassification;
  relationTypes: SpatialRelationType[];
  distancePt: number;
  rawDistancePt: number;
  rawCenterDeltaXPt: number;
  rawCenterDeltaYPt: number;
  rank: number | null;
  geometry: SpatialRelationGeometry;
};

function codepointCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertBBox(
  bbox: PageBBox | TextPageBBox,
  label: string,
): void {
  for (const [field, value] of Object.entries(bbox)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Drawing spatial ${label} bbox.${field} must be finite`);
    }
  }
  if (bbox.width < 0 || bbox.height < 0) {
    throw new Error(
      `Drawing spatial ${label} bbox dimensions must be non-negative`,
    );
  }
}

function assertDocumentIdentity(
  layout: DrawingLayoutDocument,
  primitive: DrawingPrimitiveDocument,
  classification: DrawingPrimitiveClassificationDocument,
): void {
  for (const [field, left, middle, right] of [
    ["source", layout.source, primitive.source, classification.source],
    [
      "source SHA",
      layout.sourceSha256,
      primitive.sourceSha256,
      classification.sourceSha256,
    ],
    ["page", layout.page, primitive.page, classification.page],
  ] as const) {
    if (left !== middle || left !== right) {
      throw new Error(`Drawing spatial ${field} mismatch across input documents`);
    }
  }
  for (const [label, value] of [
    ["layout pageWidth", layout.pageWidth],
    ["layout pageHeight", layout.pageHeight],
    ["primitive pageWidth", primitive.pageWidth],
    ["primitive pageHeight", primitive.pageHeight],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Drawing spatial ${label} dimension must be finite and positive`);
    }
  }
  if (
    layout.pageWidth !== primitive.pageWidth ||
    layout.pageHeight !== primitive.pageHeight
  ) {
    throw new Error("Drawing spatial page dimension mismatch across input documents");
  }
}

function validateLayout(layout: DrawingLayoutDocument): {
  items: DrawingTextItem[];
  lines: DrawingTextLine[];
  itemById: Map<string, DrawingTextItem>;
} {
  if (layout.itemCount !== layout.items.length) {
    throw new Error("Drawing spatial layout item count is corrupt");
  }
  if (layout.lineCount !== layout.lines.length) {
    throw new Error("Drawing spatial layout line count is corrupt");
  }
  const itemById = new Map<string, DrawingTextItem>();
  const itemSourceOrders = new Set<number>();
  for (const item of layout.items) {
    if (itemById.has(item.id)) {
      throw new Error(`Drawing spatial item ID is duplicated: ${item.id}`);
    }
    if (!Number.isInteger(item.sourceOrder) || item.sourceOrder < 0) {
      throw new Error("Drawing spatial item sourceOrder must be non-negative");
    }
    if (itemSourceOrders.has(item.sourceOrder)) {
      throw new Error(
        `Drawing spatial item sourceOrder is duplicated: ${item.sourceOrder}`,
      );
    }
    itemById.set(item.id, item);
    itemSourceOrders.add(item.sourceOrder);
    assertBBox(item.bbox, `item ${item.id}`);
    assertBBox(item.pageBBox, `item ${item.id} page`);
  }

  const lineIds = new Set<string>();
  for (const line of layout.lines) {
    if (lineIds.has(line.id)) {
      throw new Error(`Drawing spatial line ID is duplicated: ${line.id}`);
    }
    lineIds.add(line.id);
    assertBBox(line.bbox, `line ${line.id}`);
    assertBBox(line.pageBBox, `line ${line.id} page`);
    for (const itemId of line.itemIds) {
      if (!itemById.has(itemId)) {
        throw new Error(
          `Drawing spatial line item reference does not exist: ${itemId}`,
        );
      }
    }
  }

  return {
    items: [...layout.items].sort(
      (left, right) =>
        left.sourceOrder - right.sourceOrder ||
        codepointCompare(left.id, right.id),
    ),
    lines: [...layout.lines],
    itemById,
  };
}

function validatePrimitives(
  primitiveDocument: DrawingPrimitiveDocument,
): DrawingPaintedPath[] {
  if (primitiveDocument.primitiveCount !== primitiveDocument.primitives.length) {
    throw new Error("Drawing spatial primitive count is corrupt");
  }
  const ids = new Set<string>();
  const sourceOrders = new Set<number>();
  for (const primitive of primitiveDocument.primitives) {
    if (ids.has(primitive.id)) {
      throw new Error(`Drawing spatial primitive ID is duplicated: ${primitive.id}`);
    }
    ids.add(primitive.id);
    if (!Number.isInteger(primitive.sourceOrder) || primitive.sourceOrder < 0) {
      throw new Error("Drawing spatial primitive sourceOrder must be non-negative");
    }
    if (sourceOrders.has(primitive.sourceOrder)) {
      throw new Error(
        `Drawing spatial primitive sourceOrder is duplicated: ${primitive.sourceOrder}`,
      );
    }
    sourceOrders.add(primitive.sourceOrder);
    assertBBox(primitive.bbox, `primitive ${primitive.id}`);
    assertBBox(primitive.pageBBox, `primitive ${primitive.id} page`);
  }
  const ordered = [...primitiveDocument.primitives].sort(
    (left, right) =>
      left.sourceOrder - right.sourceOrder || codepointCompare(left.id, right.id),
  );
  for (const [expected, primitive] of ordered.entries()) {
    if (primitive.sourceOrder !== expected) {
      throw new Error(
        `Drawing spatial primitive sourceOrder is not contiguous: expected ${expected}, received ${primitive.sourceOrder}`,
      );
    }
  }
  return ordered;
}

function validateClassifications(
  document: DrawingPrimitiveClassificationDocument,
  primitives: readonly DrawingPaintedPath[],
): Map<string, PrimitiveClassification> {
  if (document.primitiveCount !== primitives.length) {
    throw new Error("Drawing spatial classification primitive count mismatch");
  }
  if (document.classificationCount !== document.classifications.length) {
    throw new Error("Drawing spatial classification count is corrupt");
  }
  const primitiveIds = new Set(primitives.map(({ id }) => id));
  const byId = new Map<string, PrimitiveClassification>();
  for (const classification of document.classifications) {
    if (byId.has(classification.primitiveId)) {
      throw new Error(
        `Drawing spatial classification primitive ID is duplicated: ${classification.primitiveId}`,
      );
    }
    if (!primitiveIds.has(classification.primitiveId)) {
      throw new Error(
        `Drawing spatial classification primitive ID mismatch: ${classification.primitiveId}`,
      );
    }
    assertBBox(
      classification.geometry.bbox,
      `classification ${classification.primitiveId}`,
    );
    assertBBox(
      classification.geometry.pageBBox,
      `classification ${classification.primitiveId} page`,
    );
    byId.set(classification.primitiveId, classification);
  }
  if (byId.size !== primitives.length) {
    throw new Error("Drawing spatial classification is missing primitive IDs");
  }
  return byId;
}

function canonicalEntities(
  items: readonly DrawingTextItem[],
  lines: readonly DrawingTextLine[],
  itemById: ReadonlyMap<string, DrawingTextItem>,
): CanonicalTextEntity[] {
  const itemEntities = items.map((item) => ({
    type: "item" as const,
    id: item.id,
    pageBBox: item.pageBBox,
    order: item.sourceOrder,
  }));
  const lineEntities = lines.map((line) => ({
    type: "line" as const,
    id: line.id,
    pageBBox: line.pageBBox,
    order: line.itemIds.reduce(
      (minimum, itemId) =>
        Math.min(minimum, itemById.get(itemId)?.sourceOrder ?? Infinity),
      Infinity,
    ),
  })).sort(
    (left, right) =>
      left.order - right.order || codepointCompare(left.id, right.id),
  );
  return [...itemEntities, ...lineEntities];
}

function spatialGeometry(
  analysis: ReturnType<typeof analyzeSpatialGeometry>,
): SpatialRelationGeometry {
  return {
    basis: analysis.basis,
    topology: analysis.topology,
    horizontalGapPt: analysis.horizontalGapPt,
    verticalGapPt: analysis.verticalGapPt,
    centerDeltaXPt: analysis.centerDeltaXPt,
    centerDeltaYPt: analysis.centerDeltaYPt,
    intersectionAreaPt2: analysis.intersectionAreaPt2,
  };
}

function relationId(
  sourceSha256: string,
  page: number,
  entity: CanonicalTextEntity,
  primitiveId: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        sourceSha256,
        page,
        entity.type,
        entity.id,
        primitiveId,
      ]),
      "utf8",
    )
    .digest("hex")
    .slice(0, 24);
}

function createRelation(
  sourceSha256: string,
  page: number,
  entity: CanonicalTextEntity,
  candidate: RelationCandidate,
): SpatialRelation {
  return {
    id: relationId(sourceSha256, page, entity, candidate.primitive.id),
    textEntityType: entity.type,
    textEntityId: entity.id,
    primitiveId: candidate.primitive.id,
    primitiveKind: candidate.classification.kind,
    primitiveSourceOrder: candidate.primitive.sourceOrder,
    relationTypes: [...candidate.relationTypes],
    distancePt: candidate.distancePt,
    rank: candidate.rank,
    geometry: { ...candidate.geometry },
  };
}

function relationStatistics(
  textEntityCount: number,
  candidatePairCount: number,
  relations: readonly SpatialRelation[],
  truncatedCount: number,
  grid: ReturnType<typeof createSpatialHashGrid>["diagnostics"],
): SpatialRelationStatistics {
  const statistics: SpatialRelationStatistics = {
    textEntityCount,
    candidatePairCount,
    relationCount: relations.length,
    topology: {
      contains: 0,
      inside: 0,
      overlaps: 0,
      touches: 0,
      disjoint: 0,
    },
    relationTypes: {
      contains: 0,
      inside: 0,
      intersects: 0,
      touches: 0,
      overlaps: 0,
      nearest: 0,
      aligned: 0,
      adjacent: 0,
    },
    proximityTruncatedEntityCount: truncatedCount,
    gridBucketCount: grid.gridBucketCount,
    gridReferenceCount: grid.gridReferenceCount,
    overflowPrimitiveCount: grid.overflowPrimitiveCount,
  };
  for (const relation of relations) {
    statistics.topology[relation.geometry.topology] += 1;
    for (const relationType of relation.relationTypes) {
      statistics.relationTypes[relationType] += 1;
    }
  }
  return statistics;
}

export function buildDrawingSpatialRelations({
  layout,
  primitive,
  classification,
}: BuildDrawingSpatialRelationsInput): DrawingSpatialRelationDocument {
  assertDocumentIdentity(layout, primitive, classification);
  const validatedLayout = validateLayout(layout);
  const primitives = validatePrimitives(primitive);
  const classificationById = validateClassifications(classification, primitives);
  const entities = canonicalEntities(
    validatedLayout.items,
    validatedLayout.lines,
    validatedLayout.itemById,
  );
  const grid = createSpatialHashGrid(primitives);
  const relations: SpatialRelation[] = [];
  const relationIds = new Set<string>();
  const truncatedEntities: CanonicalTextEntity[] = [];
  const excludedGeometryPairs: Array<{
    entity: CanonicalTextEntity;
    primitive: DrawingPaintedPath;
  }> = [];
  let candidatePairCount = 0;

  for (const entity of entities) {
    const positive: RelationCandidate[] = [];
    const proximity: RelationCandidate[] = [];
    const candidateIndexes = grid.query(entity.pageBBox, POLICY.nearestRadiusPt);
    candidatePairCount += candidateIndexes.length;
    for (const primitiveIndex of candidateIndexes) {
      const primitiveValue = primitives[primitiveIndex]!;
      const classificationValue = classificationById.get(primitiveValue.id)!;
      if (
        isBeyondSpatialDistance(
          primitiveValue.pageBBox,
          entity.pageBBox,
          POLICY.nearestRadiusPt,
        )
      ) continue;
      let analysis;
      try {
        analysis = analyzeSpatialGeometry(
          primitiveValue.pageBBox,
          entity.pageBBox,
        );
      } catch (error) {
        if (!(error instanceof SpatialGeometryUnrepresentableError)) throw error;
        excludedGeometryPairs.push({ entity, primitive: primitiveValue });
        continue;
      }
      const candidate: RelationCandidate = {
        primitive: primitiveValue,
        classification: classificationValue,
        relationTypes: [...analysis.relationTypes],
        distancePt: analysis.distancePt,
        rawDistancePt: analysis.rawDistancePt,
        rawCenterDeltaXPt: analysis.rawCenterDeltaXPt,
        rawCenterDeltaYPt: analysis.rawCenterDeltaYPt,
        rank: null,
        geometry: spatialGeometry(analysis),
      };
      if (analysis.topology !== "disjoint") {
        positive.push(candidate);
      } else if (analysis.rawDistancePt <= POLICY.nearestRadiusPt) {
        proximity.push(candidate);
      }
    }

    proximity.sort(
      (left, right) =>
        left.distancePt - right.distancePt ||
        left.primitive.sourceOrder - right.primitive.sourceOrder ||
        codepointCompare(left.primitive.id, right.primitive.id),
    );
    if (proximity.length > POLICY.maxProximityPerTextEntity) {
      truncatedEntities.push(entity);
    }
    const retainedProximity = proximity.slice(
      0,
      POLICY.maxProximityPerTextEntity,
    );
    for (const [index, candidate] of retainedProximity.entries()) {
      candidate.rank = index + 1;
      candidate.relationTypes.push("nearest");
      if (
        Math.abs(candidate.rawCenterDeltaXPt) <=
          POLICY.alignmentTolerancePt ||
        Math.abs(candidate.rawCenterDeltaYPt) <=
          POLICY.alignmentTolerancePt
      ) {
        candidate.relationTypes.push("aligned");
      }
      if (candidate.rawDistancePt <= POLICY.adjacentDistancePt) {
        candidate.relationTypes.push("adjacent");
      }
    }

    for (const candidate of [...positive, ...retainedProximity]) {
      const relation = createRelation(
        layout.sourceSha256,
        layout.page,
        entity,
        candidate,
      );
      if (relationIds.has(relation.id)) {
        throw new Error(`Drawing spatial relation ID collision: ${relation.id}`);
      }
      relationIds.add(relation.id);
      relations.push(relation);
    }
  }

  const entityOrder = new Map(
    entities.map((entity, index) => [`${entity.type}:${entity.id}`, index]),
  );
  relations.sort((left, right) => {
    const leftOrder = entityOrder.get(
      `${left.textEntityType}:${left.textEntityId}`,
    )!;
    const rightOrder = entityOrder.get(
      `${right.textEntityType}:${right.textEntityId}`,
    )!;
    return (
      leftOrder - rightOrder ||
      codepointCompare(left.textEntityId, right.textEntityId) ||
      TOPOLOGY_PRIORITY[left.geometry.topology] -
        TOPOLOGY_PRIORITY[right.geometry.topology] ||
      left.distancePt - right.distancePt ||
      (left.rank ?? -1) - (right.rank ?? -1) ||
      left.primitiveSourceOrder - right.primitiveSourceOrder ||
      codepointCompare(left.primitiveId, right.primitiveId)
    );
  });

  const warnings = new Set([
    ...layout.warnings,
    ...primitive.warnings,
    ...classification.warnings,
  ]);
  if (entities.length === 0) warnings.add("EMPTY_TEXT_ENTITIES count=0");
  if (primitives.length === 0) warnings.add("EMPTY_PRIMITIVES count=0");
  if (truncatedEntities.length > 0) {
    const first = truncatedEntities[0]!;
    warnings.add(
      `PROXIMITY_TRUNCATED count=${truncatedEntities.length} firstTextEntity=${first.type}:${first.id}`,
    );
  }
  if (excludedGeometryPairs.length > 0) {
    const first = excludedGeometryPairs[0]!;
    warnings.add(
      `UNREPRESENTABLE_GEOMETRY_PAIR count=${excludedGeometryPairs.length} firstTextEntity=${first.entity.type}:${first.entity.id} firstPrimitive=${first.primitive.id}`,
    );
  }

  return {
    schemaVersion: 1,
    source: layout.source,
    sourceSha256: layout.sourceSha256,
    page: layout.page,
    pageWidth: layout.pageWidth,
    pageHeight: layout.pageHeight,
    textItemCount: validatedLayout.items.length,
    textLineCount: validatedLayout.lines.length,
    primitiveCount: primitives.length,
    relationCount: relations.length,
    policy: { ...POLICY },
    statistics: relationStatistics(
      entities.length,
      candidatePairCount,
      relations,
      truncatedEntities.length,
      grid.diagnostics,
    ),
    relations,
    warnings: [...warnings].sort(codepointCompare),
  };
}
