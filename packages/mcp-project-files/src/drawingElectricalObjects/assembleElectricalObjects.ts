import type { PageBBox } from "../drawingLayout/types.js";
import { canonicalizeElectricalCandidate } from "./candidate.js";
import { canonicalNumber } from "./confidence.js";
import { buildElectricalConstructionGraph } from "./constructionGraph.js";
import { createElectricalObjectId, codepointCompare } from "./objectIdentity.js";
import type {
  BuildElectricalObjectsInput,
  CandidateConflict,
  CandidateResolution,
  DrawingElectricalObjectDocument,
  ElectricalAttribute,
  ElectricalObject,
  ElectricalObjectCandidate,
  ElectricalObjectLabel,
  ElectricalObjectStatus,
  ElectricalObjectType,
} from "./types.js";

const OBJECT_TYPES: readonly ElectricalObjectType[] = [
  "lighting",
  "outlet",
  "panel",
  "breaker",
  "transformer",
  "ground",
  "cable",
  "conduit",
  "equipment",
  "annotation",
  "unknown",
];

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(codepointCompare);
}

function copyAttribute(
  value: unknown,
  name: string,
  required: true,
): ElectricalAttribute<string>;
function copyAttribute(
  value: unknown,
  name: string,
  required?: false,
): ElectricalAttribute<string> | null;
function copyAttribute(
  value: unknown,
  name: string,
  required = false,
): ElectricalAttribute<string> | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(`Electrical attribute ${name} is required`);
    return null;
  }
  if (typeof value !== "object") {
    throw new Error(`Electrical attribute ${name} must be an object`);
  }
  const attribute = value as Record<string, unknown>;
  if (
    typeof attribute.value !== "string" ||
    typeof attribute.rawText !== "string" ||
    typeof attribute.confidence !== "number" ||
    !Number.isFinite(attribute.confidence) ||
    attribute.confidence < 0 ||
    attribute.confidence > 1 ||
    !Array.isArray(attribute.textEntityIds) ||
    !attribute.textEntityIds.every((entry) => typeof entry === "string") ||
    !Array.isArray(attribute.sourceRelationIds) ||
    !attribute.sourceRelationIds.every((entry) => typeof entry === "string") ||
    typeof attribute.parserRuleId !== "string" ||
    attribute.parserRuleId.trim().length === 0
  ) {
    throw new Error(`Electrical attribute ${name} is malformed`);
  }
  return {
    value: attribute.value,
    rawText: attribute.rawText,
    confidence: attribute.confidence,
    textEntityIds: canonicalStrings(attribute.textEntityIds as string[]),
    sourceRelationIds: canonicalStrings(attribute.sourceRelationIds as string[]),
    parserRuleId: attribute.parserRuleId,
  };
}

function assembleAttributes(
  candidate: ElectricalObjectCandidate,
): ElectricalObject["attributes"] {
  const common = {
    name: copyAttribute(candidate.attributes.name, "name"),
    tag: copyAttribute(candidate.attributes.tag, "tag"),
    phase: copyAttribute(candidate.attributes.phase, "phase"),
    capacity: copyAttribute(candidate.attributes.capacity, "capacity"),
    circuit: copyAttribute(candidate.attributes.circuit, "circuit"),
    voltage: copyAttribute(candidate.attributes.voltage, "voltage"),
    remarks: copyAttribute(candidate.attributes.remarks, "remarks"),
  };
  switch (candidate.type) {
    case "breaker":
      return {
        ...common,
        rating: copyAttribute(candidate.attributes.rating, "rating"),
        breakerKind: copyAttribute(
          candidate.attributes.breakerKind,
          "breakerKind",
          true,
        ),
        poles: copyAttribute(candidate.attributes.poles, "poles"),
        frameAmpere: copyAttribute(
          candidate.attributes.frameAmpere,
          "frameAmpere",
        ),
        tripAmpere: copyAttribute(candidate.attributes.tripAmpere, "tripAmpere"),
      };
    case "panel":
    case "transformer":
    case "cable":
      return {
        ...common,
        rating: copyAttribute(candidate.attributes.rating, "rating"),
      };
    case "unknown":
      return {
        name: common.name,
        tag: common.tag,
        remarks: common.remarks,
      };
    default:
      return common;
  }
}

