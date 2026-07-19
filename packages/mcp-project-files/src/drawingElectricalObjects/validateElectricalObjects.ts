import { computeElectricalConfidence, electricalObjectStatus } from "./confidence.js";
import { codepointCompare } from "./objectIdentity.js";
import type {
  ConstructionGraphEdgeType,
  DrawingElectricalObjectDocument,
  ElectricalObject,
  ElectricalObjectType,
} from "./types.js";

export type ElectricalValidationIssueSeverity = "error" | "warning";

export type ElectricalValidationIssue = {
  severity: ElectricalValidationIssueSeverity;
  code: string;
  message: string;
  objectId: string | null;
  relationId: string | null;
  source: string | null;
  diagnostics: Record<string, unknown>;
};

export type ElectricalValidationResult = {
  valid: boolean;
  issues: ElectricalValidationIssue[];
};

const OBJECT_TYPES = new Set<ElectricalObjectType>([
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
]);

const EDGE_TYPES = new Set<ConstructionGraphEdgeType>([
  "bbox-touch",
  "endpoint-contact",
  "shared-primitive",
  "spatial-adjacent",
]);

const COMMON_ATTRIBUTE_NAMES = [
  "name",
  "tag",
  "phase",
  "capacity",
  "circuit",
  "voltage",
  "remarks",
] as const;

type IssueContext = {
  objectId?: string;
  relationId?: string;
  diagnostics?: Record<string, unknown>;
};

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(codepointCompare);
}

function isCanonicalUnique(values: readonly string[]): boolean {
  const expected = canonicalStrings(values);
  return new Set(values).size === values.length &&
    expected.every((value, index) => value === values[index]);
}

function issueComparator(
  left: ElectricalValidationIssue,
  right: ElectricalValidationIssue,
): number {
  const severityRank = { error: 0, warning: 1 } as const;
  return severityRank[left.severity] - severityRank[right.severity] ||
    codepointCompare(left.code, right.code) ||
    codepointCompare(left.objectId ?? "", right.objectId ?? "") ||
    codepointCompare(left.relationId ?? "", right.relationId ?? "") ||
    codepointCompare(left.message, right.message);
}

function sourceOf(document: Partial<DrawingElectricalObjectDocument>): string | null {
  return typeof document.source === "string" && document.source.length > 0
    ? document.source
    : null;
}

function addIssue(
  issues: ElectricalValidationIssue[],
  document: Partial<DrawingElectricalObjectDocument>,
  code: string,
  message: string,
  context: IssueContext = {},
): void {
  issues.push({
    severity: "error",
    code,
    message,
    objectId: context.objectId ?? null,
    relationId: context.relationId ?? null,
    source: sourceOf(document),
    diagnostics: context.diagnostics ? { ...context.diagnostics } : {},
  });
}

function validateStringIds(
  values: unknown,
  label: string,
  issues: ElectricalValidationIssue[],
  document: Partial<DrawingElectricalObjectDocument>,
  context: IssueContext = {},
): string[] {
  if (!Array.isArray(values) ||
      !values.every((value) => typeof value === "string" && value.length > 0)) {
    addIssue(issues, document, `INVALID_${label}_IDS`, `${label} IDs are invalid`, context);
    return [];
  }
  if (!isCanonicalUnique(values)) {
    addIssue(
      issues,
      document,
      `NON_CANONICAL_${label}_IDS`,
      `${label} IDs must be canonical and contain no duplicates`,
      context,
    );
  }
  return values;
}

function connectedComponents(
  nodeIds: readonly string[],
  edges: readonly (readonly [string, string])[],
): string[][] {
  const canonicalNodeIds = canonicalStrings([...new Set(nodeIds)]);
  const adjacency = new Map(
    canonicalNodeIds.map((nodeId) => [nodeId, new Set<string>()]),
  );
  for (const [left, right] of edges) {
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const startNodeId of canonicalNodeIds) {
    if (visited.has(startNodeId)) continue;
    const pending = [startNodeId];
    const members: string[] = [];
    for (let index = 0; index < pending.length; index += 1) {
      const nodeId = pending[index]!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      members.push(nodeId);
      const neighbors = canonicalStrings([...(adjacency.get(nodeId) ?? [])]);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) pending.push(neighbor);
      }
    }
    members.sort(codepointCompare);
    components.push(members);
  }
  return components;
}

