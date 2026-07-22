import type {
  DrawingElectricalObjectDocument,
  ElectricalAttribute,
  ElectricalObject,
} from "../drawingElectricalObjects/types.js";
import { validateElectricalDocument } from "../drawingElectricalObjects/validateElectricalObjects.js";
import {
  ElectricalRelationshipType,
  type ElectricalRelationship,
  type ElectricalRelationshipDocument,
} from "../drawingElectricalRelationships/types.js";
import { validateElectricalRelationshipDocument } from "../drawingElectricalRelationships/validateElectricalRelationships.js";
import {
  createCircuitEdgeId,
  createCircuitGraphId,
  createCircuitNodeId,
} from "./identity.js";
import { canonicalizeCircuitJsonValue } from "./jsonValue.js";
import { codepointCompare } from "./ordering.js";
import {
  deriveCircuitComponents,
  findReferenceCycles,
} from "./projectionComponents.js";
import {
  cloneCircuitJsonObject,
  createNodeDetails,
  mapElectricalObjectType,
  projectPublicObjectAttributes,
} from "./projectionMappings.js";
import {
  CircuitGraphProjectionError,
  type CircuitGraphProjectionErrorCode,
} from "./projectionTypes.js";
import {
  CircuitEdgeType,
  CircuitGraphWarningCode,
  CircuitNodeType,
  type CircuitEdge,
  type CircuitEdgeDirection,
  type CircuitGraphDocument,
  type CircuitGraphStatistics,
  type CircuitGraphWarning,
  type CircuitNode,
} from "./types.js";
import { parseCircuitGraphDocument } from "./validateCircuitGraphDocument.js";

const OBJECT_DOCUMENT_KEYS = new Set([
  "schemaVersion",
  "source",
  "sourceSha256",
  "page",
  "pageWidth",
  "pageHeight",
  "objectCount",
  "objects",
  "constructionGraph",
  "statistics",
  "warnings",
]);
const RELATIONSHIP_DOCUMENT_KEYS = new Set([
  "schemaVersion",
  "source",
  "sourceSha256",
  "page",
  "objectIds",
  "relationshipCount",
  "relationships",
  "statistics",
  "warnings",
]);
const RELATIONSHIP_KEYS = new Set([
  "relationshipId",
  "sourceObjectId",
  "targetObjectId",
  "relationshipType",
  "confidence",
  "evidenceIds",
  "attributes",
  "diagnostics",
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PROJECTION_INPUT_DEPTH = 256;
const PROJECTION_PROFILE = "electrical-object-relationship-v1";

const GRAPH_METADATA = {
  projectionProfile: PROJECTION_PROFILE,
  projectionProfileVersion: 1,
  objectDocumentSchemaVersion: 1,
  relationshipDocumentSchemaVersion: 1,
} as const;

function projectionError(
  code: CircuitGraphProjectionErrorCode,
  message: string,
  relatedIds: readonly string[] = [],
): CircuitGraphProjectionError {
  return new CircuitGraphProjectionError(code, message, relatedIds);
}

function assertSafeJsonInput(
  value: unknown,
  code: "INVALID_OBJECT_DOCUMENT" | "INVALID_RELATIONSHIP_DOCUMENT",
): void {
  const states = new WeakMap<object, 1 | 2>();
  const maximumVisitedDepth = new WeakMap<object, number>();
  const stack: Array<{ value: unknown; depth: number; complete: boolean }> = [
    { value, depth: 0, complete: false },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const current = frame.value;
    if (frame.complete) {
      states.set(current as object, 2);
      continue;
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (typeof current === "number") {
      if (Number.isFinite(current)) continue;
      throw projectionError(code, "Input document must contain finite numbers");
    }
    if (typeof current !== "object") {
      throw projectionError(
        code,
        "Input document must contain JSON-safe values",
      );
    }
    if (frame.depth > MAX_PROJECTION_INPUT_DEPTH) {
      const label =
        code === "INVALID_OBJECT_DOCUMENT"
          ? "Electrical object document"
          : "Electrical relationship document";
      throw projectionError(
        code,
        `${label} exceeds the maximum supported nesting depth`,
      );
    }
    const state = states.get(current);
    if (state === 1) {
      throw projectionError(
        code,
        "Input document must not contain cyclic references",
      );
    }
    const previousDepth = maximumVisitedDepth.get(current);
    if (
      state === 2 &&
      previousDepth !== undefined &&
      previousDepth >= frame.depth
    ) {
      continue;
    }
    maximumVisitedDepth.set(
      current,
      Math.max(previousDepth ?? frame.depth, frame.depth),
    );

    const prototype = Object.getPrototypeOf(current);
    const children: unknown[] = [];
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) {
        throw projectionError(
          code,
          "Input arrays must use the standard prototype",
        );
      }
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1 || !keys.includes("length")) {
        throw projectionError(code, "Input arrays must be dense data arrays");
      }
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current,
          String(index),
        );
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          throw projectionError(code, "Input arrays must be dense data arrays");
        }
        children.push(descriptor.value);
      }
    } else {
      if (prototype !== Object.prototype && prototype !== null) {
        throw projectionError(code, "Input objects must use a plain prototype");
      }
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) {
          throw projectionError(
            code,
            "Input document contains an unsafe property key",
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          throw projectionError(
            code,
            "Input objects must contain enumerable data properties",
          );
        }
        children.push(descriptor.value);
      }
    }

    states.set(current, 1);
    stack.push({ value: current, depth: frame.depth, complete: true });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        value: children[index],
        depth: frame.depth + 1,
        complete: false,
      });
    }
  }
}

