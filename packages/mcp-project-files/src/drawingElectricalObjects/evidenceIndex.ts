import type { PrimitiveClassification } from "../drawingClassification/types.js";
import type {
  DrawingTextItem,
  DrawingTextLine,
} from "../drawingLayout/types.js";
import type { DrawingPaintedPath } from "../drawingPrimitive/types.js";
import type { SpatialRelation } from "../drawingSpatial/types.js";
import { validateElectricalConstructionInput } from "./validateElectricalConstructionInput.js";
import type { BuildElectricalObjectsInput } from "./types.js";

type TextEntity = DrawingTextItem | DrawingTextLine;

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export type ElectricalEvidenceIndex = {
  getPrimitive(id: string): DrawingPaintedPath | undefined;
  getTextEntity(id: string): TextEntity | undefined;
  getClassification(primitiveId: string): PrimitiveClassification | undefined;
  getRelation(id: string): SpatialRelation | undefined;
  getRelationsByPrimitive(id: string): SpatialRelation[];
  getRelationsByTextEntity(id: string): SpatialRelation[];
  getNeighboringText(primitiveId: string): TextEntity[];
  getNeighboringPrimitives(textEntityId: string): DrawingPaintedPath[];
  getCanonicalPrimitiveId(primitiveId: string): string | undefined;
  statistics: {
    primitiveCount: number;
    textEntityCount: number;
    relationCount: number;
    indexedReferenceCount: number;
  };
};

export function createElectricalEvidenceIndex(
  input: BuildElectricalObjectsInput,
): ElectricalEvidenceIndex {
  validateElectricalConstructionInput(input);
  const primitiveById = new Map(input.primitive.primitives.map((value) => [value.id, value]));
  const texts = [...input.layout.items, ...input.layout.lines];
  const textById = new Map(texts.map((value) => [value.id, value]));
  const classificationByPrimitive = new Map(
    input.classification.classifications.map((value) => [value.primitiveId, value]),
  );
  const relationById = new Map(input.spatial.relations.map((value) => [value.id, value]));
  const relationsByPrimitive = new Map<string, SpatialRelation[]>();
  const relationsByText = new Map<string, SpatialRelation[]>();
  for (const relation of input.spatial.relations) {
    append(relationsByPrimitive, relation.primitiveId, relation);
    append(relationsByText, relation.textEntityId, relation);
  }
  for (const values of [...relationsByPrimitive.values(), ...relationsByText.values()]) {
    values.sort(compareId);
  }

  const canonicalPrimitiveIds = new Map<string, string>();
  const duplicateGroups = new Map<string, string[]>();
  for (const classification of input.classification.classifications) {
    const groupId = classification.diagnostics.duplicateGroupId;
    if (groupId !== null) append(duplicateGroups, groupId, classification.primitiveId);
    else canonicalPrimitiveIds.set(classification.primitiveId, classification.primitiveId);
  }
  for (const ids of duplicateGroups.values()) {
    const canonical = [...ids].sort((left, right) => {
      const order = primitiveById.get(left)!.sourceOrder - primitiveById.get(right)!.sourceOrder;
      return order || (left < right ? -1 : left > right ? 1 : 0);
    })[0]!;
    for (const id of ids) canonicalPrimitiveIds.set(id, canonical);
  }

  const copyRelations = (values: SpatialRelation[] | undefined): SpatialRelation[] =>
    values ? [...values] : [];
  return {
    getPrimitive: (id) => primitiveById.get(id),
    getTextEntity: (id) => textById.get(id),
    getClassification: (id) => classificationByPrimitive.get(id),
    getRelation: (id) => relationById.get(id),
    getRelationsByPrimitive: (id) => copyRelations(relationsByPrimitive.get(id)),
    getRelationsByTextEntity: (id) => copyRelations(relationsByText.get(id)),
    getNeighboringText: (id) => copyRelations(relationsByPrimitive.get(id))
      .map((relation) => textById.get(relation.textEntityId)!)
      .sort(compareId),
    getNeighboringPrimitives: (id) => copyRelations(relationsByText.get(id))
      .map((relation) => primitiveById.get(relation.primitiveId)!)
      .sort(compareId),
    getCanonicalPrimitiveId: (id) => canonicalPrimitiveIds.get(id),
    statistics: {
      primitiveCount: primitiveById.size,
      textEntityCount: textById.size,
      relationCount: relationById.size,
      indexedReferenceCount:
        primitiveById.size + textById.size + relationById.size * 4,
    },
  };
}
