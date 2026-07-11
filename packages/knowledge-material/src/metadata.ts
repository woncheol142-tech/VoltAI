import type {
  KnowledgeCodecs,
  KnowledgeLocator,
  KnowledgeLocatorCodec,
  KnowledgeMetadata,
  KnowledgeMetadataCodec,
  TableLocator,
} from "@voltai/knowledge-core";

import type { MaterialKnowledgeMetadata } from "./types.js";

const optionalFields = [
  "manufacturer",
  "model",
  "category",
  "specification",
  "unit",
  "currency",
  "revision",
  "effectiveDate",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }

  return value;
}

function normalizeUnitPrice(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("unitPrice must be a finite number greater than or equal to zero");
  }

  return value;
}

function validateEffectiveDate(value: string | null): string | null {
  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("effectiveDate must use YYYY-MM-DD");
  }

  return value;
}

export function normalizeMaterialKnowledgeMetadata(input: unknown): MaterialKnowledgeMetadata {
  if (!isRecord(input)) {
    throw new Error("Material metadata is required");
  }

  const metadata = {
    catalogId: requireNonBlankString(input.catalogId, "catalogId"),
    itemCode: requireNonBlankString(input.itemCode, "itemCode"),
    name: requireNonBlankString(input.name, "name"),
    manufacturer: null,
    model: null,
    category: null,
    specification: null,
    unit: null,
    unitPrice: normalizeUnitPrice(input.unitPrice),
    currency: null,
    revision: null,
    effectiveDate: null,
  } as MaterialKnowledgeMetadata;

  for (const field of optionalFields) {
    metadata[field] = input[field] === undefined ? null : nullableString(input[field], field);
  }
  metadata.effectiveDate = validateEffectiveDate(metadata.effectiveDate);

  return metadata;
}

function decodeMaterialKnowledgeMetadata(value: unknown): MaterialKnowledgeMetadata {
  if (!isRecord(value)) {
    throw new Error("Material metadata is invalid");
  }

  for (const field of [...optionalFields, "unitPrice"] as const) {
    if (!(field in value) || value[field] === undefined) {
      throw new Error(`Material metadata ${field} must be stored explicitly`);
    }
  }

  return normalizeMaterialKnowledgeMetadata(value);
}

export const materialKnowledgeMetadataCodec: KnowledgeMetadataCodec<MaterialKnowledgeMetadata> = {
  encode: (value): KnowledgeMetadata => ({ ...decodeMaterialKnowledgeMetadata(value) }),
  decode: decodeMaterialKnowledgeMetadata,
};

function decodeTableLocator(value: unknown): TableLocator {
  if (
    !isRecord(value) ||
    value.kind !== "table" ||
    typeof value.table !== "string" ||
    value.table.trim().length === 0 ||
    !Number.isInteger(value.rowIndex) ||
    Number(value.rowIndex) < 1
  ) {
    throw new Error("Material locator must be a TableLocator with a positive rowIndex");
  }

  return {
    kind: "table",
    table: value.table,
    rowIndex: Number(value.rowIndex),
  };
}

export const materialTableLocatorCodec: KnowledgeLocatorCodec<TableLocator> = {
  encode: (value): KnowledgeLocator => decodeTableLocator(value),
  decode: decodeTableLocator,
};

export const materialKnowledgeCodecs: KnowledgeCodecs<MaterialKnowledgeMetadata, TableLocator> = {
  metadata: materialKnowledgeMetadataCodec,
  locator: materialTableLocatorCodec,
};