function hasExactKeys(value: unknown, expected: ReadonlySet<string>): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function assertObjectDocumentPublicShape(value: unknown): void {
  if (!hasExactKeys(value, OBJECT_DOCUMENT_KEYS)) {
    throw projectionError(
      "INVALID_OBJECT_DOCUMENT",
      "Electrical object document has invalid public fields",
    );
  }
}

function assertRelationshipDocumentPublicShape(value: unknown): void {
  if (!hasExactKeys(value, RELATIONSHIP_DOCUMENT_KEYS)) {
    throw projectionError(
      "INVALID_RELATIONSHIP_DOCUMENT",
      "Electrical relationship document has invalid public fields",
    );
  }
  const relationships = Reflect.get(value as object, "relationships");
  if (
    Array.isArray(relationships) &&
    relationships.some(
      (relationship) => !hasExactKeys(relationship, RELATIONSHIP_KEYS),
    )
  ) {
    throw projectionError(
      "INVALID_RELATIONSHIP_DOCUMENT",
      "Electrical relationship has invalid public fields",
    );
  }
}

function validateSourceDocuments(
  objectDocumentValue: unknown,
  relationshipDocumentValue: unknown,
): {
  objectDocument: DrawingElectricalObjectDocument;
  relationshipDocument: ElectricalRelationshipDocument;
} {
  let objectValidation: ReturnType<typeof validateElectricalDocument>;
  try {
    objectValidation = validateElectricalDocument(objectDocumentValue);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw projectionError(
        "INVALID_OBJECT_DOCUMENT",
        "Electrical object document validation failed",
      );
    }
    throw error;
  }
  if (!objectValidation.valid) {
    const relatedIds = objectValidation.issues.flatMap(({ objectId }) =>
      objectId === null ? [] : [objectId],
    );
    throw projectionError(
      "INVALID_OBJECT_DOCUMENT",
      "Electrical object document failed validation",
      relatedIds,
    );
  }
  let relationshipValidation: ReturnType<
    typeof validateElectricalRelationshipDocument
  >;
  try {
    relationshipValidation = validateElectricalRelationshipDocument(
      relationshipDocumentValue,
    );
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw projectionError(
        "INVALID_RELATIONSHIP_DOCUMENT",
        "Electrical relationship document validation failed",
      );
    }
    throw error;
  }
  if (!relationshipValidation.valid) {
    throw projectionError(
      "INVALID_RELATIONSHIP_DOCUMENT",
      "Electrical relationship document failed validation",
    );
  }
  return {
    objectDocument: objectDocumentValue as DrawingElectricalObjectDocument,
    relationshipDocument:
      relationshipDocumentValue as ElectricalRelationshipDocument,
  };
}

