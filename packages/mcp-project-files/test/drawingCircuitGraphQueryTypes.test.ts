import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  CircuitGraphQuery,
  CircuitGraphQueryResult,
  queryCircuitGraph,
} from "../src/drawingCircuitGraphQuery/index.js";
import {
  CircuitNodeType,
  type CircuitGraphDocument,
  type CircuitNode,
} from "../src/drawingCircuitGraph/types.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedQuery =
  | { readonly kind: "FIND_NODE"; readonly nodeId: string }
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
  | { readonly kind: "FIND_CONTAINED_NODES"; readonly nodeId: string }
  | { readonly kind: "FIND_REFERENCED_NODES"; readonly nodeId: string };

describe("circuit graph query public type contract", () => {
  it("compiles the approved public query contract", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("fixes the six query variants as an exact discriminated union", () => {
    expectTypeOf<CircuitGraphQuery>().toEqualTypeOf<ExpectedQuery>();
  });

  it("fixes the exact two-argument public function signature", () => {
    expectTypeOf<typeof queryCircuitGraph>().toEqualTypeOf<
      (
        graph: CircuitGraphDocument,
        query: CircuitGraphQuery,
      ) => CircuitGraphQueryResult
    >();
  });

  it("keeps result fields and reachable nodes readonly", () => {
    expectTypeOf<CircuitGraphQueryResult>().toEqualTypeOf<{
      readonly queryKind: CircuitGraphQuery["kind"];
      readonly nodeCount: number;
      readonly nodes: readonly CircuitNode[];
    }>();
    expectTypeOf<CircuitGraphQueryResult["nodes"]>().toMatchTypeOf<
      readonly CircuitNode[]
    >();
  });

  it("rejects unsupported query variants and mutable result fields", () => {
    // @ts-expect-error transitive traversal is outside Task 44A
    const transitive: CircuitGraphQuery = { kind: "FIND_CONNECTED_NODES" };
    const nullName: CircuitGraphQuery = {
      kind: "FIND_NODES_BY_DISPLAY_NAME",
      // @ts-expect-error displayName must be a non-null string
      displayName: null,
    };
    const mutateResult = (result: CircuitGraphQueryResult): void => {
      // @ts-expect-error result count is readonly
      result.nodeCount = 1;
    };
    expect([transitive, nullName, mutateResult]).toBeDefined();
  });
});
