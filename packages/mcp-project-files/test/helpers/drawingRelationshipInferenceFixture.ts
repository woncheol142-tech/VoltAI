import { fileURLToPath } from "node:url";

import {
  buildElectricalConstructionGraph,
  type ConstructionGraphEdgeInput,
} from "../../src/drawingElectricalObjects/constructionGraph.js";
import type {
  DrawingElectricalObjectDocument,
  ElectricalObject,
} from "../../src/drawingElectricalObjects/types.js";
import type { ElectricalRelationshipType } from "../../src/drawingElectricalRelationships/types.js";
import { createRelationshipCandidateId } from "../../src/drawingElectricalRelationshipInference/candidate.js";
import { makeElectricalObjectDocument } from "./drawingElectricalObjectsFixture.js";

export type RelationshipConfidenceComponentsFixture = {
  endpoint: number;
  ruleMatch: number;
  evidence: number;
  consistency: number;
};

export type RelationshipCandidateFixture = {
  candidateId: string;
  ruleId: string;
  priority: number;
  sourceObjectId: string;
  targetObjectId: string;
  relationshipType: ElectricalRelationshipType;
  hardGatePassed: boolean;
  spatialSpecificity: number;
  confidenceComponents: RelationshipConfidenceComponentsFixture;
  rawConfidence: number;
  confidence: number;
  evidenceIds: string[];
  attributes: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

type InferenceDocumentOptions = {
  empty?: boolean;
  reverseObjects?: boolean;
  reverseEdges?: boolean;
};

function makeObject(seed: string, primitiveId: string): ElectricalObject {
  const object = structuredClone(
    makeElectricalObjectDocument().objects[0],
  ) as ElectricalObject;
  object.id = seed.repeat(24);
  object.primitiveIds = [primitiveId];
  object.labels = object.labels.map((label) => ({
    ...label,
    textEntityId: `item-${seed}`,
  }));
  object.sourceRelationIds = [`spatial-object-${seed}`];
  return object;
}

function emptyObjectCountByType() {
  return {
    lighting: 0,
    outlet: 0,
    panel: 0,
    breaker: 0,
    transformer: 0,
    ground: 0,
    cable: 0,
    conduit: 0,
    equipment: 0,
    annotation: 0,
    unknown: 0,
  };
}

export function makeRelationshipInferenceDocument(
  options: InferenceDocumentOptions = {},
): DrawingElectricalObjectDocument {
  const objects = options.empty
    ? []
    : [
        makeObject("a", "primitive-a"),
        makeObject("b", "primitive-b"),
        makeObject("c", "primitive-c"),
      ];
  const edgeInputs: ConstructionGraphEdgeInput[] = options.empty
    ? []
    : [
        {
          type: "endpoint-contact",
          objectIds: ["a".repeat(24), "b".repeat(24)],
          primitiveIds: ["primitive-a", "primitive-b"],
          sourceRelationIds: ["spatial-endpoint-contact"],
        },
        {
          type: "bbox-touch",
          objectIds: ["b".repeat(24), "c".repeat(24)],
          primitiveIds: ["primitive-b", "primitive-c"],
          sourceRelationIds: ["spatial-bbox-touch"],
        },
      ];
  const graphInputObjects = options.reverseObjects ? [...objects].reverse() : objects;
  const orderedEdges = options.reverseEdges ? [...edgeInputs].reverse() : edgeInputs;
  for (const object of objects) {
    const graphRelationIds = edgeInputs
      .filter((edge) => edge.objectIds.includes(object.id))
      .flatMap((edge) => edge.sourceRelationIds);
    object.sourceRelationIds = [...new Set([
      ...object.sourceRelationIds,
      ...graphRelationIds,
    ])].sort();
  }
  const objectCountByType = emptyObjectCountByType();
  objectCountByType.breaker = objects.length;

  return {
    schemaVersion: 1,
    source: "docs/electrical.pdf",
    sourceSha256: "a".repeat(64),
    page: 15,
    pageWidth: 200,
    pageHeight: 200,
    objectCount: objects.length,
    objects,
    constructionGraph: buildElectricalConstructionGraph(
      graphInputObjects,
      orderedEdges,
    ),
    statistics: {
      candidateCount: objects.length,
      acceptedObjectCount: objects.length,
      reviewObjectCount: 0,
      excludedCandidateCount: 0,
      conflictCount: 0,
      objectCountByType,
      warningCount: 0,
    },
    warnings: [],
  };
}

export function endpointContactEvidenceId(
  document: DrawingElectricalObjectDocument,
): string {
  const edge = document.constructionGraph.edges.find(
    (candidate) => candidate.type === "endpoint-contact",
  );
  if (!edge) throw new Error("Synthetic endpoint-contact edge is missing");
  return `graph-edge:${edge.id}`;
}

export function makeRelationshipCandidate(
  document = makeRelationshipInferenceDocument(),
  overrides: Partial<RelationshipCandidateFixture> = {},
): RelationshipCandidateFixture {
  const relationshipType = overrides.relationshipType ?? "CONNECTED_TO";
  const candidateWithoutId = {
    ruleId: overrides.ruleId ?? "synthetic.connected-to",
    priority: overrides.priority ?? 100,
    sourceObjectId: overrides.sourceObjectId ?? "a".repeat(24),
    targetObjectId: overrides.targetObjectId ?? "b".repeat(24),
    relationshipType,
    hardGatePassed: overrides.hardGatePassed ?? true,
    spatialSpecificity: overrides.spatialSpecificity ?? 3,
    confidenceComponents: overrides.confidenceComponents ?? {
      endpoint: 1,
      ruleMatch: 1,
      evidence: 1,
      consistency: 1,
    },
    rawConfidence: overrides.rawConfidence ?? 1,
    confidence: overrides.confidence ?? 1,
    evidenceIds: overrides.evidenceIds ?? [endpointContactEvidenceId(document)],
    attributes: overrides.attributes ?? (
      relationshipType === "CONNECTED_VIA"
        ? { viaObjectId: "c".repeat(24) }
        : {}
    ),
    diagnostics: overrides.diagnostics ?? {
      ruleId: overrides.ruleId ?? "synthetic.connected-to",
    },
  };
  return {
    candidateId: overrides.candidateId ?? createRelationshipCandidateId(candidateWithoutId),
    ...candidateWithoutId,
  };
}

export function makeRelationshipRule(
  document = makeRelationshipInferenceDocument(),
  overrides: Partial<{
    id: string;
    relationshipType: ElectricalRelationshipType;
    priority: number;
    generate: (context: unknown) => readonly unknown[];
  }> = {},
) {
  const id = overrides.id ?? "synthetic.connected-to";
  return {
    id,
    relationshipType: overrides.relationshipType ?? "CONNECTED_TO",
    priority: overrides.priority ?? 100,
    generate: overrides.generate ?? (() => [
      makeRelationshipCandidate(document, { ruleId: id }),
    ]),
  };
}

export function deepFreezeInferenceFixture(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  for (const child of Reflect.ownKeys(value)) {
    deepFreezeInferenceFixture(Reflect.get(value, child));
  }
  Object.freeze(value);
}

export async function importRelationshipInferenceModule<T>(
  fileName: string,
): Promise<T> {
  const moduleUrl = new URL(
    `../../src/drawingElectricalRelationshipInference/${fileName}.ts`,
    import.meta.url,
  );
  return import(/* @vite-ignore */ fileURLToPath(moduleUrl)) as Promise<T>;
}