function assertCompatibleSourceSlice(
  objectDocument: DrawingElectricalObjectDocument,
  relationshipDocument: ElectricalRelationshipDocument,
): Map<string, ElectricalObject> {
  if (
    objectDocument.source !== relationshipDocument.source ||
    objectDocument.sourceSha256 !== relationshipDocument.sourceSha256 ||
    objectDocument.page !== relationshipDocument.page
  ) {
    throw projectionError(
      "INCOMPATIBLE_SOURCE_SLICE",
      "Electrical source documents describe different source slices",
    );
  }

  const objectById = new Map(
    objectDocument.objects.map((object) => [object.id, object] as const),
  );
  const missingEndpoints = relationshipDocument.relationships.flatMap(
    ({ sourceObjectId, targetObjectId }) =>
      [sourceObjectId, targetObjectId].filter((id) => !objectById.has(id)),
  );
  if (missingEndpoints.length > 0) {
    throw projectionError(
      "MISSING_INTERNAL_ENDPOINT",
      "Relationship endpoint is missing from the electrical object document",
      missingEndpoints,
    );
  }

  const objectIds = [...objectById.keys()].sort(codepointCompare);
  const registryIds = [...relationshipDocument.objectIds].sort(
    codepointCompare,
  );
  if (
    objectIds.length !== registryIds.length ||
    objectIds.some((id, index) => id !== registryIds[index])
  ) {
    throw projectionError(
      "OBJECT_REGISTRY_MISMATCH",
      "Relationship object registry does not match electrical objects",
    );
  }
  return objectById;
}

function deriveDisplayName(
  name: ElectricalAttribute<string> | null,
): string | null {
  if (name === null || name.value.length === 0) return null;
  return name.value;
}

function projectNodes(objectDocument: DrawingElectricalObjectDocument): {
  nodes: CircuitNode[];
  nodeIdByObjectId: Map<string, string>;
} {
  const nodeIdByObjectId = new Map<string, string>();
  const nodes = objectDocument.objects.map((object): CircuitNode => {
    const nodeType = mapElectricalObjectType(object.type);
    const role = `object:${nodeType}`;
    const nodeId = createCircuitNodeId({
      sourceSha256: objectDocument.sourceSha256,
      page: objectDocument.page,
      objectIds: [object.id],
      nodeRole: role,
    });
    nodeIdByObjectId.set(object.id, nodeId);
    return {
      nodeId,
      objectIds: [object.id],
      nodeType,
      displayName: deriveDisplayName(object.attributes.name),
      location: { ...object.bbox },
      attributes: projectPublicObjectAttributes(object),
      metadata: {
        role,
        details: createNodeDetails(object),
      },
    };
  });
  nodes.sort((left, right) => codepointCompare(left.nodeId, right.nodeId));
  return { nodes, nodeIdByObjectId };
}

type EdgeProjectionInput = {
  relationship: ElectricalRelationship;
  edgeType: CircuitEdgeType;
  direction: CircuitEdgeDirection;
  sourceNodeId: string;
  targetNodeId: string;
  segmentRole: string;
};

function projectEdge({
  relationship,
  edgeType,
  direction,
  sourceNodeId,
  targetNodeId,
  segmentRole,
}: EdgeProjectionInput): CircuitEdge {
  const endpoints =
    direction === "UNDIRECTED"
      ? [sourceNodeId, targetNodeId].sort(codepointCompare)
      : [sourceNodeId, targetNodeId];
  const canonicalSource = endpoints[0]!;
  const canonicalTarget = endpoints[1]!;
  return {
    edgeId: createCircuitEdgeId({
      relationshipId: relationship.relationshipId,
      edgeType,
      direction,
      sourceNodeId: canonicalSource,
      targetNodeId: canonicalTarget,
      segmentRole,
    }),
    relationshipId: relationship.relationshipId,
    sourceNodeId: canonicalSource,
    targetNodeId: canonicalTarget,
    edgeType,
    direction,
    confidence: relationship.confidence,
    attributes: cloneCircuitJsonObject(relationship.attributes),
    metadata: {
      segmentRole,
      evidenceIds: [...relationship.evidenceIds].sort(codepointCompare),
      details: cloneCircuitJsonObject({
        relationshipType: relationship.relationshipType,
      }),
    },
  };
}

function requireNodeId(
  nodeIdByObjectId: ReadonlyMap<string, string>,
  objectId: string,
): string {
  const nodeId = nodeIdByObjectId.get(objectId);
  if (nodeId === undefined) {
    throw projectionError(
      "MISSING_INTERNAL_ENDPOINT",
      "Relationship endpoint is missing from the projected node registry",
      [objectId],
    );
  }
  return nodeId;
}

function readViaObjectId(
  relationship: ElectricalRelationship,
  objectById: ReadonlyMap<string, ElectricalObject>,
): string {
  const attributes = relationship.attributes;
  const descriptor = Object.getOwnPropertyDescriptor(attributes, "viaObjectId");
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0 ||
    Object.hasOwn(attributes, "viaObjectIds") ||
    descriptor.value === relationship.sourceObjectId ||
    descriptor.value === relationship.targetObjectId ||
    !objectById.has(descriptor.value)
  ) {
    throw projectionError(
      "INVALID_CONNECTED_VIA",
      "CONNECTED_VIA requires one distinct registered viaObjectId",
      [relationship.relationshipId],
    );
  }
  return descriptor.value;
}

