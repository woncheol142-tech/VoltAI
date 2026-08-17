import { afterEach, describe, expect, it } from "vitest";

import type {
  StoredDecisionAddress,
  StoredDecisionSupersession,
} from "../src/index.js";
import { SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createDecisionRecord,
  createTempDatabase,
  jsonValueCodec,
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
  supersededNamespace = "decisions",
  supersedingNamespace = "decisions",
): StoredDecisionSupersession => ({
  supersededNamespace,
  supersededRecordKey,
  supersedingNamespace,
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

function derive(
  store: SqliteDecisionStore,
  seeds: readonly StoredDecisionAddress[],
  directions: readonly TraversalDirection[],
  bounds: TraversalRequest["bounds"] = {
    maxEdgeHops: 10,
    maxNodes: 1000,
    maxEdges: 1000,
  },
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

function expectEndpointInvariant(result: TraversalResult): void {
  const nodes = new Set(
    result.nodes.map((node) => `${node.namespace}\0${node.recordKey}`),
  );
  for (const relation of result.edges) {
    expect(
      nodes.has(
        `${relation.supersededNamespace}\0${relation.supersededRecordKey}`,
      ),
    ).toBe(true);
    expect(
      nodes.has(
        `${relation.supersedingNamespace}\0${relation.supersedingRecordKey}`,
      ),
    ).toBe(true);
  }
}

describe("Task80 structural decision supersession traversal RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q2 follows A -> B toward superseding and returns the observed structure", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = edge("A", "B");

    try {
      insertEdge(store, relation);
      const result = derive(store, [address("A")], ["toward-superseding"]);

      expect(result.nodes).toEqual([address("A"), address("B")]);
      expect(result.edges).toEqual([relation]);
      expect(observation(result, address("A"), "toward-superseding")).toEqual({
        address: address("A"),
        direction: "toward-superseding",
        state: "COMPLETE",
      });
    } finally {
      store.close();
    }
  });

  it("Q3 follows A -> B from B toward superseded", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = edge("A", "B");

    try {
      insertEdge(store, relation);
      const result = derive(store, [address("B")], ["toward-superseded"]);

      expect(result.nodes).toEqual([address("A"), address("B")]);
      expect(result.edges).toEqual([relation]);
      expect(observation(result, address("B"), "toward-superseded")).toEqual({
        address: address("B"),
        direction: "toward-superseded",
        state: "COMPLETE",
      });
    } finally {
      store.close();
    }
  });

  it("Q4 supports both directions without duplicating one stored edge", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = edge("A", "B");

    try {
      insertEdge(store, relation);
      const result = derive(
        store,
        [address("A"), address("B")],
        ["toward-superseding", "toward-superseded"],
      );

      expect(result.edges).toEqual([relation]);
      expect(result.observations).toHaveLength(4);
      expect(
        result.observations.every((item) => item.state === "COMPLETE"),
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it("Q5 deduplicates seeds by stored identity and canonicalizes caller order", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      const first = derive(
        store,
        [address("B"), address("A"), address("B")],
        ["toward-superseding"],
      );
      const second = derive(
        store,
        [address("A"), address("B")],
        ["toward-superseding"],
      );

      expect(first).toEqual(second);
      expect(first.seeds).toEqual([address("A"), address("B")]);
    } finally {
      store.close();
    }
  });

  it("Q9 represents fan-out without branch preference metadata", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const edges = [edge("A", "B"), edge("A", "C")];

    try {
      edges.forEach((relation) => insertEdge(store, relation));
      const result = derive(store, [address("A")], ["toward-superseding"]);

      expect(result.nodes).toEqual([address("A"), address("B"), address("C")]);
      expect(result.edges).toEqual(edges);
      expect(JSON.stringify(result)).not.toMatch(
        /primarySuccessor|preferredBranch|mainChain|branchRank|winner/,
      );
    } finally {
      store.close();
    }
  });

  it("Q10 represents fan-in without merge ranking metadata", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const edges = [edge("A", "C"), edge("B", "C")];

    try {
      [...edges].reverse().forEach((relation) => insertEdge(store, relation));
      const result = derive(store, [address("C")], ["toward-superseded"]);

      expect(result.nodes).toEqual([address("A"), address("B"), address("C")]);
      expect(result.edges).toEqual(edges);
      expect(JSON.stringify(result)).not.toMatch(/mergeRank|preferred|winner/);
    } finally {
      store.close();
    }
  });

  it("Q11 terminates on a stored cycle and returns each cycle edge once", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const cycle = [edge("A", "B"), edge("B", "C"), edge("C", "A")];

    try {
      cycle.forEach((relation) => insertEdge(store, relation));
      const result = derive(store, [address("A")], ["toward-superseding"]);

      expect(result.nodes).toEqual([address("A"), address("B"), address("C")]);
      expect(result.edges).toEqual(cycle);
      expect(new Set(result.edges.map(JSON.stringify)).size).toBe(3);
      expect(JSON.stringify(result)).not.toMatch(/cycle|invalid|current/);
    } finally {
      store.close();
    }
  });

  it("Q12 follows cross-namespace edges and preserves all four coordinates", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = edge("old", "new", "legacy", "modern");

    try {
      insertEdge(store, relation);
      const result = derive(
        store,
        [address("old", "legacy")],
        ["toward-superseding"],
      );

      expect(result.nodes).toEqual([
        address("old", "legacy"),
        address("new", "modern"),
      ]);
      expect(result.edges).toEqual([relation]);
      expect(JSON.stringify(result)).not.toMatch(/contextTransition|authority/);
    } finally {
      store.close();
    }
  });

  it("Q13 returns identical structure with or without endpoint decision rows", () => {
    const first = createTempDatabase("task80-dangling-");
    const second = createTempDatabase("task80-present-");
    const danglingStore = new SqliteDecisionStore(first.dbPath);
    const presentStore = new SqliteDecisionStore(second.dbPath);
    const relation = edge("A", "B", "old-space", "new-space");

    try {
      insertEdge(danglingStore, relation);
      insertEdge(presentStore, relation);
      presentStore.insertDecision(
        "old-space",
        createDecisionRecord("A"),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      presentStore.insertDecision(
        "new-space",
        createDecisionRecord("B"),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );

      const requestSeeds = [address("A", "old-space")];
      const dangling = derive(danglingStore, requestSeeds, [
        "toward-superseding",
      ]);
      const present = derive(presentStore, requestSeeds, [
        "toward-superseding",
      ]);
      expect(present).toEqual(dangling);
      expect(JSON.stringify(present)).not.toMatch(
        /recordExists|isDangling|present|absent/,
      );
    } finally {
      danglingStore.close();
      presentStore.close();
    }
  });

  it("Q14 includes both endpoints of every admitted edge in nodes", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      [edge("A", "B"), edge("B", "C"), edge("B", "D")].forEach((relation) =>
        insertEdge(store, relation),
      );
      expectEndpointInvariant(
        derive(store, [address("A")], ["toward-superseding"]),
      );
    } finally {
      store.close();
    }
  });

  it("Q17 counts unique admitted stored edge tuples", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = edge("A", "B");

    try {
      insertEdge(store, relation);
      insertEdge(store, relation);
      const result = derive(
        store,
        [address("A"), address("B")],
        ["toward-superseding", "toward-superseded"],
        { maxEdgeHops: 2, maxNodes: 2, maxEdges: 1 },
      );
      expect(result.edges).toEqual([relation]);
      expect(
        result.observations.every((item) => item.state === "COMPLETE"),
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it("Q18 deduplicates the same edge discovered from opposite directions before charging maxEdges", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = edge("A", "B");

    try {
      insertEdge(store, relation);
      const result = derive(
        store,
        [address("A"), address("B")],
        ["toward-superseding", "toward-superseded"],
        { maxEdgeHops: 1, maxNodes: 2, maxEdges: 1 },
      );

      expect(result.edges).toEqual([relation]);
      expect(result.edges).toHaveLength(1);
      expect(
        result.observations.filter((item) => item.state === "PARTIAL"),
      ).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("Q24 produces the same canonical result for opposite insertion orders", () => {
    const first = createTempDatabase("task80-order-first-");
    const second = createTempDatabase("task80-order-second-");
    const firstStore = new SqliteDecisionStore(first.dbPath);
    const secondStore = new SqliteDecisionStore(second.dbPath);
    const relations = [edge("A", "C"), edge("A", "B"), edge("B", "D")];

    try {
      relations.forEach((relation) => insertEdge(firstStore, relation));
      [...relations]
        .reverse()
        .forEach((relation) => insertEdge(secondStore, relation));

      expect(
        derive(firstStore, [address("A")], ["toward-superseding"]),
      ).toEqual(derive(secondStore, [address("A")], ["toward-superseding"]));
    } finally {
      firstStore.close();
      secondStore.close();
    }
  });

  it("Q25 produces the same canonical result for opposite seed orders", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertEdge(store, edge("A", "C"));
      const first = derive(
        store,
        [address("B"), address("A")],
        ["toward-superseding"],
      );
      const second = derive(
        store,
        [address("A"), address("B")],
        ["toward-superseding"],
      );
      expect(first).toEqual(second);
      expect(first.seeds).toEqual([address("A"), address("B")]);
    } finally {
      store.close();
    }
  });

  it("Q26 sorts output by BINARY identity rather than BFS discovery order", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relations = [edge("Z", "B"), edge("B", "A")];

    try {
      relations.forEach((relation) => insertEdge(store, relation));
      const result = derive(store, [address("Z")], ["toward-superseding"]);

      expect(result.nodes).toEqual([address("A"), address("B"), address("Z")]);
      expect(result.edges).toEqual([edge("B", "A"), edge("Z", "B")]);
    } finally {
      store.close();
    }
  });

  it("Q27 uses UTF-8 byte order where JavaScript UTF-16 order diverges", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const bmp = "\ue000";
    const nonBmp = "\u{10000}";

    try {
      expect([bmp, nonBmp].sort()).toEqual([nonBmp, bmp]);
      const result = derive(
        store,
        [address(nonBmp), address(bmp)],
        ["toward-superseding"],
      );
      expect(result.seeds).toEqual([address(bmp), address(nonBmp)]);
      expect(result.nodes).toEqual([address(bmp), address(nonBmp)]);
    } finally {
      store.close();
    }
  });

  it("Q28 returns no rowid, insertion, discovery, chronology, or rank metadata", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertEdge(store, edge("A", "B"));
      const serialized = JSON.stringify(
        derive(store, [address("A")], ["toward-superseding"]),
      );
      expect(serialized).not.toMatch(
        /rowid|insertion|discovery|chronolog|priority|rank|authority/i,
      );
    } finally {
      store.close();
    }
  });

  it("Q45 returns an observed non-induced subgraph and no unrequested direction observation", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const observed = edge("A", "B");
    const unobserved = edge("Z", "B");

    try {
      insertEdge(store, observed);
      insertEdge(store, unobserved);
      const result = derive(store, [address("A")], ["toward-superseding"]);

      expect(result.nodes).toEqual([address("A"), address("B")]);
      expect(result.edges).toEqual([observed]);
      expect(result.nodes).not.toContainEqual(address("Z"));
      expect(result.edges).not.toContainEqual(unobserved);
      expect(observation(result, address("B"), "toward-superseded")).toBe(
        undefined,
      );
    } finally {
      store.close();
    }
  });
});
