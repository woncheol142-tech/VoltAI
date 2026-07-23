import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import type { CircuitGraphDocument } from "../drawingCircuitGraph/types.js";
import {
  CircuitGraphQueryError,
  queryCircuitGraph,
  type CircuitGraphQuery,
  type CircuitGraphQueryErrorCode,
  type CircuitGraphQueryResult,
} from "../drawingCircuitGraphQuery/index.js";

type QueryCircuitGraphEnvelope = {
  document: CircuitGraphDocument;
  query: CircuitGraphQuery;
};

const ENVELOPE_KEYS = new Set(["document", "query"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function prefixedError(
  code: CircuitGraphQueryErrorCode,
  message: string,
): CircuitGraphQueryError {
  const prefix = `${code}:`;
  return new CircuitGraphQueryError(
    code,
    message.startsWith(prefix) ? message : `${prefix} ${message}`,
  );
}

function invalidEnvelope(message: string): never {
  throw prefixedError("INVALID_QUERY", message);
}

function validateEnvelope(input: unknown): QueryCircuitGraphEnvelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalidEnvelope("query_circuit_graph input must be an object");
  }

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidEnvelope(
      "query_circuit_graph input must have a plain prototype",
    );
  }

  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== "string" ||
      FORBIDDEN_KEYS.has(key) ||
      !ENVELOPE_KEYS.has(key)
    ) {
      return invalidEnvelope(
        "query_circuit_graph input contains an unsafe key",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return invalidEnvelope(
        "query_circuit_graph input fields must be enumerable data properties",
      );
    }
    descriptors.set(key, descriptor);
  }

  const document = descriptors.get("document");
  const query = descriptors.get("query");
  if (
    descriptors.size !== ENVELOPE_KEYS.size ||
    document === undefined ||
    query === undefined
  ) {
    return invalidEnvelope("document and query are required");
  }

  return {
    document: document.value as CircuitGraphDocument,
    query: query.value as CircuitGraphQuery,
  };
}

function runQueryCircuitGraph(input: unknown): CircuitGraphQueryResult {
  const { document, query } = validateEnvelope(input);
  try {
    return queryCircuitGraph(document, query);
  } catch (error) {
    if (error instanceof CircuitGraphQueryError) {
      throw prefixedError(error.code, error.message);
    }
    throw error;
  }
}

const requiredValue = (field: string) =>
  z.unknown().refine((value) => value !== undefined, {
    message: `${field} is required`,
  });

export function createQueryCircuitGraphTool(): VoltAiTool<CircuitGraphQueryResult> {
  return {
    name: "query_circuit_graph",
    description:
      "Run an exact deterministic query against a validated circuit graph document.",
    inputSchema: {
      document: requiredValue("document"),
      query: requiredValue("query"),
    },
    handler: runQueryCircuitGraph,
  };
}