function canonicalPartitions(
  partitions: readonly (readonly string[])[],
): string[][] {
  return partitions
    .map((members) => canonicalStrings([...new Set(members)]))
    .sort((left, right) =>
      codepointCompare(left[0] ?? "", right[0] ?? "") ||
      codepointCompare(JSON.stringify(left), JSON.stringify(right))
    );
}

function validateBBox(
  value: unknown,
  issues: ElectricalValidationIssue[],
  document: Partial<DrawingElectricalObjectDocument>,
  objectId: string,
): void {
  if (typeof value !== "object" || value === null) {
    addIssue(issues, document, "INVALID_OBJECT_BBOX", "Object bbox is required", { objectId });
    return;
  }
  const bbox = value as Record<string, unknown>;
  for (const key of ["x", "y", "width", "height"] as const) {
    const coordinate = bbox[key];
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
      addIssue(
        issues,
        document,
        "NON_FINITE_OBJECT_BBOX",
        `Object bbox ${key} must be finite`,
        { objectId },
      );
    } else if (Object.is(coordinate, -0)) {
      addIssue(
        issues,
        document,
        "NEGATIVE_ZERO_OBJECT_BBOX",
        `Object bbox ${key} must not contain negative zero`,
        { objectId },
      );
    }
  }
  if (
    typeof bbox.width === "number" && bbox.width < 0 ||
    typeof bbox.height === "number" && bbox.height < 0
  ) {
    addIssue(issues, document, "INVALID_OBJECT_BBOX", "Object bbox size is invalid", {
      objectId,
    });
  }
}

function validateAttribute(
  value: unknown,
  name: string,
  requiredValue: boolean,
  issues: ElectricalValidationIssue[],
  document: Partial<DrawingElectricalObjectDocument>,
  objectId: string,
  knownRelationIds: Set<string>,
): void {
  if (value === null) {
    if (requiredValue) {
      addIssue(
        issues,
        document,
        "MISSING_REQUIRED_ATTRIBUTE",
        `Required attribute ${name} is missing`,
        { objectId },
      );
    }
    return;
  }
  if (value === undefined || typeof value !== "object") {
    addIssue(issues, document, "INVALID_ATTRIBUTE", `Attribute ${name} is invalid`, {
      objectId,
    });
    return;
  }
  const attribute = value as Record<string, unknown>;
  if (typeof attribute.value !== "string" || typeof attribute.rawText !== "string") {
    addIssue(issues, document, "INVALID_ATTRIBUTE", `Attribute ${name} value is invalid`, {
      objectId,
    });
  }
  if (
    typeof attribute.confidence !== "number" ||
    !Number.isFinite(attribute.confidence) ||
    attribute.confidence < 0 ||
    attribute.confidence > 1
  ) {
    addIssue(
      issues,
      document,
      "INVALID_ATTRIBUTE_CONFIDENCE",
      `Attribute ${name} confidence must be finite and within range`,
      { objectId },
    );
  }
  const textEntityIds = validateStringIds(
    attribute.textEntityIds,
    "ATTRIBUTE_TEXT_ENTITY",
    issues,
    document,
    { objectId },
  );
  if (textEntityIds.length === 0) {
    addIssue(
      issues,
      document,
      "MISSING_ATTRIBUTE_PROVENANCE",
      `Attribute ${name} provenance requires a text entity`,
      { objectId },
    );
  }
  const sourceRelationIds = validateStringIds(
    attribute.sourceRelationIds,
    "ATTRIBUTE_RELATION",
    issues,
    document,
    { objectId },
  );
  for (const relationId of sourceRelationIds) knownRelationIds.add(relationId);
  if (
    typeof attribute.parserRuleId !== "string" ||
    attribute.parserRuleId.trim().length === 0
  ) {
    addIssue(
      issues,
      document,
      "MISSING_ATTRIBUTE_PARSER_RULE",
      `Attribute ${name} parserRuleId provenance is required`,
      { objectId },
    );
  }
}

