export enum ElectricalRelationshipType {
  CONNECTED_TO = "CONNECTED_TO",
  CONNECTED_VIA = "CONNECTED_VIA",
  CONTAINS = "CONTAINS",
  BELONGS_TO = "BELONGS_TO",
  REFERENCES = "REFERENCES",
  UNKNOWN = "UNKNOWN",
}

export type ElectricalRelationshipJsonValue =
  | string
  | number
  | boolean
  | null
  | ElectricalRelationshipJsonValue[]
  | { [key: string]: ElectricalRelationshipJsonValue };

export type ElectricalRelationship = {
  relationshipId: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationshipType: ElectricalRelationshipType;
  confidence: number;
  evidenceIds: string[];
  attributes: Record<string, ElectricalRelationshipJsonValue>;
  diagnostics: Record<string, ElectricalRelationshipJsonValue>;
};

export type ElectricalRelationshipStatistics = {
  relationshipCount: number;
  relationshipCountByType: Record<ElectricalRelationshipType, number>;
};

export type ElectricalRelationshipDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  page: number;
  objectIds: string[];
  relationshipCount: number;
  relationships: ElectricalRelationship[];
  statistics: ElectricalRelationshipStatistics;
  warnings: string[];
};
