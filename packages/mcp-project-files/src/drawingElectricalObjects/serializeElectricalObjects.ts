import { canonicalNumber } from "./confidence.js";
import { codepointCompare } from "./objectIdentity.js";
import type {
  CommonElectricalAttributes,
  ConstructionGraph,
  ConstructionGraphComponent,
  ConstructionGraphEdge,
  DrawingElectricalObjectDocument,
  ElectricalAttribute,
  ElectricalObject,
  ElectricalObjectDiagnostics,
  ElectricalObjectLabel,
  ElectricalObjectStatistics,
} from "./types.js";
import { validateElectricalObjects } from "./validateElectricalObjects.js";

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(codepointCompare);
}

function canonicalPublicNumber(value: number): number {
  return Number.isFinite(value) ? canonicalNumber(value) : value;
}

function compareLabels(
  left: ElectricalObjectLabel,
  right: ElectricalObjectLabel,
): number {
  return codepointCompare(left.textEntityId, right.textEntityId) ||
    codepointCompare(left.textEntityType, right.textEntityType) ||
    codepointCompare(left.role, right.role);
}

function compareEdges(
  left: ConstructionGraphEdge,
  right: ConstructionGraphEdge,
): number {
  return codepointCompare(left.objectIds[0], right.objectIds[0]) ||
    codepointCompare(left.objectIds[1], right.objectIds[1]) ||
    codepointCompare(left.id, right.id);
}

function compareComponents(
  left: ConstructionGraphComponent,
  right: ConstructionGraphComponent,
): number {
  return codepointCompare(left.objectIds[0] ?? "", right.objectIds[0] ?? "") ||
    codepointCompare(left.id, right.id);
}

function projectAttribute(
  attribute: ElectricalAttribute<string>,
): ElectricalAttribute<string>;
function projectAttribute(attribute: null): null;
function projectAttribute(
  attribute: ElectricalAttribute<string> | null,
): ElectricalAttribute<string> | null;
function projectAttribute(
  attribute: ElectricalAttribute<string> | null,
): ElectricalAttribute<string> | null {
  if (attribute === null) return null;
  return {
    value: attribute.value,
    rawText: attribute.rawText,
    confidence: attribute.confidence,
    textEntityIds: canonicalStrings(attribute.textEntityIds),
    sourceRelationIds: canonicalStrings(attribute.sourceRelationIds),
    parserRuleId: attribute.parserRuleId,
  };
}

function projectCommonAttributes(
  attributes: CommonElectricalAttributes,
): CommonElectricalAttributes {
  return {
    name: projectAttribute(attributes.name),
    tag: projectAttribute(attributes.tag),
    phase: projectAttribute(attributes.phase),
    capacity: projectAttribute(attributes.capacity),
    circuit: projectAttribute(attributes.circuit),
    voltage: projectAttribute(attributes.voltage),
    remarks: projectAttribute(attributes.remarks),
  };
}

function projectAttributes(
  object: ElectricalObject,
): ElectricalObject["attributes"] {
  if (object.type === "unknown") {
    return {
      name: projectAttribute(object.attributes.name),
      tag: projectAttribute(object.attributes.tag),
      remarks: projectAttribute(object.attributes.remarks),
    };
  }
  const common = projectCommonAttributes(object.attributes);
  if (object.type === "breaker") {
    return {
      name: common.name,
      tag: common.tag,
      phase: common.phase,
      capacity: common.capacity,
      circuit: common.circuit,
      voltage: common.voltage,
      remarks: common.remarks,
      rating: projectAttribute(object.attributes.rating),
      breakerKind: projectAttribute(object.attributes.breakerKind),
      poles: projectAttribute(object.attributes.poles),
      frameAmpere: projectAttribute(object.attributes.frameAmpere),
      tripAmpere: projectAttribute(object.attributes.tripAmpere),
    };
  }
  if (
    object.type === "panel" ||
    object.type === "transformer" ||
    object.type === "cable"
  ) {
    return {
      name: common.name,
      tag: common.tag,
      phase: common.phase,
      capacity: common.capacity,
      circuit: common.circuit,
      voltage: common.voltage,
      remarks: common.remarks,
      rating: projectAttribute(object.attributes.rating),
    };
  }
  return common;
}

function projectConflict(conflict: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  if (Object.hasOwn(conflict, "winnerId")) projected.winnerId = conflict.winnerId;
  if (Object.hasOwn(conflict, "loserId")) projected.loserId = conflict.loserId;
  if (Object.hasOwn(conflict, "reason")) projected.reason = conflict.reason;
  return projected;
}