function requiredAttributeNames(type: ElectricalObjectType): readonly string[] {
  if (type === "unknown") return ["name", "tag", "remarks"];
  if (type === "breaker") {
    return [
      ...COMMON_ATTRIBUTE_NAMES,
      "rating",
      "breakerKind",
      "poles",
      "frameAmpere",
      "tripAmpere",
    ];
  }
  if (type === "panel" || type === "transformer" || type === "cable") {
    return [...COMMON_ATTRIBUTE_NAMES, "rating"];
  }
  return COMMON_ATTRIBUTE_NAMES;
}

function validateObject(
  value: unknown,
  issues: ElectricalValidationIssue[],
  document: Partial<DrawingElectricalObjectDocument>,
  primitiveOwners: Map<string, string>,
  knownRelationIds: Set<string>,
): void {
  if (typeof value !== "object" || value === null) {
    addIssue(issues, document, "INVALID_OBJECT", "Electrical object is invalid");
    return;
  }
  const object = value as Partial<ElectricalObject> & Record<string, unknown>;
  const objectId = typeof object.id === "string" ? object.id : "";
  if (objectId.length === 0) {
    addIssue(issues, document, "INVALID_OBJECT_ID", "Electrical object ID is required");
  }
  if (typeof object.type !== "string" || !OBJECT_TYPES.has(object.type as ElectricalObjectType)) {
    addIssue(issues, document, "INVALID_OBJECT_TYPE", "Electrical object type is invalid", {
      objectId,
    });
    return;
  }
  const objectType = object.type as ElectricalObjectType;
  if (object.status !== "accepted" && object.status !== "review") {
    addIssue(issues, document, "INVALID_OBJECT_STATUS", "Electrical object status is invalid", {
      objectId,
    });
  }
  if (
    typeof object.confidence !== "number" ||
    !Number.isFinite(object.confidence) ||
    object.confidence < 0 ||
    object.confidence > 1
  ) {
    addIssue(
      issues,
      document,
      "INVALID_OBJECT_CONFIDENCE",
      "Electrical object confidence must be finite and within range",
      { objectId },
    );
  }
  validateBBox(object.bbox, issues, document, objectId);
  const primitiveIds = validateStringIds(
    object.primitiveIds,
    "OBJECT_PRIMITIVE",
    issues,
    document,
    { objectId },
  );
  for (const primitiveId of primitiveIds) {
    const owner = primitiveOwners.get(primitiveId);
    if (owner !== undefined && owner !== objectId) {
      addIssue(
        issues,
        document,
        "DUPLICATE_PRIMITIVE_OWNERSHIP",
        `Primitive ${primitiveId} has duplicate object ownership`,
        { objectId, diagnostics: { owner } },
      );
    } else {
      primitiveOwners.set(primitiveId, objectId);
    }
  }
  const relationIds = validateStringIds(
    object.sourceRelationIds,
    "OBJECT_RELATION",
    issues,
    document,
    { objectId },
  );
  for (const relationId of relationIds) knownRelationIds.add(relationId);

  if (!Array.isArray(object.labels)) {
    addIssue(issues, document, "INVALID_OBJECT_LABELS", "Object labels must be an array", {
      objectId,
    });
  } else {
    const labelKeys: string[] = [];
    for (const label of object.labels) {
      if (
        typeof label !== "object" || label === null ||
        !["item", "line"].includes(String(Reflect.get(label, "textEntityType"))) ||
        typeof Reflect.get(label, "textEntityId") !== "string" ||
        typeof Reflect.get(label, "role") !== "string"
      ) {
        addIssue(issues, document, "INVALID_OBJECT_LABEL", "Object label is invalid", {
          objectId,
        });
        continue;
      }
      labelKeys.push(
        `${Reflect.get(label, "textEntityId")}\u0000${Reflect.get(label, "textEntityType")}\u0000${Reflect.get(label, "role")}`,
      );
    }
    if (!isCanonicalUnique(labelKeys)) {
      addIssue(
        issues,
        document,
        "NON_CANONICAL_OBJECT_LABELS",
        "Object labels must be canonical and contain no duplicates",
        { objectId },
      );
    }
  }

  if (typeof object.attributes !== "object" || object.attributes === null) {
    addIssue(issues, document, "INVALID_OBJECT_ATTRIBUTES", "Object attributes are required", {
      objectId,
    });
  } else {
    const attributes = object.attributes as Record<string, unknown>;
    for (const name of requiredAttributeNames(objectType)) {
      if (!Object.hasOwn(attributes, name)) {
        addIssue(
          issues,
          document,
          "MISSING_ATTRIBUTE_FIELD",
          `Required attribute field ${name} is missing`,
          { objectId },
        );
        continue;
      }
      validateAttribute(
        attributes[name],
        name,
        objectType === "breaker" && name === "breakerKind",
        issues,
        document,
        objectId,
        knownRelationIds,
      );
    }
  }

  const diagnostics = object.diagnostics;
  if (typeof diagnostics !== "object" || diagnostics === null) {
    addIssue(issues, document, "INVALID_OBJECT_DIAGNOSTICS", "Object diagnostics are required", {
      objectId,
    });
    return;
  }
  const ruleId = Reflect.get(diagnostics, "ruleId");
  if (typeof ruleId !== "string") {
    addIssue(
      issues,
      document,
      "INVALID_DIAGNOSTICS_RULE_ID",
      "Object diagnostics ruleId must be a string",
      { objectId },
    );
  }
  const conflicts = Reflect.get(diagnostics, "conflicts");
  if (!Array.isArray(conflicts)) {
    addIssue(
      issues,
      document,
      "INVALID_DIAGNOSTICS_CONFLICTS",
      "Object diagnostics conflicts must be an array",
      { objectId },
    );
  } else {
    for (const [index, conflict] of conflicts.entries()) {
      if (
        typeof conflict !== "object" ||
        conflict === null ||
        Array.isArray(conflict)
      ) {
        addIssue(
          issues,
          document,
          "INVALID_DIAGNOSTICS_CONFLICT",
          `Object diagnostics conflict at index ${index} must be an object`,
          { objectId },
        );
      }
    }
  }
  const components = Reflect.get(diagnostics, "confidenceComponents");
  if (typeof components !== "object" || components === null) {
    addIssue(
      issues,
      document,
      "INVALID_CONFIDENCE_COMPONENTS",
      "Object confidence components are required",
      { objectId },
    );
    return;
  }
  try {
    const result = computeElectricalConfidence(components as Parameters<
      typeof computeElectricalConfidence
    >[0]);
    if (
      typeof object.confidence === "number" &&
      Number.isFinite(object.confidence) &&
      (object.confidence !== result.confidence || Object.is(object.confidence, -0))
    ) {
      addIssue(
        issues,
        document,
        "OBJECT_CONFIDENCE_VALUE_MISMATCH",
        "Object confidence does not match canonical confidence diagnostics",
        {
          objectId,
          diagnostics: {
            actualConfidence: object.confidence,
            expectedConfidence: result.confidence,
          },
        },
      );
    }
    const expectedStatus = electricalObjectStatus(result.rawConfidence);
    if (expectedStatus !== object.status) {
      addIssue(
        issues,
        document,
        "OBJECT_STATUS_CONFIDENCE_MISMATCH",
        "Object status is inconsistent with raw confidence diagnostics",
        { objectId },
      );
    }
  } catch {
    addIssue(
      issues,
      document,
      "INVALID_CONFIDENCE_COMPONENTS",
      "Object confidence components must be finite and within range",
      { objectId },
    );
  }
}

