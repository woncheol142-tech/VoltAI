import { CircuitNodeType } from "../drawingCircuitGraph/types.js";
import {
  validateCircuitGraphDocument,
  type CircuitGraphValidationResult,
} from "../drawingCircuitGraph/validateCircuitGraphDocument.js";
import type { CircuitGraphDocument } from "../drawingCircuitGraph/types.js";
import { CircuitGraphQueryError, type CircuitGraphQuery } from "./types.js";

type DataRecord = Record<string, unknown>;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const NODE_TYPES = new Set<unknown>(Object.values(CircuitNodeType));
const QUERY_KEYS: Record<CircuitGraphQuery["kind"], readonly string[]> = {
  FIND_NODE: ["kind", "nodeId"],
  FIND_NODES_BY_TYPE: ["kind", "nodeType"],
  FIND_NODES_BY_DISPLAY_NAME: ["kind", "displayName"],
  FIND_CONNECTED_NEIGHBORS: ["kind", "nodeId"],
  FIND_CONTAINED_NODES: ["kind", "nodeId"],
  FIND_REFERENCED_NODES: ["kind", "nodeId"],
};
const QUERY_KINDS = new Set<unknown>(
  Object.keys(QUERY_KEYS) as CircuitGraphQuery["kind"][],
);

function asDataRecord(value: unknown): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) return null;
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
  expectedKeys: readonly string[],
): boolean {
  try {
    const keys = Object.keys(record);
    return (
      keys.length === expectedKeys.length &&
      expectedKeys.every((key) => Object.hasOwn(record, key))
    );
  } catch {
    return false;
  }
}

function invalidQuery(message: string): never {
  throw new CircuitGraphQueryError("INVALID_QUERY", message);
}

export function validateCircuitGraphQuery(value: unknown): CircuitGraphQuery {
  const query = asDataRecord(value);
  if (query === null || !QUERY_KINDS.has(query.kind)) {
    return invalidQuery("Circuit graph query is invalid");
  }
  const kind = query.kind as CircuitGraphQuery["kind"];
  if (!hasExactKeys(query, QUERY_KEYS[kind])) {
    return invalidQuery(`${kind} query shape is invalid`);
  }

  if (kind === "FIND_NODES_BY_TYPE") {
    if (!NODE_TYPES.has(query.nodeType)) {
      return invalidQuery("nodeType is invalid");
    }
  } else if (kind === "FIND_NODES_BY_DISPLAY_NAME") {
    if (typeof query.displayName !== "string") {
      return invalidQuery("displayName must be a string");
    }
  } else if (typeof query.nodeId !== "string" || query.nodeId.length === 0) {
    return invalidQuery("nodeId must be a non-empty string");
  }

  return query as CircuitGraphQuery;
}

function invalidGraphMessage(result: CircuitGraphValidationResult): string {
  const codes = result.issues.map(({ code }) => code);
  return codes.length === 0
    ? "Circuit graph is invalid"
    : `Circuit graph is invalid: ${codes.join(", ")}`;
}

export function validateQueryGraph(value: unknown): CircuitGraphDocument {
  let result: CircuitGraphValidationResult;
  try {
    result = validateCircuitGraphDocument(value);
  } catch {
    throw new CircuitGraphQueryError(
      "INVALID_GRAPH",
      "Circuit graph validation failed",
    );
  }
  if (!result.valid) {
    throw new CircuitGraphQueryError(
      "INVALID_GRAPH",
      invalidGraphMessage(result),
    );
  }
  return value as CircuitGraphDocument;
}
