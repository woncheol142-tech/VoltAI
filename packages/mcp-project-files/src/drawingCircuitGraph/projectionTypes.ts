import { codepointCompare } from "./ordering.js";

export type CircuitGraphProjectionErrorCode =
  | "INVALID_OBJECT_DOCUMENT"
  | "INVALID_RELATIONSHIP_DOCUMENT"
  | "INCOMPATIBLE_SOURCE_SLICE"
  | "OBJECT_REGISTRY_MISMATCH"
  | "MISSING_INTERNAL_ENDPOINT"
  | "INVALID_CONNECTED_VIA"
  | "UNSUPPORTED_RELATIONSHIP_TYPE"
  | "GENERATED_GRAPH_INVALID";

export class CircuitGraphProjectionError extends Error {
  readonly name = "CircuitGraphProjectionError";
  readonly code: CircuitGraphProjectionErrorCode;
  readonly relatedIds: readonly string[];

  constructor(
    code: CircuitGraphProjectionErrorCode,
    message: string,
    relatedIds: readonly string[] = [],
  ) {
    super(message);
    this.code = code;
    this.relatedIds = Object.freeze(
      [...new Set(relatedIds)].sort(codepointCompare),
    );
    Object.defineProperties(this, {
      name: { configurable: false, writable: false },
      code: { configurable: false, writable: false },
      message: { configurable: false, writable: false },
      relatedIds: { configurable: false, writable: false },
    });
  }
}