function validateGraph(
  value: unknown,
  objectIds: readonly string[],
  knownRelationIds: ReadonlySet<string>,
  issues: ElectricalValidationIssue[],
  document: Partial<DrawingElectricalObjectDocument>,
): void {
  if (typeof value !== "object" || value === null) {
    addIssue(issues, document, "INVALID_GRAPH", "Construction graph is required");
    return;
  }
  const graph = value as Record<string, unknown>;
  const graphObjectIds = validateStringIds(
    graph.objectIds,
    "GRAPH_OBJECT",
    issues,
    document,
  );
  if (JSON.stringify(graphObjectIds) !== JSON.stringify(canonicalStrings(objectIds))) {
    addIssue(
      issues,
      document,
      "GRAPH_OBJECT_REFERENCE_MISMATCH",
      "Construction graph object references do not match document objects",
    );
  }
  const objectSet = new Set(objectIds);
  const graphNodeSet = new Set(
    graphObjectIds.filter((objectId) => objectSet.has(objectId)),
  );
  if (!Array.isArray(graph.edges)) {
    addIssue(issues, document, "INVALID_GRAPH_EDGES", "Construction graph edges are required");
    return;
  }
  const edgeIds: string[] = [];
  const edgeIdentities: string[] = [];
  const canonicalEdgeKeys: string[] = [];
  const connectivityEdges: Array<readonly [string, string]> = [];
  const componentEligibleEdges = new Map<string, readonly [string, string]>();
  for (const edgeValue of graph.edges) {
    if (typeof edgeValue !== "object" || edgeValue === null) {
      addIssue(issues, document, "INVALID_GRAPH_EDGE", "Construction graph edge is invalid");
      continue;
    }
    const edge = edgeValue as Record<string, unknown>;
    const edgeId = typeof edge.id === "string" ? edge.id : "";
    edgeIds.push(edgeId);
    if (!EDGE_TYPES.has(edge.type as ConstructionGraphEdgeType)) {
      addIssue(
        issues,
        document,
        "UNKNOWN_GRAPH_EDGE_TYPE",
        "Construction graph edge type is unknown or semantic",
        { relationId: edgeId },
      );
    }
    const endpoints = validateStringIds(
      edge.objectIds,
      "GRAPH_EDGE_OBJECT",
      issues,
      document,
      { relationId: edgeId },
    );
    if (endpoints.length !== 2) {
      addIssue(
        issues,
        document,
        "INVALID_GRAPH_EDGE_ENDPOINTS",
        "Construction graph edge requires two object endpoints",
        { relationId: edgeId },
      );
    } else if (endpoints[0] === endpoints[1]) {
      addIssue(issues, document, "SELF_GRAPH_EDGE", "Construction graph self edge is forbidden", {
        relationId: edgeId,
      });
    }
    for (const endpoint of endpoints) {
      if (!objectSet.has(endpoint)) {
        addIssue(
          issues,
          document,
          "DANGLING_GRAPH_OBJECT_REFERENCE",
          `Construction graph edge references missing object ${endpoint}`,
          { relationId: edgeId },
        );
      }
    }
    const primitiveIds = validateStringIds(
      edge.primitiveIds,
      "GRAPH_EDGE_PRIMITIVE",
      issues,
      document,
      { relationId: edgeId },
    );
    const relationIds = validateStringIds(
      edge.sourceRelationIds,
      "GRAPH_EDGE_RELATION",
      issues,
      document,
      { relationId: edgeId },
    );
    for (const relationId of relationIds) {
      if (!knownRelationIds.has(relationId)) {
        addIssue(
          issues,
          document,
          "DANGLING_RELATION_REFERENCE",
          `Construction graph references missing relation ${relationId}`,
          { relationId },
        );
      }
    }
    const connectivityEligible =
      edgeId.length > 0 &&
      EDGE_TYPES.has(edge.type as ConstructionGraphEdgeType) &&
      endpoints.length === 2 &&
      endpoints[0] !== endpoints[1] &&
      isCanonicalUnique(endpoints) &&
      endpoints.every((endpoint) => graphNodeSet.has(endpoint)) &&
      Array.isArray(edge.primitiveIds) &&
      isCanonicalUnique(primitiveIds) &&
      Array.isArray(edge.sourceRelationIds) &&
      isCanonicalUnique(relationIds) &&
      relationIds.every((relationId) => knownRelationIds.has(relationId));
    if (connectivityEligible) {
      const endpointPair = [endpoints[0]!, endpoints[1]!] as const;
      connectivityEdges.push(endpointPair);
      componentEligibleEdges.set(edgeId, endpointPair);
    }
    const identity = JSON.stringify({
      type: edge.type,
      objectIds: endpoints,
      primitiveIds,
      sourceRelationIds: relationIds,
    });
    edgeIdentities.push(identity);
    canonicalEdgeKeys.push(`${endpoints[0] ?? ""}\u0000${endpoints[1] ?? ""}\u0000${edgeId}`);
  }
  if (edgeIds.some((id) => id.length === 0)) {
    addIssue(issues, document, "INVALID_GRAPH_EDGE_ID", "Graph edge IDs must not be empty");
  }
  if (new Set(edgeIds).size !== edgeIds.length) {
    addIssue(issues, document, "DUPLICATE_GRAPH_EDGE", "Graph edge IDs must be unique");
  }
  if (new Set(edgeIdentities).size !== edgeIdentities.length) {
    addIssue(issues, document, "DUPLICATE_GRAPH_EDGE", "Duplicate graph edge relation exists");
  }
  if (!isCanonicalUnique(canonicalEdgeKeys)) {
    addIssue(issues, document, "NON_CANONICAL_GRAPH_EDGES", "Graph edges are not canonical");
  }

  const actualPartitions = connectedComponents([...graphNodeSet], connectivityEdges);

  if (!Array.isArray(graph.components)) {
    addIssue(
      issues,
      document,
      "INVALID_GRAPH_COMPONENTS",
      "Construction graph components are required",
    );
    return;
  }
  const componentIds: string[] = [];
  const componentOrderKeys: string[] = [];
  const componentObjects = new Set<string>();
  const componentEdges = new Set<string>();
  const declaredPartitions: string[][] = [];
  for (const componentValue of graph.components) {
    if (typeof componentValue !== "object" || componentValue === null) {
      addIssue(issues, document, "INVALID_GRAPH_COMPONENT", "Graph component is invalid");
      continue;
    }
    const component = componentValue as Record<string, unknown>;
    const componentId = typeof component.id === "string" ? component.id : "";
    componentIds.push(componentId);
    const members = validateStringIds(
      component.objectIds,
      "GRAPH_COMPONENT_OBJECT",
      issues,
      document,
    );
    declaredPartitions.push(members);
    componentOrderKeys.push(`${members[0] ?? ""}\u0000${componentId}`);
    for (const objectId of members) {
      if (!objectSet.has(objectId)) {
        addIssue(
          issues,
          document,
          "DANGLING_COMPONENT_OBJECT_REFERENCE",
          `Graph component references missing object ${objectId}`,
        );
      }
      if (componentObjects.has(objectId)) {
        addIssue(
          issues,
          document,
          "DUPLICATE_COMPONENT_OBJECT_REFERENCE",
          `Object ${objectId} belongs to multiple graph components`,
        );
      }
      componentObjects.add(objectId);
    }
    const membersEdges = validateStringIds(
      component.edgeIds,
      "GRAPH_COMPONENT_EDGE",
      issues,
      document,
    );
    const memberSet = new Set(members);
    for (const edgeId of membersEdges) {
      if (!edgeIds.includes(edgeId)) {
        addIssue(
          issues,
          document,
          "DANGLING_COMPONENT_EDGE_REFERENCE",
          `Graph component references missing edge ${edgeId}`,
          { relationId: edgeId },
        );
      }
      const endpoints = componentEligibleEdges.get(edgeId);
      if (endpoints !== undefined && !endpoints.every((endpoint) => memberSet.has(endpoint))) {
        addIssue(
          issues,
          document,
          "GRAPH_COMPONENT_EDGE_MEMBERSHIP_MISMATCH",
          `Graph component ${componentId} does not contain both endpoints of edge ${edgeId}`,
          { relationId: edgeId, diagnostics: { componentId } },
        );
      }
      if (componentEdges.has(edgeId)) {
        addIssue(
          issues,
          document,
          "DUPLICATE_COMPONENT_EDGE_REFERENCE",
          `Edge ${edgeId} belongs to multiple graph components`,
          { relationId: edgeId },
        );
      }
      componentEdges.add(edgeId);
    }
  }
  if (componentIds.some((id) => id.length === 0)) {
    addIssue(
      issues,
      document,
      "INVALID_GRAPH_COMPONENT_ID",
      "Graph component IDs must not be empty",
    );
  }
  if (new Set(componentIds).size !== componentIds.length) {
    addIssue(
      issues,
      document,
      "DUPLICATE_GRAPH_COMPONENT",
      "Graph component IDs must be unique",
    );
  }
  if (!isCanonicalUnique(componentOrderKeys)) {
    addIssue(
      issues,
      document,
      "NON_CANONICAL_GRAPH_COMPONENTS",
      "Graph components must be in canonical order",
    );
  }
  for (const objectId of objectIds) {
    if (!componentObjects.has(objectId)) {
      addIssue(
        issues,
        document,
        "MISSING_GRAPH_COMPONENT_OBJECT",
        `Object ${objectId} is missing from graph components`,
      );
    }
  }
  for (const edgeId of canonicalStrings([...componentEligibleEdges.keys()])) {
    if (!componentEdges.has(edgeId)) {
      addIssue(
        issues,
        document,
        "MISSING_GRAPH_COMPONENT_EDGE_REFERENCE",
        `Edge ${edgeId} is missing from graph components`,
        { relationId: edgeId },
      );
    }
  }
  const canonicalDeclaredPartitions = canonicalPartitions(declaredPartitions);
  if (JSON.stringify(canonicalDeclaredPartitions) !== JSON.stringify(actualPartitions)) {
    addIssue(
      issues,
      document,
      "GRAPH_COMPONENT_PARTITION_MISMATCH",
      "Declared graph components do not match connectivity partitions",
      {
        diagnostics: {
          actualPartitions,
          declaredPartitions: canonicalDeclaredPartitions,
        },
      },
    );
  }
}

