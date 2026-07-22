import type {
  DrawingElectricalObjectDocument,
  ElectricalAttribute,
  ElectricalObject,
  ElectricalObjectType,
} from "../../src/drawingElectricalObjects/types.js";
import {
  ElectricalRelationshipType,
  type ElectricalRelationship,
  type ElectricalRelationshipDocument,
} from "../../src/drawingElectricalRelationships/types.js";

export const PROJECTION_SOURCE = "docs/electrical-projection.pdf";
export const PROJECTION_SOURCE_SHA256 = "d".repeat(64);
export const PROJECTION_PAGE = 15;

export const ELECTRICAL_OBJECT_TYPES = [
  "lighting",
  "outlet",
  "panel",
  "breaker",
  "transformer",
  "ground",
  "cable",
  "conduit",
  "equipment",
  "annotation",
  "unknown",
] as const satisfies readonly ElectricalObjectType[];

type ObjectFixtureOptions = {
  id?: string;
  type?: ElectricalObjectType;
  displayName?: string | null;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  status?: "accepted" | "review";
};

type ObjectDocumentOptions = {
  objects?: readonly ElectricalObject[];
  source?: string;
  sourceSha256?: string;
  page?: number;
  warnings?: readonly string[];
};

type RelationshipFixtureOptions = Partial<ElectricalRelationship> & {
  relationshipType?: ElectricalRelationshipType;
};

type RelationshipDocumentOptions = {
  objectIds?: readonly string[];
  relationships?: readonly ElectricalRelationship[];
  source?: string;
  sourceSha256?: string;
  page?: number;
  warnings?: readonly string[];
  preserveRelationshipOrder?: boolean;
  preserveObjectIdOrder?: boolean;
};

export type ProjectionInputFixture = {
  objectDocument: DrawingElectricalObjectDocument;
  relationshipDocument: ElectricalRelationshipDocument;
};

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function makeAttribute(
  value: string,
  textEntityId: string,
): ElectricalAttribute<string> {
  return {
    value,
    rawText: value,
    confidence: 1,
    textEntityIds: [textEntityId],
    sourceRelationIds: [],
    parserRuleId: "fixture.projection.attribute",
  };
}

function commonAttributes(name: ElectricalAttribute<string> | null) {
  return {
    name,
    tag: null,
    phase: null,
    capacity: null,
    circuit: null,
    voltage: null,
    remarks: null,
  };
}

function attributesFor(
  type: ElectricalObjectType,
  name: ElectricalAttribute<string> | null,
): ElectricalObject["attributes"] {
  if (type === "unknown") {
    return { name, tag: null, remarks: null };
  }
  const common = commonAttributes(name);
  if (type === "breaker") {
    return {
      ...common,
      rating: null,
      breakerKind: makeAttribute(
        "MCCB",
        name?.textEntityIds[0] ?? "label-kind",
      ),
      poles: null,
      frameAmpere: null,
      tripAmpere: null,
    };
  }
  if (type === "panel" || type === "transformer" || type === "cable") {
    return { ...common, rating: null };
  }
  return common;
}

