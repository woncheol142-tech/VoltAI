import type {
  CircuitGraphDocument,
  CircuitNode,
  CircuitNodeType,
} from "../drawingCircuitGraph/types.js";

export type CircuitGraphQuery =
  | {
      readonly kind: "FIND_NODE";
      readonly nodeId: string;
    }
  | {
      readonly kind: "FIND_NODES_BY_TYPE";
      readonly nodeType: CircuitNodeType;
    }
  | {
      readonly kind: "FIND_NODES_BY_DISPLAY_NAME";
      readonly displayName: string;
    }
  | {
      readonly kind: "FIND_CONNECTED_NEIGHBORS";
      readonly nodeId: string;
    }
  | {
      readonly kind: "FIND_CONTAINED_NODES";
      readonly nodeId: string;
    }
  | {
      readonly kind: "FIND_REFERENCED_NODES";
      readonly nodeId: string;
    };

export type CircuitGraphQueryResult = {
  readonly queryKind: CircuitGraphQuery["kind"];
  readonly nodeCount: number;
  readonly nodes: readonly CircuitNode[];
};

export type CircuitGraphQueryFunction = (
  graph: CircuitGraphDocument,
  query: CircuitGraphQuery,
) => CircuitGraphQueryResult;

export type CircuitGraphQueryErrorCode = "INVALID_GRAPH" | "INVALID_QUERY";

export class CircuitGraphQueryError extends Error {
  declare readonly name: "CircuitGraphQueryError";
  declare readonly code: CircuitGraphQueryErrorCode;

  constructor(code: CircuitGraphQueryErrorCode, message: string) {
    super(message);
    Object.defineProperties(this, {
      name: {
        value: "CircuitGraphQueryError",
        writable: false,
        configurable: false,
      },
      code: {
        value: code,
        enumerable: true,
        writable: false,
        configurable: false,
      },
    });
  }
}
