import type {
  KnowledgeCodecs,
  KnowledgeLocator,
  KnowledgeLocatorCodec,
  KnowledgeMetadata,
  KnowledgeMetadataCodec,
  PageLocator,
} from "@voltai/knowledge-core";

import type { CompanyKnowledgeMetadata } from "./types.js";

const optionalMetadataFields = [
  "section",
  "revision",
  "effectiveDate",
  "department",
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

function assertEffectiveDate(value: string | null): string | null {
  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("effectiveDate must use YYYY-MM-DD");
  }

  return value;
}

export function normalizeCompanyKnowledgeMetadata(
  input: unknown,
): CompanyKnowledgeMetadata {
  if (!isRecord(input)) {
    throw new Error("Company metadata is required");
  }

  const metadata = {
    standardId: requireNonBlankString(input.standardId, "standardId"),
    title: requireNonBlankString(input.title, "title"),
    section: null,
    revision: null,
    effectiveDate: null,
    department: null,
  } as CompanyKnowledgeMetadata;

  for (const field of optionalMetadataFields) {
    const value = input[field];
    metadata[field] =
      value === undefined ? null : nullableString(value, field);
  }
  metadata.effectiveDate = assertEffectiveDate(metadata.effectiveDate);

  return metadata;
}

function decodeCompanyKnowledgeMetadata(value: unknown): CompanyKnowledgeMetadata {
  if (!isRecord(value)) {
    throw new Error("Company metadata is invalid");
  }

  for (const field of optionalMetadataFields) {
    if (!(field in value) || value[field] === undefined) {
      throw new Error(`Company metadata ${field} must be stored as string or null`);
    }
  }

  return normalizeCompanyKnowledgeMetadata(value);
}

export const companyKnowledgeMetadataCodec: KnowledgeMetadataCodec<CompanyKnowledgeMetadata> = {
  encode: (value): KnowledgeMetadata => ({ ...decodeCompanyKnowledgeMetadata(value) }),
  decode: decodeCompanyKnowledgeMetadata,
};

function decodePageLocator(value: unknown): PageLocator {
  if (
    !isRecord(value) ||
    value.kind !== "page" ||
    !Number.isInteger(value.page) ||
    Number(value.page) < 1
  ) {
    throw new Error("Company locator must be a positive PageLocator");
  }

  return { kind: "page", page: Number(value.page) };
}

export const companyPageLocatorCodec: KnowledgeLocatorCodec<PageLocator> = {
  encode: (value): KnowledgeLocator => decodePageLocator(value),
  decode: decodePageLocator,
};

export const companyKnowledgeCodecs: KnowledgeCodecs<CompanyKnowledgeMetadata, PageLocator> = {
  metadata: companyKnowledgeMetadataCodec,
  locator: companyPageLocatorCodec,
};
