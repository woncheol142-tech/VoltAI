import {
  createCircuitBoundaryId,
  createCircuitComponentId,
  createCircuitEdgeId,
  createCircuitGraphId,
  createCircuitNodeId,
} from "./identity.js";
import {
  canonicalizeCircuitJsonValue,
  deepFreezeCircuitValue,
  isCircuitJsonObject,
} from "./jsonValue.js";
import { codepointCompare, isCanonicalUniqueStrings } from "./ordering.js";
import {
  CircuitBoundaryRole,
  CircuitBoundaryType,
  CircuitEdgeType,
  CircuitGraphWarningCode,
  CircuitNodeType,
  type CircuitEdgeDirection,
  type CircuitGraphDocument,
} from "./types.js";

export type CircuitGraphValidationIssue = {
  severity: "error";
  code: string;
  message: string;
  relatedId: string | null;
};

export type CircuitGraphValidationResult = {
  valid: boolean;
  issues: CircuitGraphValidationIssue[];
};

type DataRecord = Record<string, unknown>;

type EdgeSummary = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: CircuitEdgeType | null;
  direction: CircuitEdgeDirection | null;
};

type ComponentSummary = {
  componentId: string;
  nodeIds: string[];
  edgeIds: string[];
};

const NODE_TYPES = Object.values(CircuitNodeType);
const NODE_TYPE_SET = new Set<unknown>(NODE_TYPES);
const EDGE_TYPES = Object.values(CircuitEdgeType);
const EDGE_TYPE_SET = new Set<unknown>(EDGE_TYPES);
const BOUNDARY_TYPES = Object.values(CircuitBoundaryType);
const BOUNDARY_TYPE_SET = new Set<unknown>(BOUNDARY_TYPES);
const BOUNDARY_ROLES = Object.values(CircuitBoundaryRole);
const BOUNDARY_ROLE_SET = new Set<unknown>(BOUNDARY_ROLES);
const WARNING_CODES = Object.values(CircuitGraphWarningCode);
const WARNING_CODE_SET = new Set<unknown>(WARNING_CODES);
const DIRECTIONS = new Set<unknown>(["FORWARD", "UNDIRECTED"]);
const ELIGIBLE_COMPONENT_EDGE_TYPES = new Set<CircuitEdgeType>([
  CircuitEdgeType.CONNECTED,
  CircuitEdgeType.CONTROL,
  CircuitEdgeType.POWER,
  CircuitEdgeType.SIGNAL,
  CircuitEdgeType.GROUND,
]);
const EXPECTED_DIRECTION: Record<CircuitEdgeType, CircuitEdgeDirection> = {
  [CircuitEdgeType.CONNECTED]: "UNDIRECTED",
  [CircuitEdgeType.CONTAINS]: "FORWARD",
  [CircuitEdgeType.REFERENCE]: "FORWARD",
  [CircuitEdgeType.CONTROL]: "FORWARD",
  [CircuitEdgeType.POWER]: "FORWARD",
  [CircuitEdgeType.SIGNAL]: "FORWARD",
  [CircuitEdgeType.GROUND]: "UNDIRECTED",
};

const DOCUMENT_KEYS = [
  "schemaVersion",
  "graphId",
  "source",
  "sourceSha256",
  "page",
  "nodeCount",
  "edgeCount",
  "componentCount",
  "boundaryCount",
  "nodes",
  "edges",
  "components",
  "boundaries",
  "statistics",
  "warnings",
  "metadata",
];
const NODE_KEYS = [
  "nodeId",
  "objectIds",
  "nodeType",
  "displayName",
  "location",
  "attributes",
  "metadata",
];
const EDGE_KEYS = [
  "edgeId",
  "relationshipId",
  "sourceNodeId",
  "targetNodeId",
  "edgeType",
  "direction",
  "confidence",
  "attributes",
  "metadata",
];
const COMPONENT_KEYS = ["componentId", "nodeIds", "edgeIds", "metadata"];
const BOUNDARY_KEYS = [
  "boundaryId",
  "nodeId",
  "externalReferenceId",
  "boundaryType",
  "boundaryRole",
  "metadata",
];
const WARNING_KEYS = ["code", "message", "relatedIds", "metadata"];
const GRAPH_METADATA_KEYS = [
  "projectionProfile",
  "projectionProfileVersion",
  "objectDocumentSchemaVersion",
  "relationshipDocumentSchemaVersion",
];

function issueComparator(
  left: CircuitGraphValidationIssue,
  right: CircuitGraphValidationIssue,
): number {
  return (
    codepointCompare(left.code, right.code) ||
    codepointCompare(left.relatedId ?? "", right.relatedId ?? "") ||
    codepointCompare(left.message, right.message)
  );
}

function addIssue(
  issues: CircuitGraphValidationIssue[],
  code: string,
  message: string,
  relatedId: string | null = null,
): void {
  issues.push({ severity: "error", code, message, relatedId });
}

function asDataRecord(value: unknown): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }
    }
    return value as DataRecord;
  } catch {
    return null;
  }
}

function hasExactKeys(
  record: DataRecord,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(record, key))
  );
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length"))
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return false;
    }
  }
  return true;
}

function readCanonicalStringArray(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
  invalidCode: string,
  duplicateCode: string,
  noncanonicalCode: string,
  label: string,
  relatedId: string | null,
  allowEmpty: boolean,
): string[] {
  if (
    !isDenseArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0) ||
    (!allowEmpty && value.length === 0)
  ) {
    addIssue(
      issues,
      invalidCode,
      `${label} must contain non-empty strings`,
      relatedId,
    );
    return [];
  }
  const strings = value as string[];
  if (new Set(strings).size !== strings.length) {
    addIssue(
      issues,
      duplicateCode,
      `${label} must not contain duplicates`,
      relatedId,
    );
  }
  if (!isCanonicalUniqueStrings(strings, { allowEmpty })) {
    addIssue(issues, noncanonicalCode, `${label} must be canonical`, relatedId);
  }
  return strings;
}