function validateStatistics(
  document: Partial<DrawingElectricalObjectDocument>,
  objects: readonly ElectricalObject[],
  issues: ElectricalValidationIssue[],
): void {
  const statistics = document.statistics;
  if (typeof statistics !== "object" || statistics === null) {
    addIssue(issues, document, "INVALID_STATISTICS", "Electrical statistics are required");
    return;
  }
  const expectedAccepted = objects.filter(({ status }) => status === "accepted").length;
  const expectedReview = objects.filter(({ status }) => status === "review").length;
  if (statistics.acceptedObjectCount !== expectedAccepted ||
      statistics.reviewObjectCount !== expectedReview) {
    addIssue(
      issues,
      document,
      "OBJECT_STATUS_STATISTICS_MISMATCH",
      "Object status statistics do not match objects",
    );
  }
  if (
    !Number.isInteger(statistics.excludedCandidateCount) ||
    statistics.excludedCandidateCount < 0 ||
    statistics.candidateCount !== objects.length + statistics.excludedCandidateCount
  ) {
    addIssue(
      issues,
      document,
      "CANDIDATE_STATISTICS_MISMATCH",
      "Candidate statistics count is invalid",
    );
  }
  if (!Number.isInteger(statistics.conflictCount) || statistics.conflictCount < 0) {
    addIssue(issues, document, "INVALID_CONFLICT_STATISTICS", "Conflict count is invalid");
  }
  const expectedTypes = Object.fromEntries(
    [...OBJECT_TYPES].map((type) => [
      type,
      objects.filter((object) => object.type === type).length,
    ]),
  ) as Record<ElectricalObjectType, number>;
  for (const type of OBJECT_TYPES) {
    if (statistics.objectCountByType?.[type] !== expectedTypes[type]) {
      addIssue(
        issues,
        document,
        "OBJECT_TYPE_STATISTICS_MISMATCH",
        `Object type statistics for ${type} do not match objects`,
      );
    }
  }
  if (!Array.isArray(document.warnings) ||
      statistics.warningCount !== document.warnings.length) {
    addIssue(
      issues,
      document,
      "WARNING_COUNT_MISMATCH",
      "warningCount does not match warning count",
    );
  }
}