function projectDiagnostics(
  diagnostics: ElectricalObjectDiagnostics,
): ElectricalObjectDiagnostics {
  return {
    ruleId: diagnostics.ruleId,
    confidenceComponents: {
      structural: diagnostics.confidenceComponents.structural,
      label: diagnostics.confidenceComponents.label,
      spatial: diagnostics.confidenceComponents.spatial,
      attribute: diagnostics.confidenceComponents.attribute,
      consistency: diagnostics.confidenceComponents.consistency,
    },
    conflicts: diagnostics.conflicts
      .map(projectConflict)
      .sort((left, right) =>
        codepointCompare(String(left.winnerId ?? ""), String(right.winnerId ?? "")) ||
        codepointCompare(String(left.loserId ?? ""), String(right.loserId ?? "")) ||
        codepointCompare(String(left.reason ?? ""), String(right.reason ?? ""))
      ),
  };
}

function projectObject(object: ElectricalObject): ElectricalObject {
  return {
    id: object.id,
    type: object.type,
    status: object.status,
    bbox: {
      x: canonicalPublicNumber(object.bbox.x),
      y: canonicalPublicNumber(object.bbox.y),
      width: canonicalPublicNumber(object.bbox.width),
      height: canonicalPublicNumber(object.bbox.height),
    },
    primitiveIds: canonicalStrings(object.primitiveIds),
    labels: object.labels.map((label) => ({
      textEntityType: label.textEntityType,
      textEntityId: label.textEntityId,
      role: label.role,
    })).sort(compareLabels),
    attributes: projectAttributes(object),
    confidence: canonicalPublicNumber(object.confidence),
    sourceRelationIds: canonicalStrings(object.sourceRelationIds),
    diagnostics: projectDiagnostics(object.diagnostics),
  } as ElectricalObject;
}

function projectGraph(graph: ConstructionGraph): ConstructionGraph {
  return {
    objectIds: canonicalStrings(graph.objectIds),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      type: edge.type,
      objectIds: canonicalStrings(edge.objectIds) as [string, string],
      primitiveIds: canonicalStrings(edge.primitiveIds),
      sourceRelationIds: canonicalStrings(edge.sourceRelationIds),
    })).sort(compareEdges),
    components: graph.components.map((component) => ({
      id: component.id,
      objectIds: canonicalStrings(component.objectIds),
      edgeIds: canonicalStrings(component.edgeIds),
    })).sort(compareComponents),
  };
}

function projectStatistics(
  statistics: ElectricalObjectStatistics,
): ElectricalObjectStatistics {
  return {
    candidateCount: statistics.candidateCount,
    acceptedObjectCount: statistics.acceptedObjectCount,
    reviewObjectCount: statistics.reviewObjectCount,
    excludedCandidateCount: statistics.excludedCandidateCount,
    conflictCount: statistics.conflictCount,
    objectCountByType: {
      lighting: statistics.objectCountByType.lighting,
      outlet: statistics.objectCountByType.outlet,
      panel: statistics.objectCountByType.panel,
      breaker: statistics.objectCountByType.breaker,
      transformer: statistics.objectCountByType.transformer,
      ground: statistics.objectCountByType.ground,
      cable: statistics.objectCountByType.cable,
      conduit: statistics.objectCountByType.conduit,
      equipment: statistics.objectCountByType.equipment,
      annotation: statistics.objectCountByType.annotation,
      unknown: statistics.objectCountByType.unknown,
    },
    warningCount: statistics.warningCount,
  };
}

function canonicalizeDocument(
  documentValue: unknown,
): DrawingElectricalObjectDocument {
  const input = documentValue as Partial<DrawingElectricalObjectDocument>;
  const projected: Partial<DrawingElectricalObjectDocument> = {
    schemaVersion: input.schemaVersion,
    source: input.source,
    sourceSha256: input.sourceSha256,
    page: input.page,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    objectCount: input.objectCount,
    objects: Array.isArray(input.objects)
      ? input.objects.map(projectObject)
        .sort((left, right) => codepointCompare(left.id, right.id))
      : input.objects,
    constructionGraph:
      input.constructionGraph && typeof input.constructionGraph === "object"
        ? projectGraph(input.constructionGraph)
        : input.constructionGraph,
    statistics:
      input.statistics && typeof input.statistics === "object"
        ? projectStatistics(input.statistics)
        : input.statistics,
    warnings: Array.isArray(input.warnings)
      ? canonicalStrings(input.warnings)
      : input.warnings,
  };
  return projected as DrawingElectricalObjectDocument;
}

function canonicalJsonValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain finite numbers`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalJsonValue(entry, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => codepointCompare(left, right))
        .map(([key, entry]) => {
          if (entry === undefined) throw new Error(`${path}.${key} must not be undefined`);
          return [key, canonicalJsonValue(entry, `${path}.${key}`)];
        }),
    );
  }
  throw new Error(`${path} is not JSON-friendly`);
}

export function serializeElectricalDocument(document: unknown): string {
  const canonical = canonicalizeDocument(document);
  validateElectricalObjects(canonical);
  const jsonValue = canonicalJsonValue(canonical, "electricalDocument");
  return `${JSON.stringify(jsonValue)}\n`;
}

export const serializeElectricalObjects = serializeElectricalDocument;
