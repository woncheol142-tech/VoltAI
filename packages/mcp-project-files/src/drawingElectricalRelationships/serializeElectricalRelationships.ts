import {
  ElectricalRelationshipType,
  type ElectricalRelationship,
  type ElectricalRelationshipDocument,
  type ElectricalRelationshipJsonValue,
  type ElectricalRelationshipStatistics,
} from "./types.js";
import { validateElectricalRelationships } from "./validateElectricalRelationships.js";

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(codepointCompare);
}

function canonicalJsonValue(
  value: ElectricalRelationshipJsonValue,
): ElectricalRelationshipJsonValue {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) {
    return Object.is(value, -0) ? 0 : value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => codepointCompare(left, right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

function projectRelationship(
  relationship: ElectricalRelationship,
): ElectricalRelationship {
  return {
    relationshipId: relationship.relationshipId,
    sourceObjectId: relationship.sourceObjectId,
    targetObjectId: relationship.targetObjectId,
    relationshipType: relationship.relationshipType,
    confidence: relationship.confidence,
    evidenceIds: canonicalStrings(relationship.evidenceIds),
    attributes: canonicalJsonValue(relationship.attributes) as Record<
      string,
      ElectricalRelationshipJsonValue
    >,
    diagnostics: canonicalJsonValue(relationship.diagnostics) as Record<
      string,
      ElectricalRelationshipJsonValue
    >,
  };
}

function projectStatistics(
  statistics: ElectricalRelationshipStatistics,
): ElectricalRelationshipStatistics {
  return {
    relationshipCount: statistics.relationshipCount,
    relationshipCountByType: {
      [ElectricalRelationshipType.CONNECTED_TO]:
        statistics.relationshipCountByType.CONNECTED_TO,
      [ElectricalRelationshipType.CONNECTED_VIA]:
        statistics.relationshipCountByType.CONNECTED_VIA,
      [ElectricalRelationshipType.CONTAINS]:
        statistics.relationshipCountByType.CONTAINS,
      [ElectricalRelationshipType.BELONGS_TO]:
        statistics.relationshipCountByType.BELONGS_TO,
      [ElectricalRelationshipType.REFERENCES]:
        statistics.relationshipCountByType.REFERENCES,
      [ElectricalRelationshipType.UNKNOWN]:
        statistics.relationshipCountByType.UNKNOWN,
    },
  };
}

function projectDocument(
  document: ElectricalRelationshipDocument,
): ElectricalRelationshipDocument {
  return {
    schemaVersion: document.schemaVersion,
    source: document.source,
    sourceSha256: document.sourceSha256,
    page: document.page,
    objectIds: canonicalStrings(document.objectIds),
    relationshipCount: document.relationshipCount,
    relationships: document.relationships
      .map(projectRelationship)
      .sort((left, right) =>
        codepointCompare(left.relationshipId, right.relationshipId)
      ),
    statistics: projectStatistics(document.statistics),
    warnings: canonicalStrings(document.warnings),
  };
}

export function serializeElectricalRelationshipDocument(
  documentValue: unknown,
): string {
  validateElectricalRelationships(documentValue);
  const projected = projectDocument(documentValue as ElectricalRelationshipDocument);
  const canonical = canonicalJsonValue(
    projected as unknown as ElectricalRelationshipJsonValue,
  );
  return `${JSON.stringify(canonical)}\n`;
}
