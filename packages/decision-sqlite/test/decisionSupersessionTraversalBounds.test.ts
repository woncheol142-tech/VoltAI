import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  StoredDecisionAddress,
  StoredDecisionSupersession,
} from "../src/index.js";
import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createTempDatabase,
  stringKeyCodec,
} from "./fixtures/decisionFixtures.js";

type TraversalDirection = "toward-superseding" | "toward-superseded";
type TraversalRequest = {
  readonly seeds: readonly StoredDecisionAddress[];
  readonly directions: readonly TraversalDirection[];
  readonly bounds: {
    readonly maxEdgeHops: number;
    readonly maxNodes: number;
    readonly maxEdges: number;
  };
};
type TraversalObservation = {
  readonly address: StoredDecisionAddress;
  readonly direction: TraversalDirection;
  readonly state: "COMPLETE" | "NOT_STARTED" | "PARTIAL";
  readonly reason?: "edge-hop-bound" | "node-bound" | "edge-bound";
};
type TraversalResult = {
  readonly seeds: readonly StoredDecisionAddress[];
  readonly nodes: readonly StoredDecisionAddress[];
  readonly edges: readonly StoredDecisionSupersession[];
  readonly observations: readonly TraversalObservation[];
};
type Task80Store = SqliteDecisionStore & {
  deriveStoredDecisionSupersessionSubgraph(
    request: TraversalRequest,
  ): TraversalResult;
};

const address = (
  recordKey: string,
  namespace = "decisions",
): StoredDecisionAddress => ({ namespace, recordKey });
const edge = (
  supersededRecordKey: string,
  supersedingRecordKey: string,
): StoredDecisionSupersession => ({
  supersededNamespace: "decisions",
  supersededRecordKey,
  supersedingNamespace: "decisions",
  supersedingRecordKey,
});

function insertEdge(
  store: SqliteDecisionStore,
  relation: StoredDecisionSupersession,
): void {
  store.insertDecisionSupersession(
    relation.supersededNamespace,
    relation.supersedingNamespace,
    {
      supersededDecisionRecordId: relation.supersededRecordKey,
      supersedingDecisionRecordId: relation.supersedingRecordKey,
    },
    stringKeyCodec,
    stringKeyCodec,
  );
}

function callDerive(
  store: SqliteDecisionStore,
  request: unknown,
): TraversalResult {
  return (
    store as unknown as {
      deriveStoredDecisionSupersessionSubgraph(value: unknown): TraversalResult;
    }
  ).deriveStoredDecisionSupersessionSubgraph(request);
}

function derive(
  store: SqliteDecisionStore,
  seeds: readonly StoredDecisionAddress[],
  directions: readonly TraversalDirection[],
  bounds: TraversalRequest["bounds"],
): TraversalResult {
  return (
    store as unknown as Task80Store
  ).deriveStoredDecisionSupersessionSubgraph({ seeds, directions, bounds });
}

function observation(
  result: TraversalResult,
  observedAddress: StoredDecisionAddress,
  direction: TraversalDirection,
): TraversalObservation | undefined {
  return result.observations.find(
    (candidate) =>
      candidate.address.namespace === observedAddress.namespace &&
      candidate.address.recordKey === observedAddress.recordKey &&
      candidate.direction === direction,
  );
}