function emptyObjectTypeCounts(): Record<ElectricalObjectType, number> {
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

function emptyRelationshipTypeCounts(): Record<
  ElectricalRelationshipType,
  number
> {
  return {
    [ElectricalRelationshipType.CONNECTED_TO]: 0,
    [ElectricalRelationshipType.CONNECTED_VIA]: 0,
    [ElectricalRelationshipType.CONTAINS]: 0,
    [ElectricalRelationshipType.BELONGS_TO]: 0,
    [ElectricalRelationshipType.REFERENCES]: 0,
    [ElectricalRelationshipType.UNKNOWN]: 0,
  };
}

export function createObjectFixture(
  options: ObjectFixtureOptions = {},
): ElectricalObject {
  const id = options.id ?? "object-a";
  const type = options.type ?? "breaker";
  const displayName =
    options.displayName === undefined ? `name-${id}` : options.displayName;
  const labelId = `label-${id}`;
  const name =
    displayName === null ? null : makeAttribute(displayName, labelId);
  return {
    id,
    type,
    status: options.status ?? "accepted",
    bbox: options.bbox ?? { x: 10, y: 20, width: 30, height: 40 },
    primitiveIds: [`primitive-${id}`],
    labels:
      displayName === null
        ? []
        : [{ textEntityType: "item", textEntityId: labelId, role: "name" }],
    attributes: attributesFor(type, name),
    confidence: options.confidence ?? 1,
    sourceRelationIds: [],
    diagnostics: {
      ruleId: `fixture.${type}`,
      confidenceComponents: {
        structural: options.confidence ?? 1,
        label: options.confidence ?? 1,
        spatial: options.confidence ?? 1,
        attribute: options.confidence ?? 1,
        consistency: options.confidence ?? 1,
      },
      conflicts: [],
    },
  } as ElectricalObject;
}

export function createElectricalObjectDocumentFixture(
  options: ObjectDocumentOptions = {},
): DrawingElectricalObjectDocument {
  const objects = [...(options.objects ?? [])].sort((left, right) =>
    codepointCompare(left.id, right.id),
  );
  const objectCountByType = emptyObjectTypeCounts();
  for (const object of objects) objectCountByType[object.type] += 1;
  const warnings = [...(options.warnings ?? [])].sort(codepointCompare);
  return {
    schemaVersion: 1,
    source: options.source ?? PROJECTION_SOURCE,
    sourceSha256: options.sourceSha256 ?? PROJECTION_SOURCE_SHA256,
    page: options.page ?? PROJECTION_PAGE,
    pageWidth: 612,
    pageHeight: 792,
    objectCount: objects.length,
    objects,
    constructionGraph: {
      objectIds: objects.map(({ id }) => id),
      edges: [],
      components: objects.map(({ id }, index) => ({
        id: `source-component-${String(index).padStart(6, "0")}`,
        objectIds: [id],
        edgeIds: [],
      })),
    },
    statistics: {
      candidateCount: objects.length,
      acceptedObjectCount: objects.filter(({ status }) => status === "accepted")
        .length,
      reviewObjectCount: objects.filter(({ status }) => status === "review")
        .length,
      excludedCandidateCount: 0,
      conflictCount: 0,
      objectCountByType,
      warningCount: warnings.length,
    },
    warnings,
  };
}

export function createRelationshipFixture(
  options: RelationshipFixtureOptions = {},
): ElectricalRelationship {
  const relationshipType =
    options.relationshipType ?? ElectricalRelationshipType.CONNECTED_TO;
  return {
    relationshipId: options.relationshipId ?? "relationship-a",
    sourceObjectId: options.sourceObjectId ?? "object-a",
    targetObjectId: options.targetObjectId ?? "object-b",
    relationshipType,
    confidence: options.confidence ?? 0.9,
    evidenceIds: options.evidenceIds ?? ["evidence-a"],
    attributes:
      options.attributes ??
      (relationshipType === ElectricalRelationshipType.CONNECTED_VIA
        ? { viaObjectId: "object-via" }
        : { circuit: "C1" }),
    diagnostics: options.diagnostics ?? {
      ruleId: "fixture.relationship",
    },
  };
}

export function createConnectedToRelationship(
  options: RelationshipFixtureOptions = {},
): ElectricalRelationship {
  return createRelationshipFixture({
    ...options,
    relationshipType: ElectricalRelationshipType.CONNECTED_TO,
  });
}

export function createConnectedViaRelationship(
  options: RelationshipFixtureOptions = {},
): ElectricalRelationship {
  return createRelationshipFixture({
    ...options,
    relationshipType: ElectricalRelationshipType.CONNECTED_VIA,
  });
}

export function createContainsRelationship(
  options: RelationshipFixtureOptions = {},
): ElectricalRelationship {
  return createRelationshipFixture({
    ...options,
    relationshipType: ElectricalRelationshipType.CONTAINS,
  });
}

export function createBelongsToRelationship(
  options: RelationshipFixtureOptions = {},
): ElectricalRelationship {
  return createRelationshipFixture({
    ...options,
    relationshipType: ElectricalRelationshipType.BELONGS_TO,
  });
}

export function createReferenceRelationship(
  options: RelationshipFixtureOptions = {},
): ElectricalRelationship {
  return createRelationshipFixture({
    ...options,
    relationshipType: ElectricalRelationshipType.REFERENCES,
  });
}

export function createElectricalRelationshipDocumentFixture(
  options: RelationshipDocumentOptions = {},
): ElectricalRelationshipDocument {
  const objectIds = [...(options.objectIds ?? [])];
  if (!options.preserveObjectIdOrder) objectIds.sort(codepointCompare);
  const relationships = [...(options.relationships ?? [])];
  if (!options.preserveRelationshipOrder) {
    relationships.sort((left, right) =>
      codepointCompare(left.relationshipId, right.relationshipId),
    );
  }
  const relationshipCountByType = emptyRelationshipTypeCounts();
  for (const relationship of relationships) {
    relationshipCountByType[relationship.relationshipType] += 1;
  }
  const warnings = [...(options.warnings ?? [])].sort(codepointCompare);
  return {
    schemaVersion: 1,
    source: options.source ?? PROJECTION_SOURCE,
    sourceSha256: options.sourceSha256 ?? PROJECTION_SOURCE_SHA256,
    page: options.page ?? PROJECTION_PAGE,
    objectIds,
    relationshipCount: relationships.length,
    relationships,
    statistics: {
      relationshipCount: relationships.length,
      relationshipCountByType,
    },
    warnings,
  };
}

export function createProjectionInputFixture(
  options: {
    objects?: readonly ElectricalObject[];
    relationships?: readonly ElectricalRelationship[];
    objectWarnings?: readonly string[];
    relationshipWarnings?: readonly string[];
  } = {},
): ProjectionInputFixture {
  const objects = options.objects ?? [
    createObjectFixture({ id: "object-a", type: "panel" }),
    createObjectFixture({ id: "object-b", type: "breaker" }),
  ];
  const objectDocument = createElectricalObjectDocumentFixture({
    objects,
    warnings: options.objectWarnings,
  });
  return {
    objectDocument,
    relationshipDocument: createElectricalRelationshipDocumentFixture({
      objectIds: objectDocument.objects.map(({ id }) => id),
      relationships: options.relationships ?? [],
      warnings: options.relationshipWarnings,
    }),
  };
}

export function createLargeProjectionInputFixture(
  mode: "connected-chain" | "reference-chain" | "reference-cycle" | "pairs",
  objectCount = 20_000,
): ProjectionInputFixture {
  const objects = Array.from({ length: objectCount }, (_, index) =>
    createObjectFixture({
      id: `object-${String(index).padStart(6, "0")}`,
      type: "unknown",
      displayName: null,
      bbox: { x: index, y: 0, width: 1, height: 1 },
    }),
  );
  const relationshipType =
    mode === "connected-chain" || mode === "pairs"
      ? ElectricalRelationshipType.CONNECTED_TO
      : ElectricalRelationshipType.REFERENCES;
  const endpointPairs: Array<readonly [number, number]> = [];
  if (mode === "pairs") {
    for (let index = 0; index + 1 < objectCount; index += 2) {
      endpointPairs.push([index, index + 1]);
    }
  } else {
    for (let index = 0; index + 1 < objectCount; index += 1) {
      endpointPairs.push([index, index + 1]);
    }
    if (mode === "reference-cycle" && objectCount > 1) {
      endpointPairs.push([objectCount - 1, 0]);
    }
  }
  const relationships = endpointPairs.map(([source, target], index) =>
    createRelationshipFixture({
      relationshipId: `relationship-${String(index).padStart(6, "0")}`,
      sourceObjectId: objects[source]!.id,
      targetObjectId: objects[target]!.id,
      relationshipType,
      evidenceIds: [],
      attributes: {},
      diagnostics: {},
    }),
  );
  return createProjectionInputFixture({ objects, relationships });
}

export function deepFreezeProjectionFixture<T>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezeProjectionFixture(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}