function projectRelationships(
  relationships: readonly ElectricalRelationship[],
  objectById: ReadonlyMap<string, ElectricalObject>,
  nodeIdByObjectId: ReadonlyMap<string, string>,
): CircuitEdge[] {
  const edges: CircuitEdge[] = [];
  for (const relationship of relationships) {
    const sourceNodeId = requireNodeId(
      nodeIdByObjectId,
      relationship.sourceObjectId,
    );
    const targetNodeId = requireNodeId(
      nodeIdByObjectId,
      relationship.targetObjectId,
    );
    switch (relationship.relationshipType) {
      case ElectricalRelationshipType.CONNECTED_TO:
        edges.push(
          projectEdge({
            relationship,
            edgeType: CircuitEdgeType.CONNECTED,
            direction: "UNDIRECTED",
            sourceNodeId,
            targetNodeId,
            segmentRole: "direct:connected-to",
          }),
        );
        break;
      case ElectricalRelationshipType.CONNECTED_VIA: {
        const viaObjectId = readViaObjectId(relationship, objectById);
        const viaNodeId = requireNodeId(nodeIdByObjectId, viaObjectId);
        const outerNodeIds = [sourceNodeId, targetNodeId].sort(
          codepointCompare,
        );
        edges.push(
          projectEdge({
            relationship,
            edgeType: CircuitEdgeType.CONNECTED,
            direction: "UNDIRECTED",
            sourceNodeId: outerNodeIds[0]!,
            targetNodeId: viaNodeId,
            segmentRole: "connected-via:segment-0",
          }),
          projectEdge({
            relationship,
            edgeType: CircuitEdgeType.CONNECTED,
            direction: "UNDIRECTED",
            sourceNodeId: viaNodeId,
            targetNodeId: outerNodeIds[1]!,
            segmentRole: "connected-via:segment-1",
          }),
        );
        break;
      }
      case ElectricalRelationshipType.CONTAINS:
        edges.push(
          projectEdge({
            relationship,
            edgeType: CircuitEdgeType.CONTAINS,
            direction: "FORWARD",
            sourceNodeId,
            targetNodeId,
            segmentRole: "direct:contains",
          }),
        );
        break;
      case ElectricalRelationshipType.BELONGS_TO:
        edges.push(
          projectEdge({
            relationship,
            edgeType: CircuitEdgeType.CONTAINS,
            direction: "FORWARD",
            sourceNodeId: targetNodeId,
            targetNodeId: sourceNodeId,
            segmentRole: "direct:belongs-to",
          }),
        );
        break;
      case ElectricalRelationshipType.REFERENCES:
        edges.push(
          projectEdge({
            relationship,
            edgeType: CircuitEdgeType.REFERENCE,
            direction: "FORWARD",
            sourceNodeId,
            targetNodeId,
            segmentRole: "direct:references",
          }),
        );
        break;
      case ElectricalRelationshipType.UNKNOWN:
        throw projectionError(
          "UNSUPPORTED_RELATIONSHIP_TYPE",
          "UNKNOWN relationships cannot be projected into a circuit graph",
          [relationship.relationshipId],
        );
    }
  }
  edges.sort((left, right) => codepointCompare(left.edgeId, right.edgeId));
  return edges;
}

function deriveStatistics(
  nodes: readonly CircuitNode[],
  edges: readonly CircuitEdge[],
  components: ReturnType<typeof deriveCircuitComponents>,
): CircuitGraphStatistics {
  const nodeTypeCounts = Object.fromEntries(
    Object.values(CircuitNodeType).map((type) => [type, 0]),
  ) as Record<CircuitNodeType, number>;
  const edgeTypeCounts = Object.fromEntries(
    Object.values(CircuitEdgeType).map((type) => [type, 0]),
  ) as Record<CircuitEdgeType, number>;
  for (const node of nodes) nodeTypeCounts[node.nodeType] += 1;
  for (const edge of edges) edgeTypeCounts[edge.edgeType] += 1;
  return {
    nodeTypeCounts,
    edgeTypeCounts,
    isolatedNodeCount: components.filter(
      ({ nodeIds, edgeIds }) => nodeIds.length === 1 && edgeIds.length === 0,
    ).length,
    connectedComponentCount: components.length,
  };
}

