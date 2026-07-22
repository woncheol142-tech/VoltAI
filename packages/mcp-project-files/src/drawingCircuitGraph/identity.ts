import { createHash } from "node:crypto";

import { canonicalizeCircuitJsonValue } from "./jsonValue.js";
import { canonicalUniqueStrings, codepointCompare } from "./ordering.js";
import {
  CircuitBoundaryRole,
  CircuitBoundaryType,
  CircuitEdgeType,
  type CircuitEdgeDirection,
  type CircuitJsonValue,
} from "./types.js";

const IDENTITY_VERSION = 1;
const EDGE_TYPE_SET = new Set<unknown>(Object.values(CircuitEdgeType));
const DIRECTION_SET = new Set<unknown>(["FORWARD", "UNDIRECTED"]);
const BOUNDARY_TYPE_SET = new Set<unknown>(Object.values(CircuitBoundaryType));
const BOUNDARY_ROLE_SET = new Set<unknown>(Object.values(CircuitBoundaryRole));

export type CircuitNodeIdentityInput = {
  sourceSha256: string;
  page: number;
  objectIds: readonly string[];
  nodeRole: string;
};

export type CircuitEdgeIdentityInput = {
  relationshipId: string;
  edgeType: CircuitEdgeType;
  direction: CircuitEdgeDirection;
  sourceNodeId: string;
  targetNodeId: string;
  segmentRole: string;
};

export type CircuitComponentIdentityInput = {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
};

export type CircuitBoundaryIdentityInput = {
  nodeId: string;
  externalReferenceId: string;
  boundaryType: CircuitBoundaryType;
  boundaryRole: CircuitBoundaryRole;
};

export type CircuitGraphIdentityInput = {
  schemaVersion: 1;
  projectionProfile: string;
  projectionProfileVersion: number;
  source: string;
  sourceSha256: string;
  page: number;
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  componentIds: readonly string[];
  boundaryIds: readonly string[];
};

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertSourceIdentity(sourceSha256: string, page: number): void {
  if (!/^[a-f0-9]{64}$/u.test(sourceSha256)) {
    throw new Error("sourceSha256 must be 64 lowercase hex characters");
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("page must be a positive integer");
  }
}

function stableIdentity(prefix: string, payload: CircuitJsonValue): string {
  const canonical = JSON.stringify(canonicalizeCircuitJsonValue(payload));
  return `${prefix}${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function createCircuitNodeId(input: CircuitNodeIdentityInput): string {
  assertSourceIdentity(input.sourceSha256, input.page);
  assertNonEmpty(input.nodeRole, "nodeRole");
  const objectIds = canonicalUniqueStrings(input.objectIds, "objectIds");
  return stableIdentity("cgn_", {
    identityVersion: IDENTITY_VERSION,
    sourceSha256: input.sourceSha256,
    page: input.page,
    objectIds,
    nodeRole: input.nodeRole,
  });
}

export function createCircuitEdgeId(input: CircuitEdgeIdentityInput): string {
  assertNonEmpty(input.relationshipId, "relationshipId");
  assertNonEmpty(input.sourceNodeId, "sourceNodeId");
  assertNonEmpty(input.targetNodeId, "targetNodeId");
  assertNonEmpty(input.segmentRole, "segmentRole");
  if (!EDGE_TYPE_SET.has(input.edgeType))
    throw new Error("edge type is invalid");
  if (!DIRECTION_SET.has(input.direction))
    throw new Error("edge direction is invalid");
  if (input.sourceNodeId === input.targetNodeId) {
    throw new Error("Circuit edge endpoints must be distinct");
  }
  const endpoints =
    input.direction === "UNDIRECTED"
      ? [input.sourceNodeId, input.targetNodeId].sort(codepointCompare)
      : [input.sourceNodeId, input.targetNodeId];
  return stableIdentity("cge_", {
    identityVersion: IDENTITY_VERSION,
    relationshipId: input.relationshipId,
    edgeType: input.edgeType,
    direction: input.direction,
    sourceNodeId: endpoints[0]!,
    targetNodeId: endpoints[1]!,
    segmentRole: input.segmentRole,
  });
}

export function createCircuitComponentId(
  input: CircuitComponentIdentityInput,
): string {
  const nodeIds = canonicalUniqueStrings(input.nodeIds, "component nodeIds");
  const edgeIds = canonicalUniqueStrings(input.edgeIds, "component edgeIds", {
    allowEmpty: true,
  });
  return stableIdentity("cgc_", {
    identityVersion: IDENTITY_VERSION,
    nodeIds,
    edgeIds,
  });
}

export function createCircuitBoundaryId(
  input: CircuitBoundaryIdentityInput,
): string {
  assertNonEmpty(input.nodeId, "boundary nodeId");
  assertNonEmpty(input.externalReferenceId, "externalReferenceId");
  if (!BOUNDARY_TYPE_SET.has(input.boundaryType)) {
    throw new Error("boundary type is invalid");
  }
  if (!BOUNDARY_ROLE_SET.has(input.boundaryRole)) {
    throw new Error("boundary role is invalid");
  }
  return stableIdentity("cgb_", {
    identityVersion: IDENTITY_VERSION,
    nodeId: input.nodeId,
    externalReferenceId: input.externalReferenceId,
    boundaryType: input.boundaryType,
    boundaryRole: input.boundaryRole,
  });
}

export function createCircuitGraphId(input: CircuitGraphIdentityInput): string {
  if (input.schemaVersion !== 1)
    throw new Error("graph schemaVersion must be 1");
  assertSourceIdentity(input.sourceSha256, input.page);
  assertNonEmpty(input.source, "source");
  assertNonEmpty(input.projectionProfile, "projectionProfile");
  if (
    !Number.isInteger(input.projectionProfileVersion) ||
    input.projectionProfileVersion < 1
  ) {
    throw new Error("projectionProfileVersion must be a positive integer");
  }
  return stableIdentity("cgg_", {
    identityVersion: IDENTITY_VERSION,
    schemaVersion: input.schemaVersion,
    projectionProfile: input.projectionProfile,
    projectionProfileVersion: input.projectionProfileVersion,
    source: input.source,
    sourceSha256: input.sourceSha256,
    page: input.page,
    nodeIds: canonicalUniqueStrings(input.nodeIds, "graph nodeIds", {
      allowEmpty: true,
    }),
    edgeIds: canonicalUniqueStrings(input.edgeIds, "graph edgeIds", {
      allowEmpty: true,
    }),
    componentIds: canonicalUniqueStrings(
      input.componentIds,
      "graph componentIds",
      {
        allowEmpty: true,
      },
    ),
    boundaryIds: canonicalUniqueStrings(
      input.boundaryIds,
      "graph boundaryIds",
      {
        allowEmpty: true,
      },
    ),
  });
}
