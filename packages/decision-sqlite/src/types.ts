import type {
  DecisionRecordKeyCodec,
  DecisionValueCodec,
  JsonValue,
} from "@voltai/knowledge-core";

export type DecisionIdentityNamespace<
  TDecisionRecordId extends NonNullable<unknown>,
> = {
  readonly namespace: string;
  readonly keyCodec: DecisionRecordKeyCodec<TDecisionRecordId>;
};

export type DecisionRecordValueCodecs<TSelection, TContext> = {
  readonly selection: DecisionValueCodec<TSelection>;
  readonly context: DecisionValueCodec<TContext>;
};

export type StoredDecisionAddress = {
  readonly namespace: string;
  readonly recordKey: string;
};

export type StoredDecisionRecord = {
  readonly address: StoredDecisionAddress;
  readonly selection: JsonValue;
  readonly context: JsonValue;
};

export type StoredDecisionSupersession = {
  readonly supersededNamespace: string;
  readonly supersededRecordKey: string;
  readonly supersedingNamespace: string;
  readonly supersedingRecordKey: string;
};

export type StoredDecisionSupersessionDirection =
  "toward-superseding" | "toward-superseded";

export type StoredDecisionSupersessionSubgraphRequest = {
  readonly seeds: readonly StoredDecisionAddress[];
  readonly directions: readonly StoredDecisionSupersessionDirection[];
  readonly bounds: {
    readonly maxEdgeHops: number;
    readonly maxNodes: number;
    readonly maxEdges: number;
  };
};

export type StoredDecisionSupersessionObservation =
  | {
      readonly address: StoredDecisionAddress;
      readonly direction: StoredDecisionSupersessionDirection;
      readonly state: "COMPLETE";
      readonly reason?: never;
    }
  | {
      readonly address: StoredDecisionAddress;
      readonly direction: StoredDecisionSupersessionDirection;
      readonly state: "NOT_STARTED";
      readonly reason: "edge-hop-bound" | "node-bound" | "edge-bound";
    }
  | {
      readonly address: StoredDecisionAddress;
      readonly direction: StoredDecisionSupersessionDirection;
      readonly state: "PARTIAL";
      readonly reason: "node-bound" | "edge-bound";
    };

export type StoredDecisionSupersessionSubgraph = {
  readonly seeds: readonly StoredDecisionAddress[];
  readonly nodes: readonly StoredDecisionAddress[];
  readonly edges: readonly StoredDecisionSupersession[];
  readonly observations: readonly StoredDecisionSupersessionObservation[];
};
