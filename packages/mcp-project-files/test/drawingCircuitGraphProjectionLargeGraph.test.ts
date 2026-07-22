import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  projectCircuitGraph,
  serializeCircuitGraphDocument,
  validateCircuitGraphDocument,
} from "../src/drawingCircuitGraph/index.js";
import { CircuitGraphWarningCode } from "../src/drawingCircuitGraph/types.js";
import {
  createLargeProjectionInputFixture,
  deepFreezeProjectionFixture,
} from "./helpers/drawingCircuitGraphProjectionFixture.js";

const LARGE_TIMEOUT_MS = 30_000;

function extendObjectToDepth(
  container: Record<string, unknown>,
  targetDepth: number,
): void {
  let current = container;
  for (let depth = 3; depth < targetDepth; depth += 1) {
    const child: Record<string, unknown> = {};
    current.next = child;
    current = child;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("circuit graph projection large-graph contracts", () => {
  it.each([
    ["object", "INVALID_OBJECT_DOCUMENT"],
    ["relationship", "INVALID_RELATIONSHIP_DOCUMENT"],
  ] as const)(
    "rejects a 20,000-deep %s input without leaking a raw RangeError",
    (target, expectedCode) => {
      const input = createLargeProjectionInputFixture("connected-chain", 2);
      const container =
        target === "object"
          ? input.objectDocument.objects[0]!.attributes
          : input.relationshipDocument.relationships[0]!.attributes;
      extendObjectToDepth(container as Record<string, unknown>, 20_000);

      try {
        projectCircuitGraph(input.objectDocument, input.relationshipDocument);
        throw new Error("Expected deep input rejection");
      } catch (error) {
        expect(error).toMatchObject({
          name: "CircuitGraphProjectionError",
          code: expectedCode,
          relatedIds: [],
        });
        expect(error).not.toBeInstanceOf(RangeError);
      }
    },
    LARGE_TIMEOUT_MS,
  );

  it(
    "projects a 20,000-object CONNECTED_TO chain without recursion overflow",
    () => {
      const input = createLargeProjectionInputFixture(
        "connected-chain",
        20_000,
      );
      deepFreezeProjectionFixture(input);
      const result = projectCircuitGraph(
        input.objectDocument,
        input.relationshipDocument,
      );
      expect(result).toMatchObject({
        nodeCount: 20_000,
        edgeCount: 19_999,
        componentCount: 1,
        boundaryCount: 0,
        statistics: {
          isolatedNodeCount: 0,
          connectedComponentCount: 1,
        },
      });
      expect(validateCircuitGraphDocument(result)).toEqual({
        valid: true,
        issues: [],
      });
    },
    LARGE_TIMEOUT_MS,
  );

  it(
    "projects a 20,000-object REFERENCE chain as isolated components",
    () => {
      const input = createLargeProjectionInputFixture(
        "reference-chain",
        20_000,
      );
      const result = projectCircuitGraph(
        input.objectDocument,
        input.relationshipDocument,
      );
      expect(result).toMatchObject({
        nodeCount: 20_000,
        edgeCount: 19_999,
        componentCount: 20_000,
        statistics: {
          isolatedNodeCount: 20_000,
          connectedComponentCount: 20_000,
        },
      });
      expect(
        result.warnings.some(
          ({ code }) => code === CircuitGraphWarningCode.REFERENCE_CYCLE,
        ),
      ).toBe(false);
    },
    LARGE_TIMEOUT_MS,
  );

  it(
    "detects a 20,000-object REFERENCE cycle iteratively without rejecting the graph",
    () => {
      const input = createLargeProjectionInputFixture(
        "reference-cycle",
        20_000,
      );
      const result = projectCircuitGraph(
        input.objectDocument,
        input.relationshipDocument,
      );
      expect(validateCircuitGraphDocument(result).valid).toBe(true);
      expect(
        result.warnings.filter(
          ({ code }) => code === CircuitGraphWarningCode.REFERENCE_CYCLE,
        ),
      ).toHaveLength(1);
      expect(result.componentCount).toBe(20_000);
    },
    LARGE_TIMEOUT_MS,
  );

  it(
    "derives many disconnected pairs without component-by-edge quadratic behavior",
    () => {
      const input = createLargeProjectionInputFixture("pairs", 4_000);
      const startedAt = performance.now();
      const result = projectCircuitGraph(
        input.objectDocument,
        input.relationshipDocument,
      );
      const elapsedMs = performance.now() - startedAt;
      expect(result).toMatchObject({
        nodeCount: 4_000,
        edgeCount: 2_000,
        componentCount: 2_000,
        statistics: {
          isolatedNodeCount: 0,
          connectedComponentCount: 2_000,
        },
      });
      expect(elapsedMs).toBeLessThan(LARGE_TIMEOUT_MS);
    },
    LARGE_TIMEOUT_MS,
  );

  it(
    "keeps large projection graph IDs, bytes, and SHA-256 deterministic",
    () => {
      const input = createLargeProjectionInputFixture("connected-chain", 2_000);
      const first = projectCircuitGraph(
        input.objectDocument,
        input.relationshipDocument,
      );
      const second = projectCircuitGraph(
        input.objectDocument,
        input.relationshipDocument,
      );
      const firstBytes = serializeCircuitGraphDocument(first);
      const secondBytes = serializeCircuitGraphDocument(second);
      expect(second.graphId).toBe(first.graphId);
      expect(secondBytes).toBe(firstBytes);
      expect(sha256(secondBytes)).toBe(sha256(firstBytes));
    },
    LARGE_TIMEOUT_MS,
  );
});
