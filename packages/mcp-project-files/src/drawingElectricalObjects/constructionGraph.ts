import { createHash } from "node:crypto";

import { codepointCompare } from "./objectIdentity.js";
import type {
  ConstructionGraph,
  ConstructionGraphComponent,
  ConstructionGraphEdge,
  ConstructionGraphEdgeType,
  ElectricalObject,
} from "./types.js";

export type ConstructionGraphEdgeInput = Omit<ConstructionGraphEdge, "id">;

const EDGE_TYPES = new Set<ConstructionGraphEdgeType>([
  "bbox-touch",
  "endpoint-contact",
  "shared-primitive",
  "spatial-adjacent",
]);

function canonicalStrings(values: readonly string[], label: string): string[] {
  if (!values.every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error(`Construction graph ${label} IDs must be non-empty strings`);
  }
  return [...new Set(values)].sort(codepointCompare);
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function isEdgeType(value: unknown): value is ConstructionGraphEdgeType {
  return typeof value === "string" && EDGE_TYPES.has(value as ConstructionGraphEdgeType);
}

function canonicalEdge(
  value: unknown,
  objectIds: ReadonlySet<string>,
): ConstructionGraphEdge {
  if (typeof value !== "object" || value === null) {
    throw new Error("Construction graph edge must be an object");
  }
  const edge = value as Partial<ConstructionGraphEdgeInput>;
  if (!isEdgeType(edge.type)) {
    throw new Error("Construction graph edge type must be geometric");
  }
  if (!Array.isArray(edge.objectIds) || edge.objectIds.length !== 2) {
    throw new Error("Construction graph edge requires two object endpoints");
  }
  const endpoints = canonicalStrings(edge.objectIds, "object endpoint");
  if (endpoints.length !== 2) {
    throw new Error("Construction graph self edge requires distinct endpoints");
  }
  if (!endpoints.every((id) => objectIds.has(id))) {
    throw new Error("Construction graph edge has a dangling object endpoint");
  }
  if (!Array.isArray(edge.primitiveIds)) {
    throw new Error("Construction graph edge primitiveIds must be an array");
  }
  if (!Array.isArray(edge.sourceRelationIds)) {
    throw new Error("Construction graph edge sourceRelationIds must be an array");
  }
  const primitiveIds = canonicalStrings(edge.primitiveIds, "primitive");
  const sourceRelationIds = canonicalStrings(
    edge.sourceRelationIds,
    "source relation",
  );
  const identity = {
    type: edge.type,
    objectIds: endpoints,
    primitiveIds,
    sourceRelationIds,
  };
  return {
    id: stableId("edge", identity),
    ...identity,
    objectIds: endpoints as [string, string],
  };
}

function compareEdges(
  left: ConstructionGraphEdge,
  right: ConstructionGraphEdge,
): number {
  return codepointCompare(left.objectIds[0], right.objectIds[0]) ||
    codepointCompare(left.objectIds[1], right.objectIds[1]) ||
    codepointCompare(left.id, right.id);
}

function buildComponents(
  objectIds: readonly string[],
  edges: readonly ConstructionGraphEdge[],
): ConstructionGraphComponent[] {
  const neighbors = new Map(objectIds.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    neighbors.get(edge.objectIds[0])!.add(edge.objectIds[1]);
    neighbors.get(edge.objectIds[1])!.add(edge.objectIds[0]);
  }

  const visited = new Set<string>();
  const components: ConstructionGraphComponent[] = [];
  for (const start of objectIds) {
    if (visited.has(start)) continue;
    const pending = [start];
    const componentObjects: string[] = [];
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      componentObjects.push(current);
      const next = [...neighbors.get(current)!]
        .sort(codepointCompare)
        .filter((id) => !visited.has(id));
      pending.push(...next);
    }
    componentObjects.sort(codepointCompare);
    const memberIds = new Set(componentObjects);
    const edgeIds = edges
      .filter((edge) => edge.objectIds.every((id) => memberIds.has(id)))
      .map((edge) => edge.id)
      .sort(codepointCompare);
    components.push({
      id: stableId("component", { objectIds: componentObjects, edgeIds }),
      objectIds: componentObjects,
      edgeIds,
    });
  }
  return components.sort((left, right) =>
    codepointCompare(left.objectIds[0]!, right.objectIds[0]!) ||
    codepointCompare(left.id, right.id)
  );
}

function assertCanonical(values: readonly string[], label: string): void {
  const expected = canonicalStrings(values, label);
  if (
    expected.length !== values.length ||
    expected.some((value, index) => value !== values[index])
  ) {
    throw new Error(`Construction graph ${label} IDs must be canonical and unique`);
  }
}

export function validateElectricalConstructionGraph(
  graphValue: unknown,
  expectedObjectIds: readonly string[],
): void {
  if (typeof graphValue !== "object" || graphValue === null) {
    throw new Error("Construction graph must be an object");
  }
  const graph = graphValue as Partial<ConstructionGraph>;
  if (!Array.isArray(graph.objectIds) ||
      !Array.isArray(graph.edges) ||
      !Array.isArray(graph.components)) {
    throw new Error("Construction graph arrays are required");
  }
  assertCanonical(graph.objectIds, "object");
  const expected = canonicalStrings(expectedObjectIds, "expected object");
  if (
    expected.length !== graph.objectIds.length ||
    expected.some((id, index) => id !== graph.objectIds![index])
  ) {
    throw new Error("Construction graph object IDs do not match objects");
  }
  const objectSet = new Set(graph.objectIds);
  const edgeIds = new Set<string>();
  const canonicalEdges = graph.edges.map((edge) => {
    const normalized = canonicalEdge(edge, objectSet);
    if (typeof edge.id !== "string" || edge.id !== normalized.id) {
      throw new Error("Construction graph edge ID is invalid");
    }
    if (edgeIds.has(edge.id)) throw new Error("Duplicate construction graph edge ID");
    edgeIds.add(edge.id);
    return normalized;
  });
  const orderedEdges = [...canonicalEdges].sort(compareEdges);
  if (orderedEdges.some((edge, index) => edge.id !== graph.edges![index]!.id)) {
    throw new Error("Construction graph edges must be canonical");
  }
  const expectedComponents = buildComponents(graph.objectIds, canonicalEdges);
  if (JSON.stringify(graph.components) !== JSON.stringify(expectedComponents)) {
    throw new Error("Construction graph components are invalid or non-canonical");
  }
}

export function buildElectricalConstructionGraph(
  objects: readonly ElectricalObject[],
  edgeInputs: readonly ConstructionGraphEdgeInput[],
): ConstructionGraph {
  const objectIds = canonicalStrings(objects.map((object) => object.id), "object");
  if (objectIds.length !== objects.length) {
    throw new Error("Duplicate construction graph object ID");
  }
  const objectSet = new Set(objectIds);
  const edgesById = new Map<string, ConstructionGraphEdge>();
  for (const edgeInput of edgeInputs) {
    const edge = canonicalEdge(edgeInput, objectSet);
    edgesById.set(edge.id, edge);
  }
  const edges = [...edgesById.values()].sort(compareEdges);
  const graph = {
    objectIds,
    edges,
    components: buildComponents(objectIds, edges),
  };
  validateElectricalConstructionGraph(graph, objectIds);
  return graph;
}