function unionPrimitiveBBoxes(
  candidate: ElectricalObjectCandidate,
  context: BuildElectricalObjectsInput,
): { primitiveIds: string[]; bbox: PageBBox } {
  const primitiveIds = canonicalStrings([
    ...candidate.primaryPrimitiveIds,
    ...candidate.supportingPrimitiveIds,
  ]);
  const primitiveById = new Map(
    context.primitive.primitives.map((primitive) => [primitive.id, primitive]),
  );
  const boxes = primitiveIds.map((id) => {
    const primitive = primitiveById.get(id);
    if (!primitive) throw new Error(`Missing owned primitive: ${id}`);
    return primitive.pageBBox;
  });
  if (boxes.length === 0) {
    throw new Error(`Electrical candidate ${candidate.id} has no owned primitives`);
  }
  const minX = Math.min(...boxes.map((bbox) => bbox.x));
  const minY = Math.min(...boxes.map((bbox) => bbox.y));
  const maxX = Math.max(...boxes.map((bbox) => bbox.x + bbox.width));
  const maxY = Math.max(...boxes.map((bbox) => bbox.y + bbox.height));
  return {
    primitiveIds,
    bbox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

function assembleLabels(
  candidate: ElectricalObjectCandidate,
  context: BuildElectricalObjectsInput,
): ElectricalObjectLabel[] {
  const itemIds = new Set(context.layout.items.map((item) => item.id));
  const lineIds = new Set(context.layout.lines.map((line) => line.id));
  return canonicalStrings(candidate.labelIds).map((textEntityId) => {
    const textEntityType = itemIds.has(textEntityId)
      ? "item"
      : lineIds.has(textEntityId)
        ? "line"
        : null;
    if (textEntityType === null) {
      throw new Error(`Missing electrical object label: ${textEntityId}`);
    }
    return { textEntityType, textEntityId, role: "label" };
  });
}

function compareConflicts(left: CandidateConflict, right: CandidateConflict): number {
  return codepointCompare(left.winnerId, right.winnerId) ||
    codepointCompare(left.loserId, right.loserId) ||
    codepointCompare(left.reason, right.reason);
}

function assembleObject(
  candidateValue: ElectricalObjectCandidate,
  status: ElectricalObjectStatus,
  conflicts: readonly CandidateConflict[],
  context: BuildElectricalObjectsInput,
): ElectricalObject {
  const candidate = canonicalizeElectricalCandidate(candidateValue, context);
  const { primitiveIds, bbox } = unionPrimitiveBBoxes(candidate, context);
  const relevantConflicts = conflicts
    .filter(({ winnerId, loserId }) =>
      winnerId === candidate.id || loserId === candidate.id
    )
    .map((conflict) => ({ ...conflict }))
    .sort(compareConflicts);
  const base = {
    id: createElectricalObjectId({
      sourceSha256: context.layout.sourceSha256,
      page: context.layout.page,
      ruleId: candidate.ruleId,
      primaryPrimitiveIds: candidate.primaryPrimitiveIds,
      supportingPrimitiveIds: candidate.supportingPrimitiveIds,
      contextPrimitiveIds: candidate.contextPrimitiveIds,
      labelIds: candidate.labelIds,
    }),
    status,
    bbox,
    primitiveIds,
    labels: assembleLabels(candidate, context),
    attributes: assembleAttributes(candidate),
    confidence: canonicalNumber(candidate.confidence),
    sourceRelationIds: canonicalStrings(candidate.sourceRelationIds),
    diagnostics: {
      ruleId: candidate.ruleId,
      confidenceComponents: {
        structural: candidate.structuralScore,
        label: candidate.labelScore,
        spatial: candidate.spatialScore,
        attribute: candidate.attributeScore,
        consistency: candidate.consistencyScore,
      },
      conflicts: relevantConflicts,
    },
  };
  return { ...base, type: candidate.type } as ElectricalObject;
}

function emptyTypeCounts(): Record<ElectricalObjectType, number> {
  return Object.fromEntries(OBJECT_TYPES.map((type) => [type, 0])) as Record<
    ElectricalObjectType,
    number
  >;
}

export function assembleElectricalObjects(
  resolution: CandidateResolution,
  context: BuildElectricalObjectsInput,
): DrawingElectricalObjectDocument {
  const objects = [
    ...resolution.acceptedCandidates.map((candidate) =>
      assembleObject(candidate, "accepted", resolution.conflicts, context)
    ),
    ...resolution.reviewCandidates.map((candidate) =>
      assembleObject(candidate, "review", resolution.conflicts, context)
    ),
  ].sort((left, right) => codepointCompare(left.id, right.id));
  const objectIds = new Set<string>();
  const objectCountByType = emptyTypeCounts();
  for (const object of objects) {
    if (objectIds.has(object.id)) {
      throw new Error(`Duplicate electrical object ID: ${object.id}`);
    }
    objectIds.add(object.id);
    objectCountByType[object.type] += 1;
  }
  const warnings: string[] = [];
  return {
    schemaVersion: 1,
    source: context.layout.source,
    sourceSha256: context.layout.sourceSha256,
    page: context.layout.page,
    pageWidth: context.layout.pageWidth,
    pageHeight: context.layout.pageHeight,
    objectCount: objects.length,
    objects,
    constructionGraph: buildElectricalConstructionGraph(objects, []),
    statistics: {
      candidateCount:
        resolution.acceptedCandidates.length +
        resolution.reviewCandidates.length +
        resolution.excludedCandidates.length,
      acceptedObjectCount: resolution.acceptedCandidates.length,
      reviewObjectCount: resolution.reviewCandidates.length,
      excludedCandidateCount: resolution.excludedCandidates.length,
      conflictCount: resolution.conflicts.length,
      objectCountByType,
      warningCount: warnings.length,
    },
    warnings,
  };
}