function expectStoreError(
  action: () => unknown,
  category: string,
  field?: string,
): void {
  try {
    action();
    throw new Error(`expected ${category}/${field ?? "<none>"}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject(
      field === undefined ? { category } : { category, field },
    );
  }
}

const generousBounds = {
  maxEdgeHops: 10,
  maxNodes: 1000,
  maxEdges: 1000,
} as const;

describe("Task80 traversal bounds and validation RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q6 rejects maxNodes below the unique seed count without truncating seeds", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectStoreError(
        () =>
          derive(
            store,
            [address("B"), address("A"), address("B")],
            ["toward-superseding"],
            { maxEdgeHops: 1, maxNodes: 1, maxEdges: 10 },
          ),
        "query",
        "bounds",
      );
    } finally {
      store.close();
    }
  });

  it("Q7 returns hop-zero seeds, no edges, NOT_STARTED observations, and executes no edge query", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const listSpy = vi.spyOn(store, "listStoredSupersessions");

    try {
      insertEdge(store, edge("A", "B"));
      const result = derive(
        store,
        [address("B"), address("A"), address("A")],
        ["toward-superseding", "toward-superseded"],
        { maxEdgeHops: 0, maxNodes: 2, maxEdges: 10 },
      );

      expect(result.seeds).toEqual([address("A"), address("B")]);
      expect(result.nodes).toEqual(result.seeds);
      expect(result.edges).toEqual([]);
      expect(result.observations).toHaveLength(4);
      expect(
        result.observations.every(
          (item) =>
            item.state === "NOT_STARTED" &&
            item.reason === "edge-hop-bound" &&
            !("hopDistance" in item) &&
            !("depth" in item),
        ),
      ).toBe(true);
      expect(
        result.nodes.every(
          (node) => !("hopDistance" in node) && !("depth" in node),
        ),
      ).toBe(true);
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it("Q8 counts edge hops and does not expand nodes at the hop bound", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const listSpy = vi.spyOn(store, "listStoredSupersessions");

    try {
      insertEdge(store, edge("A", "B"));
      insertEdge(store, edge("B", "C"));
      const result = derive(store, [address("A")], ["toward-superseding"], {
        maxEdgeHops: 1,
        maxNodes: 10,
        maxEdges: 10,
      });

      expect(result.nodes).toEqual([address("A"), address("B")]);
      expect(result.edges).toEqual([edge("A", "B")]);
      expect(observation(result, address("A"), "toward-superseding")).toEqual({
        address: address("A"),
        direction: "toward-superseding",
        state: "COMPLETE",
      });
      expect(observation(result, address("B"), "toward-superseding")).toEqual({
        address: address("B"),
        direction: "toward-superseding",
        state: "NOT_STARTED",
        reason: "edge-hop-bound",
      });
      expect(listSpy).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });

  it("Q15 admits an edge and its new endpoint atomically, then marks node-bound PARTIAL", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertEdge(store, edge("A", "C"));
      insertEdge(store, edge("A", "B"));
      const result = derive(store, [address("A")], ["toward-superseding"], {
        maxEdgeHops: 2,
        maxNodes: 2,
        maxEdges: 10,
      });

      expect(result.nodes).toEqual([address("A"), address("B")]);
      expect(result.edges).toEqual([edge("A", "B")]);
      expect(result.nodes).not.toContainEqual(address("C"));
      expect(result.edges).not.toContainEqual(edge("A", "C"));
      expect(observation(result, address("A"), "toward-superseding")).toEqual({
        address: address("A"),
        direction: "toward-superseding",
        state: "PARTIAL",
        reason: "node-bound",
      });
    } finally {
      store.close();
    }
  });

  it("Q16 marks every later requested observation NOT_STARTED after global node halt", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const listSpy = vi.spyOn(store, "listStoredSupersessions");

    try {
      insertEdge(store, edge("A", "B"));
      insertEdge(store, edge("A", "C"));
      const result = derive(
        store,
        [address("A")],
        ["toward-superseding", "toward-superseded"],
        { maxEdgeHops: 2, maxNodes: 2, maxEdges: 10 },
      );

      expect(
        observation(result, address("A"), "toward-superseding"),
      ).toMatchObject({ state: "PARTIAL", reason: "node-bound" });
      expect(
        observation(result, address("A"), "toward-superseded"),
      ).toMatchObject({ state: "NOT_STARTED", reason: "node-bound" });
      expect(
        observation(result, address("B"), "toward-superseding"),
      ).toMatchObject({ state: "NOT_STARTED", reason: "node-bound" });
      expect(
        observation(result, address("B"), "toward-superseded"),
      ).toMatchObject({ state: "NOT_STARTED", reason: "node-bound" });
      expect(listSpy).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });

  it("Q19 treats maxEdges zero as a pre-known global halt and executes no edge query", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const listSpy = vi.spyOn(store, "listStoredSupersessions");

    try {
      insertEdge(store, edge("A", "B"));
      const result = derive(
        store,
        [address("A")],
        ["toward-superseding", "toward-superseded"],
        { maxEdgeHops: 2, maxNodes: 10, maxEdges: 0 },
      );

      expect(result.edges).toEqual([]);
      expect(result.observations).toHaveLength(2);
      expect(result.observations).toEqual(
        expect.arrayContaining([
          {
            address: address("A"),
            direction: "toward-superseding",
            state: "NOT_STARTED",
            reason: "edge-bound",
          },
          {
            address: address("A"),
            direction: "toward-superseded",
            state: "NOT_STARTED",
            reason: "edge-bound",
          },
        ]),
      );
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it("Q20 reports COMPLETE when exactly maxEdges rows are genuinely exhausted", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertEdge(store, edge("A", "B"));
      const result = derive(store, [address("A")], ["toward-superseding"], {
        maxEdgeHops: 1,
        maxNodes: 2,
        maxEdges: 1,
      });

      expect(result.edges).toEqual([edge("A", "B")]);
      expect(observation(result, address("A"), "toward-superseding")).toEqual({
        address: address("A"),
        direction: "toward-superseding",
        state: "COMPLETE",
      });
    } finally {
      store.close();
    }
  });

  it("Q21 marks edge-bound PARTIAL when an unconsumed unique row remains", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertEdge(store, edge("A", "B"));
      insertEdge(store, edge("A", "C"));
      const listSpy = vi.spyOn(store, "listStoredSupersessions");
      const result = derive(store, [address("A")], ["toward-superseding"], {
        maxEdgeHops: 2,
        maxNodes: 3,
        maxEdges: 1,
      });

      expect(result.edges).toEqual([edge("A", "B")]);
      expect(observation(result, address("A"), "toward-superseding")).toEqual({
        address: address("A"),
        direction: "toward-superseding",
        state: "PARTIAL",
        reason: "edge-bound",
      });
      expect(observation(result, address("B"), "toward-superseding")).toEqual({
        address: address("B"),
        direction: "toward-superseding",
        state: "NOT_STARTED",
        reason: "edge-bound",
      });
      expect(listSpy).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });

  it("Q22 follows Task79 pagination beyond its maximum page before declaring COMPLETE", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      for (let index = 0; index < 1001; index += 1) {
        insertEdge(store, edge("A", `N${String(index).padStart(4, "0")}`));
      }
      const listSpy = vi.spyOn(store, "listStoredSupersessions");
      const result = derive(store, [address("A")], ["toward-superseding"], {
        maxEdgeHops: 1,
        maxNodes: 1002,
        maxEdges: 1001,
      });

      expect(result.edges).toHaveLength(1001);
      expect(result.nodes).toHaveLength(1002);
      expect(
        observation(result, address("A"), "toward-superseding"),
      ).toMatchObject({ state: "COMPLETE" });
      expect(listSpy.mock.calls.length).toBeGreaterThan(1);
      expect(listSpy.mock.calls[1]?.[0]).toMatchObject({
        superseded: address("A"),
        after: expect.any(Object),
      });
    } finally {
      store.close();
    }
  });

  it("Q23 globally halts at the first node-bound row without seeking a later fitting edge or page", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      for (let index = 0; index < 101; index += 1) {
        insertEdge(store, edge("A", `B${String(index).padStart(3, "0")}`));
      }
      insertEdge(store, edge("A", "Z"));
      const listSpy = vi.spyOn(store, "listStoredSupersessions");
      const result = derive(
        store,
        [address("A"), address("Z")],
        ["toward-superseding"],
        { maxEdgeHops: 2, maxNodes: 2, maxEdges: 200 },
      );

      expect(result.nodes).toEqual([address("A"), address("Z")]);
      expect(result.edges).toEqual([]);
      expect(
        observation(result, address("A"), "toward-superseding"),
      ).toMatchObject({ state: "PARTIAL", reason: "node-bound" });
      expect(result.edges).not.toContainEqual(edge("A", "Z"));
      expect(listSpy).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });

  it("Q29 returns closed before validating a malformed Task80 request", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();

    expectStoreError(() => callDerive(store, null), "closed");
  });

  it.each(["sideways", "forward", "backward", null])(
    "Q30 rejects unknown direction token %# as query/query",
    (direction) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () =>
            callDerive(store, {
              seeds: [address("A")],
              directions: [direction],
              bounds: generousBounds,
            }),
          "query",
          "query",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([
    { seeds: [], directions: ["toward-superseding"], bounds: generousBounds },
    { seeds: null, directions: ["toward-superseding"], bounds: generousBounds },
    { seeds: [address("A")], directions: [], bounds: generousBounds },
    { seeds: [address("A")], bounds: generousBounds },
  ])(
    "Q31 rejects empty or malformed seeds/directions %# as query/query",
    (request) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(() => callDerive(store, request), "query", "query");
      } finally {
        store.close();
      }
    },
  );

  it.each([
    ["maxEdgeHops", -1],
    ["maxEdgeHops", 1.5],
    ["maxEdgeHops", Number.MAX_SAFE_INTEGER + 1],
    ["maxNodes", -1],
    ["maxNodes", 1.5],
    ["maxNodes", Number.MAX_SAFE_INTEGER + 1],
    ["maxEdges", -1],
    ["maxEdges", 1.5],
    ["maxEdges", Number.MAX_SAFE_INTEGER + 1],
  ] as const)(
    "Q32 rejects invalid %s bound %# as query/bounds",
    (name, value) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () =>
            callDerive(store, {
              seeds: [address("A")],
              directions: ["toward-superseding"],
              bounds: { ...generousBounds, [name]: value },
            }),
          "query",
          "bounds",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each(["maxEdgeHops", "maxNodes", "maxEdges"] as const)(
    "Q32 requires the %s bound with no default",
    (missing) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      const bounds: Record<string, number> = { ...generousBounds };
      delete bounds[missing];
      try {
        expectStoreError(
          () =>
            callDerive(store, {
              seeds: [address("A")],
              directions: ["toward-superseding"],
              bounds,
            }),
          "query",
          "bounds",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([
    [address("A", "bad\0namespace"), "namespace"],
    [address("bad\0key"), "record-key"],
    [address("A", "\ud800"), "namespace"],
    [address("\udc00"), "record-key"],
  ] as const)(
    "Q33 reuses address validation for malformed seed %#",
    (seed, field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => derive(store, [seed], ["toward-superseding"], generousBounds),
          "address",
          field,
        );
      } finally {
        store.close();
      }
    },
  );
});