function isId(value: unknown, prefix: string): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${prefix}[a-f0-9]{64}$`, "u").test(value)
  );
}

function validateJsonObject(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
  code: string,
  label: string,
  relatedId: string | null,
): void {
  if (!isCircuitJsonObject(value))
    addIssue(issues, code, `${label} must be JSON-safe`, relatedId);
}

function validateDetailsMetadata(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
  shapeCode: string,
  jsonCode: string,
  label: string,
  relatedId: string | null,
): DataRecord | null {
  const metadata = asDataRecord(value);
  if (metadata === null || !hasExactKeys(metadata, ["details"])) {
    addIssue(
      issues,
      shapeCode,
      `${label} metadata shape is invalid`,
      relatedId,
    );
    return null;
  }
  validateJsonObject(
    metadata.details,
    issues,
    jsonCode,
    `${label} metadata details`,
    relatedId,
  );
  return metadata;
}

function validateLocation(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
  nodeId: string,
): void {
  if (value === null) return;
  const location = asDataRecord(value);
  if (
    location === null ||
    !hasExactKeys(location, ["x", "y", "width", "height"]) ||
    ![location.x, location.y, location.width, location.height].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) ||
    (location.width as number) < 0 ||
    (location.height as number) < 0
  ) {
    addIssue(
      issues,
      "INVALID_NODE_LOCATION",
      "Node location must be a finite PageBBox",
      nodeId,
    );
  }
}

function validateNode(
  value: unknown,
  document: DataRecord,
  issues: CircuitGraphValidationIssue[],
): { nodeId: string; nodeType: CircuitNodeType | null } {
  const node = asDataRecord(value);
  if (node === null) {
    addIssue(
      issues,
      "INVALID_NODE_SHAPE",
      "Circuit node must be a data object",
    );
    return { nodeId: "", nodeType: null };
  }
  const nodeId = typeof node.nodeId === "string" ? node.nodeId : "";
  if (!hasExactKeys(node, NODE_KEYS)) {
    addIssue(
      issues,
      "INVALID_NODE_SHAPE",
      "Circuit node has invalid public fields",
      nodeId,
    );
  }
  if (!isId(node.nodeId, "cgn_")) {
    addIssue(issues, "INVALID_NODE_ID", "Circuit node ID is invalid", nodeId);
  }
  const objectIds = readCanonicalStringArray(
    node.objectIds,
    issues,
    "INVALID_NODE_OBJECT_IDS",
    "DUPLICATE_NODE_OBJECT_ID",
    "NONCANONICAL_NODE_OBJECT_IDS",
    "Node object IDs",
    nodeId,
    false,
  );
  const nodeType = NODE_TYPE_SET.has(node.nodeType)
    ? (node.nodeType as CircuitNodeType)
    : null;
  if (nodeType === null)
    addIssue(
      issues,
      "INVALID_NODE_TYPE",
      "Circuit node type is invalid",
      nodeId,
    );
  if (
    node.displayName !== null &&
    (typeof node.displayName !== "string" || node.displayName.length === 0)
  ) {
    addIssue(
      issues,
      "INVALID_NODE_DISPLAY_NAME",
      "Node displayName must be non-empty or null",
      nodeId,
    );
  }
  validateLocation(node.location, issues, nodeId);
  validateJsonObject(
    node.attributes,
    issues,
    "INVALID_NODE_ATTRIBUTES",
    "Node attributes",
    nodeId,
  );
  const metadata = asDataRecord(node.metadata);
  if (metadata === null || !hasExactKeys(metadata, ["role", "details"])) {
    addIssue(
      issues,
      "INVALID_NODE_METADATA",
      "Node metadata shape is invalid",
      nodeId,
    );
  } else {
    if (typeof metadata.role !== "string" || metadata.role.length === 0) {
      addIssue(issues, "INVALID_NODE_ROLE", "Node role is required", nodeId);
    }
    validateJsonObject(
      metadata.details,
      issues,
      "INVALID_NODE_METADATA",
      "Node metadata details",
      nodeId,
    );
    if (
      isId(node.nodeId, "cgn_") &&
      objectIds.length > 0 &&
      typeof metadata.role === "string" &&
      metadata.role.length > 0 &&
      typeof document.sourceSha256 === "string" &&
      typeof document.page === "number"
    ) {
      try {
        const expected = createCircuitNodeId({
          sourceSha256: document.sourceSha256,
          page: document.page,
          objectIds,
          nodeRole: metadata.role,
        });
        if (node.nodeId !== expected) {
          addIssue(
            issues,
            "NODE_ID_MISMATCH",
            "Node ID does not match canonical identity",
            nodeId,
          );
        }
      } catch {
        // Document identity issues are reported separately.
      }
    }
  }
  return { nodeId, nodeType };
}

function validateEdge(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
): EdgeSummary {
  const edge = asDataRecord(value);
  if (edge === null) {
    addIssue(
      issues,
      "INVALID_EDGE_SHAPE",
      "Circuit edge must be a data object",
    );
    return {
      edgeId: "",
      sourceNodeId: "",
      targetNodeId: "",
      edgeType: null,
      direction: null,
    };
  }
  const edgeId = typeof edge.edgeId === "string" ? edge.edgeId : "";
  if (!hasExactKeys(edge, EDGE_KEYS)) {
    addIssue(
      issues,
      "INVALID_EDGE_SHAPE",
      "Circuit edge has invalid public fields",
      edgeId,
    );
  }
  if (!isId(edge.edgeId, "cge_")) {
    addIssue(issues, "INVALID_EDGE_ID", "Circuit edge ID is invalid", edgeId);
  }
  if (
    typeof edge.relationshipId !== "string" ||
    edge.relationshipId.length === 0
  ) {
    addIssue(
      issues,
      "INVALID_EDGE_RELATIONSHIP_ID",
      "Edge relationshipId is required",
      edgeId,
    );
  }
  const sourceNodeId =
    typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : "";
  const targetNodeId =
    typeof edge.targetNodeId === "string" ? edge.targetNodeId : "";
  if (sourceNodeId.length === 0 || targetNodeId.length === 0) {
    addIssue(
      issues,
      "INVALID_EDGE_ENDPOINT",
      "Edge endpoints are required",
      edgeId,
    );
  }
  if (sourceNodeId.length > 0 && sourceNodeId === targetNodeId) {
    addIssue(issues, "SELF_EDGE", "Circuit self edges are not allowed", edgeId);
  }
  const edgeType = EDGE_TYPE_SET.has(edge.edgeType)
    ? (edge.edgeType as CircuitEdgeType)
    : null;
  if (edgeType === null)
    addIssue(
      issues,
      "INVALID_EDGE_TYPE",
      "Circuit edge type is invalid",
      edgeId,
    );
  const direction = DIRECTIONS.has(edge.direction)
    ? (edge.direction as CircuitEdgeDirection)
    : null;
  if (direction === null) {
    addIssue(
      issues,
      "INVALID_EDGE_DIRECTION",
      "Circuit edge direction is invalid",
      edgeId,
    );
  } else if (edgeType !== null && EXPECTED_DIRECTION[edgeType] !== direction) {
    addIssue(
      issues,
      "INVALID_EDGE_DIRECTION",
      `${edgeType} edges require ${EXPECTED_DIRECTION[edgeType]} direction`,
      edgeId,
    );
  }
  if (
    direction === "UNDIRECTED" &&
    codepointCompare(sourceNodeId, targetNodeId) > 0
  ) {
    addIssue(
      issues,
      "NONCANONICAL_UNDIRECTED_ENDPOINTS",
      "Undirected edge endpoints must use codepoint order",
      edgeId,
    );
  }
  if (
    typeof edge.confidence !== "number" ||
    !Number.isFinite(edge.confidence) ||
    edge.confidence < 0 ||
    edge.confidence > 1 ||
    Object.is(edge.confidence, -0)
  ) {
    addIssue(
      issues,
      "INVALID_EDGE_CONFIDENCE",
      "Edge confidence must be finite, non-negative zero, and within 0..1",
      edgeId,
    );
  }
  validateJsonObject(
    edge.attributes,
    issues,
    "INVALID_EDGE_ATTRIBUTES",
    "Edge attributes",
    edgeId,
  );
  const metadata = asDataRecord(edge.metadata);
  let segmentRole = "";
  if (
    metadata === null ||
    !hasExactKeys(metadata, ["segmentRole", "evidenceIds", "details"])
  ) {
    addIssue(
      issues,
      "INVALID_EDGE_METADATA",
      "Edge metadata shape is invalid",
      edgeId,
    );
  } else {
    segmentRole =
      typeof metadata.segmentRole === "string" ? metadata.segmentRole : "";
    if (segmentRole.length === 0) {
      addIssue(
        issues,
        "INVALID_EDGE_SEGMENT_ROLE",
        "Edge segmentRole is required",
        edgeId,
      );
    }
    readCanonicalStringArray(
      metadata.evidenceIds,
      issues,
      "INVALID_EVIDENCE_IDS",
      "DUPLICATE_EVIDENCE_ID",
      "NONCANONICAL_EVIDENCE_IDS",
      "Edge evidence IDs",
      edgeId,
      true,
    );
    validateJsonObject(
      metadata.details,
      issues,
      "INVALID_EDGE_METADATA",
      "Edge metadata details",
      edgeId,
    );
  }
  if (
    isId(edge.edgeId, "cge_") &&
    edgeType !== null &&
    direction !== null &&
    typeof edge.relationshipId === "string" &&
    edge.relationshipId.length > 0 &&
    sourceNodeId.length > 0 &&
    targetNodeId.length > 0 &&
    sourceNodeId !== targetNodeId &&
    segmentRole.length > 0
  ) {
    try {
      const expected = createCircuitEdgeId({
        relationshipId: edge.relationshipId,
        edgeType,
        direction,
        sourceNodeId,
        targetNodeId,
        segmentRole,
      });
      if (edge.edgeId !== expected) {
        addIssue(
          issues,
          "EDGE_ID_MISMATCH",
          "Edge ID does not match canonical identity",
          edgeId,
        );
      }
    } catch {
      // Shape issues are already reported.
    }
  }
  return { edgeId, sourceNodeId, targetNodeId, edgeType, direction };
}

function validateComponent(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
): ComponentSummary {
  const component = asDataRecord(value);
  if (component === null) {
    addIssue(
      issues,
      "INVALID_COMPONENT_SHAPE",
      "Circuit component must be a data object",
    );
    return { componentId: "", nodeIds: [], edgeIds: [] };
  }
  const componentId =
    typeof component.componentId === "string" ? component.componentId : "";
  if (!hasExactKeys(component, COMPONENT_KEYS)) {
    addIssue(
      issues,
      "INVALID_COMPONENT_SHAPE",
      "Circuit component has invalid public fields",
      componentId,
    );
  }
  if (!isId(component.componentId, "cgc_")) {
    addIssue(
      issues,
      "INVALID_COMPONENT_ID",
      "Circuit component ID is invalid",
      componentId,
    );
  }
  const nodeIds = readCanonicalStringArray(
    component.nodeIds,
    issues,
    "INVALID_COMPONENT_NODE_IDS",
    "DUPLICATE_COMPONENT_NODE_ID",
    "NONCANONICAL_COMPONENT_NODE_IDS",
    "Component node IDs",
    componentId,
    false,
  );
  const edgeIds = readCanonicalStringArray(
    component.edgeIds,
    issues,
    "INVALID_COMPONENT_EDGE_IDS",
    "DUPLICATE_COMPONENT_EDGE_ID",
    "NONCANONICAL_COMPONENT_EDGE_IDS",
    "Component edge IDs",
    componentId,
    true,
  );
  validateDetailsMetadata(
    component.metadata,
    issues,
    "INVALID_COMPONENT_METADATA",
    "INVALID_COMPONENT_METADATA",
    "Component",
    componentId,
  );
  if (isId(component.componentId, "cgc_") && nodeIds.length > 0) {
    try {
      const expected = createCircuitComponentId({ nodeIds, edgeIds });
      if (component.componentId !== expected) {
        addIssue(
          issues,
          "COMPONENT_ID_MISMATCH",
          "Component ID does not match canonical identity",
          componentId,
        );
      }
    } catch {
      // Shape issues are already reported.
    }
  }
  return { componentId, nodeIds, edgeIds };
}

function validateBoundary(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
): { boundaryId: string; nodeId: string } {
  const boundary = asDataRecord(value);
  if (boundary === null) {
    addIssue(
      issues,
      "INVALID_BOUNDARY_SHAPE",
      "Circuit boundary must be a data object",
    );
    return { boundaryId: "", nodeId: "" };
  }
  const boundaryId =
    typeof boundary.boundaryId === "string" ? boundary.boundaryId : "";
  const nodeId = typeof boundary.nodeId === "string" ? boundary.nodeId : "";
  if (!hasExactKeys(boundary, BOUNDARY_KEYS)) {
    addIssue(
      issues,
      "INVALID_BOUNDARY_SHAPE",
      "Circuit boundary has invalid public fields",
      boundaryId,
    );
  }
  if (!isId(boundary.boundaryId, "cgb_")) {
    addIssue(
      issues,
      "INVALID_BOUNDARY_ID",
      "Circuit boundary ID is invalid",
      boundaryId,
    );
  }
  if (
    nodeId.length === 0 ||
    typeof boundary.externalReferenceId !== "string" ||
    boundary.externalReferenceId.length === 0
  ) {
    addIssue(
      issues,
      "INVALID_BOUNDARY_REFERENCE",
      "Boundary references are required",
      boundaryId,
    );
  }
  const boundaryType = BOUNDARY_TYPE_SET.has(boundary.boundaryType)
    ? (boundary.boundaryType as CircuitBoundaryType)
    : null;
  const boundaryRole = BOUNDARY_ROLE_SET.has(boundary.boundaryRole)
    ? (boundary.boundaryRole as CircuitBoundaryRole)
    : null;
  if (boundaryType === null) {
    addIssue(
      issues,
      "INVALID_BOUNDARY_TYPE",
      "Boundary type is invalid",
      boundaryId,
    );
  }
  if (boundaryRole === null) {
    addIssue(
      issues,
      "INVALID_BOUNDARY_ROLE",
      "Boundary role is invalid",
      boundaryId,
    );
  }
  validateDetailsMetadata(
    boundary.metadata,
    issues,
    "INVALID_BOUNDARY_METADATA",
    "INVALID_BOUNDARY_METADATA",
    "Boundary",
    boundaryId,
  );
  if (
    isId(boundary.boundaryId, "cgb_") &&
    nodeId.length > 0 &&
    typeof boundary.externalReferenceId === "string" &&
    boundary.externalReferenceId.length > 0 &&
    boundaryType !== null &&
    boundaryRole !== null
  ) {
    const expected = createCircuitBoundaryId({
      nodeId,
      externalReferenceId: boundary.externalReferenceId,
      boundaryType,
      boundaryRole,
    });
    if (boundary.boundaryId !== expected) {
      addIssue(
        issues,
        "BOUNDARY_ID_MISMATCH",
        "Boundary ID does not match canonical identity",
        boundaryId,
      );
    }
  }
  return { boundaryId, nodeId };
}

function buildExpectedComponents(
  nodeIds: readonly string[],
  edges: readonly EdgeSummary[],
): Array<{ nodeIds: string[]; edgeIds: string[] }> {
  const nodeSet = new Set(nodeIds);
  const neighbors = new Map(
    nodeIds.map((nodeId) => [nodeId, new Set<string>()]),
  );
  const eligibleEdges = edges.filter(
    (edge) =>
      edge.edgeId.length > 0 &&
      edge.edgeType !== null &&
      ELIGIBLE_COMPONENT_EDGE_TYPES.has(edge.edgeType) &&
      nodeSet.has(edge.sourceNodeId) &&
      nodeSet.has(edge.targetNodeId) &&
      edge.sourceNodeId !== edge.targetNodeId,
  );
  for (const edge of eligibleEdges) {
    neighbors.get(edge.sourceNodeId)!.add(edge.targetNodeId);
    neighbors.get(edge.targetNodeId)!.add(edge.sourceNodeId);
  }
  const visited = new Set<string>();
  const components: Array<{ nodeIds: string[]; edgeIds: string[] }> = [];
  for (const start of [...nodeIds].sort(codepointCompare)) {
    if (visited.has(start)) continue;
    const pending = [start];
    const memberIds: string[] = [];
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      memberIds.push(current);
      pending.push(...[...neighbors.get(current)!].sort(codepointCompare));
    }
    memberIds.sort(codepointCompare);
    const members = new Set(memberIds);
    components.push({
      nodeIds: memberIds,
      edgeIds: eligibleEdges
        .filter(
          (edge) =>
            members.has(edge.sourceNodeId) && members.has(edge.targetNodeId),
        )
        .map(({ edgeId }) => edgeId)
        .sort(codepointCompare),
    });
  }
  return components.sort((left, right) =>
    codepointCompare(left.nodeIds[0]!, right.nodeIds[0]!),
  );
}

function validateComponentIntegrity(
  nodeIds: readonly string[],
  edges: readonly EdgeSummary[],
  components: readonly ComponentSummary[],
  issues: CircuitGraphValidationIssue[],
): { isolatedNodeCount: number; connectedComponentCount: number } {
  const nodeSet = new Set(nodeIds);
  const edgeById = new Map(edges.map((edge) => [edge.edgeId, edge]));
  const nodeMembership = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const edgeMembership = new Map(edges.map((edge) => [edge.edgeId, 0]));
  for (const component of components) {
    const members = new Set(component.nodeIds);
    for (const nodeId of component.nodeIds) {
      if (!nodeSet.has(nodeId)) {
        addIssue(
          issues,
          "DANGLING_COMPONENT_NODE_REFERENCE",
          "Component references an unknown node",
          component.componentId,
        );
      } else {
        nodeMembership.set(nodeId, nodeMembership.get(nodeId)! + 1);
      }
    }
    for (const edgeId of component.edgeIds) {
      const edge = edgeById.get(edgeId);
      if (edge === undefined) {
        addIssue(
          issues,
          "DANGLING_COMPONENT_EDGE_REFERENCE",
          "Component references an unknown edge",
          component.componentId,
        );
        continue;
      }
      edgeMembership.set(edgeId, edgeMembership.get(edgeId)! + 1);
      if (
        edge.edgeType === null ||
        !ELIGIBLE_COMPONENT_EDGE_TYPES.has(edge.edgeType)
      ) {
        addIssue(
          issues,
          "INELIGIBLE_COMPONENT_EDGE",
          "Component contains a non-connectivity edge",
          component.componentId,
        );
      }
      if (!members.has(edge.sourceNodeId) || !members.has(edge.targetNodeId)) {
        addIssue(
          issues,
          "COMPONENT_EDGE_ENDPOINT_MISMATCH",
          "Component edge endpoints must belong to the component",
          component.componentId,
        );
      }
    }
  }
  for (const [nodeId, count] of nodeMembership) {
    if (count === 0) {
      addIssue(
        issues,
        "MISSING_NODE_COMPONENT_MEMBERSHIP",
        "Every node must belong to one component",
        nodeId,
      );
    } else if (count > 1) {
      addIssue(
        issues,
        "DUPLICATE_NODE_COMPONENT_MEMBERSHIP",
        "A node cannot belong to multiple components",
        nodeId,
      );
    }
  }
  for (const edge of edges) {
    const count = edgeMembership.get(edge.edgeId) ?? 0;
    const eligible =
      edge.edgeType !== null &&
      ELIGIBLE_COMPONENT_EDGE_TYPES.has(edge.edgeType);
    if (eligible && count === 0) {
      addIssue(
        issues,
        "MISSING_EDGE_COMPONENT_MEMBERSHIP",
        "Every connectivity edge must belong to one component",
        edge.edgeId,
      );
    } else if (eligible && count > 1) {
      addIssue(
        issues,
        "DUPLICATE_EDGE_COMPONENT_MEMBERSHIP",
        "A connectivity edge cannot belong to multiple components",
        edge.edgeId,
      );
    } else if (!eligible && count > 0) {
      addIssue(
        issues,
        "INELIGIBLE_COMPONENT_EDGE",
        "Non-connectivity edges cannot belong to components",
        edge.edgeId,
      );
    }
  }

  const expected = buildExpectedComponents(nodeIds, edges);
  const actualSignatures = components
    .map(({ nodeIds: nodes, edgeIds: componentEdges }) =>
      JSON.stringify({ nodeIds: nodes, edgeIds: componentEdges }),
    )
    .sort(codepointCompare);
  const expectedSignatures = expected
    .map((component) => JSON.stringify(component))
    .sort(codepointCompare);
  if (JSON.stringify(actualSignatures) !== JSON.stringify(expectedSignatures)) {
    addIssue(
      issues,
      "COMPONENT_PARTITION_MISMATCH",
      "Components do not match connectivity-derived partition",
    );
  }
  return {
    isolatedNodeCount: expected.filter(
      (component) =>
        component.nodeIds.length === 1 && component.edgeIds.length === 0,
    ).length,
    connectedComponentCount: expected.length,
  };
}

function hasContainmentCycle(
  nodeIds: readonly string[],
  edges: readonly EdgeSummary[],
): boolean {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) {
    if (
      edge.edgeType === CircuitEdgeType.CONTAINS &&
      edge.direction === "FORWARD" &&
      adjacency.has(edge.sourceNodeId) &&
      adjacency.has(edge.targetNodeId)
    ) {
      adjacency.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map<string, number>();
  for (const startNodeId of nodeIds) {
    if ((state.get(startNodeId) ?? WHITE) !== WHITE) continue;
    state.set(startNodeId, GRAY);
    const stack = [
      {
        nodeId: startNodeId,
        nextNeighborIndex: 0,
      },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = adjacency.get(frame.nodeId) ?? [];
      if (frame.nextNeighborIndex >= neighbors.length) {
        state.set(frame.nodeId, BLACK);
        stack.pop();
        continue;
      }
      const targetNodeId = neighbors[frame.nextNeighborIndex]!;
      frame.nextNeighborIndex += 1;
      const targetState = state.get(targetNodeId) ?? WHITE;
      if (targetState === GRAY) return true;
      if (targetState === BLACK) continue;
      state.set(targetNodeId, GRAY);
      stack.push({ nodeId: targetNodeId, nextNeighborIndex: 0 });
    }
  }
  return false;
}

function validateStatistics(
  value: unknown,
  nodes: readonly { nodeType: CircuitNodeType | null }[],
  edges: readonly EdgeSummary[],
  derived: { isolatedNodeCount: number; connectedComponentCount: number },
  issues: CircuitGraphValidationIssue[],
): void {
  const statistics = asDataRecord(value);
  if (
    statistics === null ||
    !hasExactKeys(statistics, [
      "nodeTypeCounts",
      "edgeTypeCounts",
      "isolatedNodeCount",
      "connectedComponentCount",
    ])
  ) {
    addIssue(
      issues,
      "INVALID_STATISTICS_SHAPE",
      "Circuit graph statistics shape is invalid",
    );
    return;
  }
  const nodeCounts = asDataRecord(statistics.nodeTypeCounts);
  if (nodeCounts === null || !hasExactKeys(nodeCounts, NODE_TYPES)) {
    addIssue(
      issues,
      "NODE_TYPE_COUNTS_MISMATCH",
      "nodeTypeCounts shape is invalid",
    );
  } else {
    const invalidType = NODE_TYPES.find((type) => {
      const value = nodeCounts[type];
      const expected = nodes.filter((node) => node.nodeType === type).length;
      return (
        !Number.isInteger(value) || Object.is(value, -0) || value !== expected
      );
    });
    if (invalidType !== undefined) {
      addIssue(
        issues,
        "NODE_TYPE_COUNTS_MISMATCH",
        "nodeTypeCounts do not match nodes",
        `statistics.nodeTypeCounts.${invalidType}`,
      );
    }
  }
  const edgeCounts = asDataRecord(statistics.edgeTypeCounts);
  if (edgeCounts === null || !hasExactKeys(edgeCounts, EDGE_TYPES)) {
    addIssue(
      issues,
      "EDGE_TYPE_COUNTS_MISMATCH",
      "edgeTypeCounts shape is invalid",
    );
  } else {
    const invalidType = EDGE_TYPES.find((type) => {
      const value = edgeCounts[type];
      const expected = edges.filter((edge) => edge.edgeType === type).length;
      return (
        !Number.isInteger(value) || Object.is(value, -0) || value !== expected
      );
    });
    if (invalidType !== undefined) {
      addIssue(
        issues,
        "EDGE_TYPE_COUNTS_MISMATCH",
        "edgeTypeCounts do not match edges",
        `statistics.edgeTypeCounts.${invalidType}`,
      );
    }
  }
  if (
    !Number.isInteger(statistics.isolatedNodeCount) ||
    Object.is(statistics.isolatedNodeCount, -0) ||
    statistics.isolatedNodeCount !== derived.isolatedNodeCount
  ) {
    addIssue(
      issues,
      "ISOLATED_NODE_COUNT_MISMATCH",
      "isolatedNodeCount does not match component partition",
      "statistics.isolatedNodeCount",
    );
  }
  if (
    !Number.isInteger(statistics.connectedComponentCount) ||
    Object.is(statistics.connectedComponentCount, -0) ||
    statistics.connectedComponentCount !== derived.connectedComponentCount
  ) {
    addIssue(
      issues,
      "CONNECTED_COMPONENT_COUNT_MISMATCH",
      "connectedComponentCount does not match component partition",
      "statistics.connectedComponentCount",
    );
  }
}

function comparableString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compareStringArrays(left: unknown, right: unknown): number {
  const leftValues = Array.isArray(left) ? left : [];
  const rightValues = Array.isArray(right) ? right : [];
  const sharedLength = Math.min(leftValues.length, rightValues.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = codepointCompare(
      comparableString(leftValues[index]),
      comparableString(rightValues[index]),
    );
    if (comparison !== 0) return comparison;
  }
  return leftValues.length - rightValues.length;
}

function canonicalMetadataKey(value: unknown): string {
  return isCircuitJsonObject(value)
    ? JSON.stringify(canonicalizeCircuitJsonValue(value))
    : "";
}

function warningComparator(left: DataRecord, right: DataRecord): number {
  return (
    codepointCompare(
      comparableString(left.code),
      comparableString(right.code),
    ) ||
    compareStringArrays(left.relatedIds, right.relatedIds) ||
    codepointCompare(
      comparableString(left.message),
      comparableString(right.message),
    ) ||
    codepointCompare(
      canonicalMetadataKey(left.metadata),
      canonicalMetadataKey(right.metadata),
    )
  );
}

function validateWarnings(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
): void {
  if (!isDenseArray(value)) {
    addIssue(issues, "INVALID_WARNINGS", "Warnings must be a dense array");
    return;
  }
  const records: DataRecord[] = [];
  for (const warningValue of value) {
    const warning = asDataRecord(warningValue);
    if (warning === null || !hasExactKeys(warning, WARNING_KEYS)) {
      addIssue(
        issues,
        "INVALID_WARNING_SHAPE",
        "Circuit warning shape is invalid",
      );
      continue;
    }
    records.push(warning);
    if (!WARNING_CODE_SET.has(warning.code)) {
      addIssue(
        issues,
        "INVALID_WARNING_CODE",
        "Circuit warning code is invalid",
      );
    }
    if (typeof warning.message !== "string" || warning.message.length === 0) {
      addIssue(
        issues,
        "INVALID_WARNING_MESSAGE",
        "Circuit warning message is required",
      );
    }
    readCanonicalStringArray(
      warning.relatedIds,
      issues,
      "INVALID_WARNING_RELATED_IDS",
      "DUPLICATE_WARNING_RELATED_ID",
      "NONCANONICAL_WARNING_RELATED_IDS",
      "Warning related IDs",
      null,
      true,
    );
    validateJsonObject(
      warning.metadata,
      issues,
      "INVALID_WARNING_METADATA",
      "Warning metadata",
      null,
    );
  }
  const expected = [...records].sort(warningComparator);
  if (expected.some((warning, index) => warning !== records[index])) {
    addIssue(
      issues,
      "NONCANONICAL_WARNINGS",
      "Warnings must use canonical ordering",
    );
  }
  for (let index = 1; index < expected.length; index += 1) {
    if (warningComparator(expected[index - 1]!, expected[index]!) === 0) {
      addIssue(
        issues,
        "DUPLICATE_WARNING",
        "Warnings must not contain canonical duplicates",
      );
    }
  }
}

function validateMetadata(
  value: unknown,
  issues: CircuitGraphValidationIssue[],
): DataRecord | null {
  const metadata = asDataRecord(value);
  if (metadata === null || !hasExactKeys(metadata, GRAPH_METADATA_KEYS)) {
    addIssue(
      issues,
      "INVALID_GRAPH_METADATA",
      "Circuit graph metadata shape is invalid",
    );
    return null;
  }
  if (
    typeof metadata.projectionProfile !== "string" ||
    metadata.projectionProfile.length === 0
  ) {
    addIssue(
      issues,
      "INVALID_PROJECTION_PROFILE",
      "projectionProfile is required",
    );
  }
  for (const field of [
    "projectionProfileVersion",
    "objectDocumentSchemaVersion",
    "relationshipDocumentSchemaVersion",
  ] as const) {
    if (!Number.isInteger(metadata[field]) || (metadata[field] as number) < 1) {
      addIssue(
        issues,
        "INVALID_GRAPH_METADATA",
        `${field} must be a positive integer`,
      );
    }
  }
  return metadata;
}

function addDuplicateIssue(
  ids: readonly string[],
  issues: CircuitGraphValidationIssue[],
  code: string,
  label: string,
): void {
  if (
    new Set(ids.filter((id) => id.length > 0)).size !==
    ids.filter((id) => id.length > 0).length
  ) {
    addIssue(issues, code, `${label} IDs must be unique`);
  }
}

function validateCanonicalRecordOrder<T extends DataRecord>(
  records: readonly T[],
  idField: string,
  issues: CircuitGraphValidationIssue[],
  code: string,
  label: string,
): void {
  const sorted = [...records].sort((left, right) =>
    codepointCompare(String(left[idField] ?? ""), String(right[idField] ?? "")),
  );
  if (sorted.some((record, index) => record !== records[index])) {
    addIssue(issues, code, `${label} must use canonical ordering`);
  }
}

export function validateCircuitGraphDocument(
  documentValue: unknown,
): CircuitGraphValidationResult {
  const issues: CircuitGraphValidationIssue[] = [];
  const document = asDataRecord(documentValue);
  if (document === null) {
    addIssue(
      issues,
      "INVALID_DOCUMENT_SHAPE",
      "Circuit graph document must be a data object",
    );
    return { valid: false, issues };
  }
  if (!hasExactKeys(document, DOCUMENT_KEYS)) {
    addIssue(
      issues,
      "INVALID_DOCUMENT_SHAPE",
      "Circuit graph document has invalid public fields",
    );
  }
  if (document.schemaVersion !== 1) {
    addIssue(issues, "INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  }
  if (!isId(document.graphId, "cgg_")) {
    addIssue(issues, "INVALID_GRAPH_ID", "graphId is invalid");
  }
  if (
    typeof document.source !== "string" ||
    document.source.trim().length === 0
  ) {
    addIssue(issues, "INVALID_SOURCE", "source is required");
  }
  if (
    typeof document.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(document.sourceSha256)
  ) {
    addIssue(
      issues,
      "INVALID_SOURCE_SHA256",
      "sourceSha256 must be 64 lowercase hex characters",
    );
  }
  if (!Number.isInteger(document.page) || (document.page as number) < 1) {
    addIssue(issues, "INVALID_PAGE", "page must be a positive integer");
  }

  const nodeValues = isDenseArray(document.nodes) ? document.nodes : [];
  const edgeValues = isDenseArray(document.edges) ? document.edges : [];
  const componentValues = isDenseArray(document.components)
    ? document.components
    : [];
  const boundaryValues = isDenseArray(document.boundaries)
    ? document.boundaries
    : [];
  if (!isDenseArray(document.nodes))
    addIssue(issues, "INVALID_NODES", "nodes must be a dense array");
  if (!isDenseArray(document.edges))
    addIssue(issues, "INVALID_EDGES", "edges must be a dense array");
  if (!isDenseArray(document.components)) {
    addIssue(issues, "INVALID_COMPONENTS", "components must be a dense array");
  }
  if (!isDenseArray(document.boundaries)) {
    addIssue(issues, "INVALID_BOUNDARIES", "boundaries must be a dense array");
  }

  const nodes = nodeValues.map((value) =>
    validateNode(value, document, issues),
  );
  const edges = edgeValues.map((value) => validateEdge(value, issues));
  const components = componentValues.map((value) =>
    validateComponent(value, issues),
  );
  const boundaries = boundaryValues.map((value) =>
    validateBoundary(value, issues),
  );
  const nodeIds = nodes
    .map(({ nodeId }) => nodeId)
    .filter((id) => id.length > 0);
  const edgeIds = edges
    .map(({ edgeId }) => edgeId)
    .filter((id) => id.length > 0);
  const componentIds = components
    .map(({ componentId }) => componentId)
    .filter((id) => id.length > 0);
  const boundaryIds = boundaries
    .map(({ boundaryId }) => boundaryId)
    .filter((id) => id.length > 0);
  addDuplicateIssue(nodeIds, issues, "DUPLICATE_NODE_ID", "Node");
  addDuplicateIssue(edgeIds, issues, "DUPLICATE_EDGE_ID", "Edge");
  addDuplicateIssue(
    componentIds,
    issues,
    "DUPLICATE_COMPONENT_ID",
    "Component",
  );
  addDuplicateIssue(boundaryIds, issues, "DUPLICATE_BOUNDARY_ID", "Boundary");

  validateCanonicalRecordOrder(
    nodeValues.filter(
      (value): value is DataRecord => asDataRecord(value) !== null,
    ) as DataRecord[],
    "nodeId",
    issues,
    "NONCANONICAL_NODES",
    "Nodes",
  );
  validateCanonicalRecordOrder(
    edgeValues.filter(
      (value): value is DataRecord => asDataRecord(value) !== null,
    ) as DataRecord[],
    "edgeId",
    issues,
    "NONCANONICAL_EDGES",
    "Edges",
  );
  validateCanonicalRecordOrder(
    componentValues.filter(
      (value): value is DataRecord => asDataRecord(value) !== null,
    ) as DataRecord[],
    "componentId",
    issues,
    "NONCANONICAL_COMPONENTS",
    "Components",
  );
  validateCanonicalRecordOrder(
    boundaryValues.filter(
      (value): value is DataRecord => asDataRecord(value) !== null,
    ) as DataRecord[],
    "boundaryId",
    issues,
    "NONCANONICAL_BOUNDARIES",
    "Boundaries",
  );

  const nodeSet = new Set(nodeIds);
  for (const edge of edges) {
    if (!nodeSet.has(edge.sourceNodeId) || !nodeSet.has(edge.targetNodeId)) {
      addIssue(
        issues,
        "DANGLING_EDGE_NODE_REFERENCE",
        "Circuit edge references an unknown node",
        edge.edgeId,
      );
    }
  }
  for (const boundary of boundaries) {
    if (!nodeSet.has(boundary.nodeId)) {
      addIssue(
        issues,
        "DANGLING_BOUNDARY_NODE_REFERENCE",
        "Circuit boundary references an unknown node",
        boundary.boundaryId,
      );
    }
  }

  const derivedComponents = validateComponentIntegrity(
    nodeIds,
    edges,
    components,
    issues,
  );
  if (hasContainmentCycle(nodeIds, edges)) {
    addIssue(issues, "CONTAINMENT_CYCLE", "CONTAINS edges must be acyclic");
  }

  for (const [field, values, code] of [
    ["nodeCount", nodeValues, "NODE_COUNT_MISMATCH"],
    ["edgeCount", edgeValues, "EDGE_COUNT_MISMATCH"],
    ["componentCount", componentValues, "COMPONENT_COUNT_MISMATCH"],
    ["boundaryCount", boundaryValues, "BOUNDARY_COUNT_MISMATCH"],
  ] as const) {
    if (
      !Number.isInteger(document[field]) ||
      document[field] !== values.length
    ) {
      addIssue(issues, code, `${field} does not match its collection`);
    }
  }

  validateStatistics(
    document.statistics,
    nodes,
    edges,
    derivedComponents,
    issues,
  );
  validateWarnings(document.warnings, issues);
  const metadata = validateMetadata(document.metadata, issues);

  if (
    isId(document.graphId, "cgg_") &&
    document.schemaVersion === 1 &&
    typeof document.source === "string" &&
    document.source.length > 0 &&
    typeof document.sourceSha256 === "string" &&
    typeof document.page === "number" &&
    metadata !== null &&
    typeof metadata.projectionProfile === "string" &&
    typeof metadata.projectionProfileVersion === "number"
  ) {
    try {
      const expected = createCircuitGraphId({
        schemaVersion: 1,
        projectionProfile: metadata.projectionProfile,
        projectionProfileVersion: metadata.projectionProfileVersion,
        source: document.source,
        sourceSha256: document.sourceSha256,
        page: document.page,
        nodeIds,
        edgeIds,
        componentIds,
        boundaryIds,
      });
      if (document.graphId !== expected) {
        addIssue(
          issues,
          "GRAPH_ID_MISMATCH",
          "graphId does not match canonical identity",
        );
      }
    } catch {
      // Identity field issues are already reported.
    }
  }

  issues.sort(issueComparator);
  return { valid: issues.length === 0, issues };
}

export function assertValidCircuitGraphDocument(
  documentValue: unknown,
): asserts documentValue is CircuitGraphDocument {
  const result = validateCircuitGraphDocument(documentValue);
  if (!result.valid) {
    throw new Error(
      result.issues
        .map(({ code, message }) => `${code}: ${message}`)
        .join("; "),
    );
  }
}

export function parseCircuitGraphDocument(
  documentValue: unknown,
): CircuitGraphDocument {
  assertValidCircuitGraphDocument(documentValue);
  return deepFreezeCircuitValue(structuredClone(documentValue));
}
