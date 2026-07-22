import { canonicalizeCircuitJsonValue } from "./jsonValue.js";
import type {
  CircuitBoundary,
  CircuitComponent,
  CircuitEdge,
  CircuitGraphDocument,
  CircuitGraphWarning,
  CircuitJsonValue,
  CircuitNode,
} from "./types.js";
import { assertValidCircuitGraphDocument } from "./validateCircuitGraphDocument.js";

function projectNode(node: CircuitNode): CircuitNode {
  return {
    nodeId: node.nodeId,
    objectIds: [...node.objectIds],
    nodeType: node.nodeType,
    displayName: node.displayName,
    location:
      node.location === null
        ? null
        : {
            x: node.location.x,
            y: node.location.y,
            width: node.location.width,
            height: node.location.height,
          },
    attributes: node.attributes,
    metadata: {
      role: node.metadata.role,
      details: node.metadata.details,
    },
  };
}

function projectEdge(edge: CircuitEdge): CircuitEdge {
  return {
    edgeId: edge.edgeId,
    relationshipId: edge.relationshipId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    edgeType: edge.edgeType,
    direction: edge.direction,
    confidence: edge.confidence,
    attributes: edge.attributes,
    metadata: {
      segmentRole: edge.metadata.segmentRole,
      evidenceIds: [...edge.metadata.evidenceIds],
      details: edge.metadata.details,
    },
  };
}

function projectComponent(component: CircuitComponent): CircuitComponent {
  return {
    componentId: component.componentId,
    nodeIds: [...component.nodeIds],
    edgeIds: [...component.edgeIds],
    metadata: { details: component.metadata.details },
  };
}

function projectBoundary(boundary: CircuitBoundary): CircuitBoundary {
  return {
    boundaryId: boundary.boundaryId,
    nodeId: boundary.nodeId,
    externalReferenceId: boundary.externalReferenceId,
    boundaryType: boundary.boundaryType,
    boundaryRole: boundary.boundaryRole,
    metadata: { details: boundary.metadata.details },
  };
}

function projectWarning(warning: CircuitGraphWarning): CircuitGraphWarning {
  return {
    code: warning.code,
    message: warning.message,
    relatedIds: [...warning.relatedIds],
    metadata: warning.metadata,
  };
}

function projectDocument(document: CircuitGraphDocument): CircuitGraphDocument {
  return {
    schemaVersion: document.schemaVersion,
    graphId: document.graphId,
    source: document.source,
    sourceSha256: document.sourceSha256,
    page: document.page,
    nodeCount: document.nodeCount,
    edgeCount: document.edgeCount,
    componentCount: document.componentCount,
    boundaryCount: document.boundaryCount,
    nodes: document.nodes.map(projectNode),
    edges: document.edges.map(projectEdge),
    components: document.components.map(projectComponent),
    boundaries: document.boundaries.map(projectBoundary),
    statistics: {
      nodeTypeCounts: { ...document.statistics.nodeTypeCounts },
      edgeTypeCounts: { ...document.statistics.edgeTypeCounts },
      isolatedNodeCount: document.statistics.isolatedNodeCount,
      connectedComponentCount: document.statistics.connectedComponentCount,
    },
    warnings: document.warnings.map(projectWarning),
    metadata: {
      projectionProfile: document.metadata.projectionProfile,
      projectionProfileVersion: document.metadata.projectionProfileVersion,
      objectDocumentSchemaVersion:
        document.metadata.objectDocumentSchemaVersion,
      relationshipDocumentSchemaVersion:
        document.metadata.relationshipDocumentSchemaVersion,
    },
  };
}

export function serializeCircuitGraphDocument(documentValue: unknown): string {
  assertValidCircuitGraphDocument(documentValue);
  const projected = projectDocument(documentValue);
  const canonical = canonicalizeCircuitJsonValue(
    projected as unknown as CircuitJsonValue,
  );
  return `${JSON.stringify(canonical)}\n`;
}