export function validateElectricalDocument(
  documentValue: unknown,
): ElectricalValidationResult {
  const issues: ElectricalValidationIssue[] = [];
  if (typeof documentValue !== "object" || documentValue === null) {
    return {
      valid: false,
      issues: [{
        severity: "error",
        code: "INVALID_DOCUMENT",
        message: "Electrical document must be an object",
        objectId: null,
        relationId: null,
        source: null,
        diagnostics: {},
      }],
    };
  }
  const document = documentValue as Partial<DrawingElectricalObjectDocument>;
  if (document.schemaVersion !== 1) {
    addIssue(issues, document, "INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  }
  if (typeof document.source !== "string" || document.source.trim().length === 0) {
    addIssue(issues, document, "INVALID_SOURCE", "Document source is required");
  }
  if (
    typeof document.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(document.sourceSha256)
  ) {
    addIssue(issues, document, "INVALID_SOURCE_SHA256", "sourceSha256 must be 64 hex chars");
  }
  if (!Number.isInteger(document.page) || (document.page ?? 0) < 1) {
    addIssue(issues, document, "INVALID_PAGE", "Document page must be a positive integer");
  }
  for (const [name, value] of [
    ["pageWidth", document.pageWidth],
    ["pageHeight", document.pageHeight],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      addIssue(
        issues,
        document,
        `INVALID_${name.toUpperCase()}`,
        `${name} dimension must be positive and finite`,
      );
    }
  }
  if (!Array.isArray(document.objects)) {
    addIssue(issues, document, "INVALID_OBJECTS", "Document objects must be an array");
    return { valid: false, issues: issues.sort(issueComparator) };
  }
  if (document.objectCount !== document.objects.length) {
    addIssue(
      issues,
      document,
      "OBJECT_COUNT_MISMATCH",
      "objectCount does not match objects length",
    );
  }
  const objectIds = document.objects.map((object) =>
    typeof object === "object" && object !== null && typeof Reflect.get(object, "id") === "string"
      ? Reflect.get(object, "id") as string
      : ""
  );
  if (!isCanonicalUnique(objectIds)) {
    addIssue(
      issues,
      document,
      "DUPLICATE_OR_NON_CANONICAL_OBJECT_ID",
      "Electrical object IDs must be canonical and contain no duplicates",
    );
  }
  const primitiveOwners = new Map<string, string>();
  const knownRelationIds = new Set<string>();
  for (const object of document.objects) {
    validateObject(
      object,
      issues,
      document,
      primitiveOwners,
      knownRelationIds,
    );
  }
  validateGraph(
    document.constructionGraph,
    objectIds,
    knownRelationIds,
    issues,
    document,
  );
  validateStatistics(document, document.objects, issues);
  if (Array.isArray(document.warnings) &&
      (!document.warnings.every((warning) => typeof warning === "string") ||
       !isCanonicalUnique(document.warnings))) {
    addIssue(
      issues,
      document,
      "NON_CANONICAL_WARNINGS",
      "Warnings must be strings in canonical order without duplicates",
    );
  }
  issues.sort(issueComparator);
  return { valid: issues.length === 0, issues };
}

export function validateElectricalObjects(document: unknown): void {
  const result = validateElectricalDocument(document);
  if (!result.valid) {
    throw new Error(result.issues.map(({ code, message }) => `${code}: ${message}`).join("; "));
  }
}
