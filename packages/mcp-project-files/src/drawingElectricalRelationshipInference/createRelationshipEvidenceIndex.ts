import type {
  ConstructionGraphEdge,
  ElectricalAttribute,
  ElectricalObject,
} from "../drawingElectricalObjects/types.js";
import type {
  RelationshipEvidenceIndex,
} from "./types.js";
import { validateRelationshipInferenceInput } from "./validateRelationshipInferenceInput.js";

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(codepointCompare);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

function immutableMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const target = new Map(source);
  const view: ReadonlyMap<K, V> = new Proxy(target, {
    get(map, property) {
      if (property === "set" || property === "delete" || property === "clear") {
        return undefined;
      }
      if (property === "size") return map.size;
      if (property === "forEach") {
        return (
          callback: (value: V, key: K, sourceMap: ReadonlyMap<K, V>) => void,
          thisArg?: unknown,
        ) => map.forEach((value, key) => callback.call(thisArg, value, key, view));
      }
      const member = Reflect.get(map, property, map) as unknown;
      return typeof member === "function" ? member.bind(map) : member;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  return Object.freeze(view);
}

export function createImmutableRelationshipInferenceDocument(
  document: unknown,
) {
  validateRelationshipInferenceInput(document);
  return deepFreeze(structuredClone(document));
}

function isElectricalAttribute(value: unknown): value is ElectricalAttribute<unknown> {
  return typeof value === "object" && value !== null &&
    Array.isArray(Reflect.get(value, "textEntityIds")) &&
    Array.isArray(Reflect.get(value, "sourceRelationIds"));
}

function collectAttributeEvidence(object: ElectricalObject): string[] {
  const evidence: string[] = [];
  for (const value of Object.values(object.attributes)) {
    if (!isElectricalAttribute(value)) continue;
    for (const id of value.textEntityIds) {
      evidence.push(`text:${id}`);
    }
    for (const id of value.sourceRelationIds) {
      evidence.push(`spatial:${id}`);
    }
  }
  return evidence;
}

function collectObjectEvidence(object: ElectricalObject): string[] {
  const values: string[] = [];
  for (const id of object.primitiveIds) values.push(`primitive:${id}`);
  for (const label of object.labels) {
    values.push(`text:${label.textEntityId}`);
  }
  for (const id of object.sourceRelationIds) values.push(`spatial:${id}`);
  values.push(...collectAttributeEvidence(object));
  return canonical(values);
}

function collectEdgeEvidence(edge: ConstructionGraphEdge): string[] {
  return [`graph-edge:${edge.id}`];
}

export function createRelationshipEvidenceIndex(
  document: unknown,
): RelationshipEvidenceIndex {
  const immutableDocument = createImmutableRelationshipInferenceDocument(document);
  const objects = [...immutableDocument.objects].sort((left, right) =>
    codepointCompare(left.id, right.id)
  );
  const edges = [...immutableDocument.constructionGraph.edges].sort((left, right) =>
    codepointCompare(left.id, right.id)
  );
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const graphEdgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const evidenceByObjectId = new Map<string, readonly string[]>();
  const graphEdgesByObjectId = new Map<string, readonly ConstructionGraphEdge[]>();
  const allEvidence: string[] = [];

  for (const object of objects) {
    const objectEvidence = collectObjectEvidence(object);
    evidenceByObjectId.set(object.id, Object.freeze(objectEvidence));
    allEvidence.push(...objectEvidence);
    graphEdgesByObjectId.set(
      object.id,
      Object.freeze(edges.filter((edge) => edge.objectIds.includes(object.id))),
    );
  }
  for (const edge of edges) allEvidence.push(...collectEdgeEvidence(edge));

  return Object.freeze({
    objectIds: Object.freeze(objects.map((object) => object.id)),
    graphEdgeIds: Object.freeze(edges.map((edge) => edge.id)),
    evidenceIds: Object.freeze(canonical(allEvidence)),
    objectById: immutableMap(objectById),
    graphEdgeById: immutableMap(graphEdgeById),
    evidenceByObjectId: immutableMap(evidenceByObjectId),
    graphEdgesByObjectId: immutableMap(graphEdgesByObjectId),
  });
}