function compareStringArrays(
  left: readonly string[],
  right: readonly string[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = codepointCompare(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function warningComparator(
  left: CircuitGraphWarning,
  right: CircuitGraphWarning,
): number {
  return (
    codepointCompare(left.code, right.code) ||
    compareStringArrays(left.relatedIds, right.relatedIds) ||
    codepointCompare(left.message, right.message) ||
    codepointCompare(
      JSON.stringify(canonicalizeCircuitJsonValue(left.metadata)),
      JSON.stringify(canonicalizeCircuitJsonValue(right.metadata)),
    )
  );
}

function deriveWarnings(
  nodes: readonly CircuitNode[],
  edges: readonly CircuitEdge[],
  components: ReturnType<typeof deriveCircuitComponents>,
): CircuitGraphWarning[] {
  const warnings: CircuitGraphWarning[] = [];
  if (components.length > 1) {
    warnings.push({
      code: CircuitGraphWarningCode.DISCONNECTED_GRAPH,
      message: "Circuit graph contains multiple connectivity components",
      relatedIds: components
        .map(({ componentId }) => componentId)
        .sort(codepointCompare),
      metadata: { componentCount: components.length },
    });
  }
  const referenceCycles = findReferenceCycles(nodes, edges);
  if (referenceCycles !== null) {
    warnings.push({
      code: CircuitGraphWarningCode.REFERENCE_CYCLE,
      message: "REFERENCE edges contain a directed cycle",
      relatedIds: referenceCycles.nodeIds,
      metadata: { edgeIds: referenceCycles.edgeIds },
    });
  }
  warnings.sort(warningComparator);
  return warnings;
}

function constructGraph(
  objectDocument: DrawingElectricalObjectDocument,
  relationshipDocument: ElectricalRelationshipDocument,
  objectById: ReadonlyMap<string, ElectricalObject>,
): CircuitGraphDocument {
  const { nodes, nodeIdByObjectId } = projectNodes(objectDocument);
  const edges = projectRelationships(
    relationshipDocument.relationships,
    objectById,
    nodeIdByObjectId,
  );
  const components = deriveCircuitComponents(nodes, edges);
  const boundaries: [] = [];
  const statistics = deriveStatistics(nodes, edges, components);
  const warnings = deriveWarnings(nodes, edges, components);
  const graphId = createCircuitGraphId({
    schemaVersion: 1,
    projectionProfile: GRAPH_METADATA.projectionProfile,
    projectionProfileVersion: GRAPH_METADATA.projectionProfileVersion,
    source: objectDocument.source,
    sourceSha256: objectDocument.sourceSha256,
    page: objectDocument.page,
    nodeIds: nodes.map(({ nodeId }) => nodeId),
    edgeIds: edges.map(({ edgeId }) => edgeId),
    componentIds: components.map(({ componentId }) => componentId),
    boundaryIds: [],
  });
  return parseCircuitGraphDocument({
    schemaVersion: 1,
    graphId,
    source: objectDocument.source,
    sourceSha256: objectDocument.sourceSha256,
    page: objectDocument.page,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    componentCount: components.length,
    boundaryCount: boundaries.length,
    nodes,
    edges,
    components,
    boundaries,
    statistics,
    warnings,
    metadata: GRAPH_METADATA,
  });
}

export function projectCircuitGraph(
  objectDocumentValue: unknown,
  relationshipDocumentValue: unknown,
): CircuitGraphDocument {
  assertSafeJsonInput(objectDocumentValue, "INVALID_OBJECT_DOCUMENT");
  assertSafeJsonInput(
    relationshipDocumentValue,
    "INVALID_RELATIONSHIP_DOCUMENT",
  );
  assertObjectDocumentPublicShape(objectDocumentValue);
  assertRelationshipDocumentPublicShape(relationshipDocumentValue);
  const { objectDocument, relationshipDocument } = validateSourceDocuments(
    objectDocumentValue,
    relationshipDocumentValue,
  );
  const objectById = assertCompatibleSourceSlice(
    objectDocument,
    relationshipDocument,
  );
  try {
    return constructGraph(objectDocument, relationshipDocument, objectById);
  } catch (error) {
    if (error instanceof CircuitGraphProjectionError) throw error;
    throw projectionError(
      "GENERATED_GRAPH_INVALID",
      "Projected circuit graph failed Foundation validation",
    );
  }
}
