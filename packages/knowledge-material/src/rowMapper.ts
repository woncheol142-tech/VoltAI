import { normalizeMaterialKnowledgeMetadata } from "./metadata.js";
import type { MaterialColumnMap, MaterialRow, MaterialSheet } from "./types.js";

type MaterialIndexShape = {
  catalogId: string;
  columnMap: MaterialColumnMap;
  headerRow?: number;
  revision?: string | null;
  effectiveDate?: string | null;
};

const mappedFields = [
  "itemCode",
  "name",
  "manufacturer",
  "model",
  "category",
  "specification",
  "unit",
  "unitPrice",
  "currency",
] as const;

type MappedField = (typeof mappedFields)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeMaterialCell(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (isRecord(value)) {
    if (typeof value.error === "string") {
      return value.error;
    }
    if ("result" in value) {
      return normalizeMaterialCell(value.result ?? null);
    }
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("");
    }
    if (typeof value.text === "string") {
      return value.text;
    }
  }

  return null;
}

function normalizeHeader(value: unknown): string {
  const normalized = normalizeMaterialCell(value);

  return typeof normalized === "string"
    ? normalized.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function toText(value: string | number | boolean | null): string | null {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function isErrorCell(value: unknown): boolean {
  return isRecord(value) && typeof value.error === "string";
}

function isExcelErrorCode(value: unknown): boolean {
  return typeof value === "string" && /^#(?:N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!)/.test(value);
}

function resolveColumnIndexes(headerValues: unknown[], columnMap: MaterialColumnMap): Map<MappedField, number> {
  const headers = new Map<string, number>();

  headerValues.forEach((value, index) => {
    const header = normalizeHeader(value);
    if (header.length === 0) {
      return;
    }
    if (headers.has(header)) {
      throw new Error(`Duplicate normalized header: ${header}`);
    }
    headers.set(header, index);
  });

  const indexes = new Map<MappedField, number>();
  for (const field of mappedFields) {
    const mappedHeader = columnMap[field];
    if (mappedHeader === undefined) {
      continue;
    }
    const index = headers.get(normalizeHeader(mappedHeader));
    if (index === undefined) {
      throw new Error(`Mapped header not found: ${mappedHeader}`);
    }
    indexes.set(field, index);
  }

  if (!indexes.has("itemCode") || !indexes.has("name")) {
    throw new Error("itemCode and name column mappings are required");
  }

  return indexes;
}

function parseUnitPrice(value: string | number | boolean | null, rowIndex: number): number | null {
  if (value === null || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+(?:,\d{3})*(?:\.\d+)?$/.test(value)) {
    return Number(value.replaceAll(",", ""));
  }

  throw new Error(`Material row ${rowIndex} unitPrice is invalid`);
}

function optionalText(value: string | number | boolean | null): string | null {
  const text = toText(value);
  return text === null || text.trim() === "" ? null : text;
}

export function mapMaterialRows(sheet: MaterialSheet, input: MaterialIndexShape): MaterialRow[] {
  if (!Number.isInteger(input.headerRow ?? 1) || (input.headerRow ?? 1) < 1) {
    throw new Error("headerRow must be a positive integer");
  }

  const headerRow = input.headerRow ?? 1;
  const header = sheet.rows.find((row) => row.rowIndex === headerRow);
  if (!header) {
    throw new Error(`Header row ${headerRow} not found`);
  }
  const indexes = resolveColumnIndexes(header.values, input.columnMap);
  const itemCodeIndex = indexes.get("itemCode") as number;
  const nameIndex = indexes.get("name") as number;
  const rows: MaterialRow[] = [];

  for (const row of sheet.rows) {
    if (row.rowIndex <= headerRow) {
      continue;
    }

    const rawItemCode = row.values[itemCodeIndex];
    const rawName = row.values[nameIndex];
    const itemCode = normalizeMaterialCell(rawItemCode);
    const name = normalizeMaterialCell(rawName);

    if (isBlank(itemCode) && isBlank(name)) {
      continue;
    }
    if (isErrorCell(rawItemCode) || isExcelErrorCode(itemCode)) {
      throw new Error(`Material row ${row.rowIndex} itemCode contains Excel error`);
    }
    if (isErrorCell(rawName) || isExcelErrorCode(name)) {
      throw new Error(`Material row ${row.rowIndex} name contains Excel error`);
    }
    if (isBlank(itemCode)) {
      throw new Error(`Material row ${row.rowIndex} itemCode is required`);
    }
    if (isBlank(name)) {
      throw new Error(`Material row ${row.rowIndex} name is required`);
    }

    const values = new Map<MappedField, string | number | boolean | null>();
    for (const field of mappedFields) {
      const index = indexes.get(field);
      values.set(field, index === undefined ? null : normalizeMaterialCell(row.values[index]));
    }

    rows.push({
      rowIndex: row.rowIndex,
      ...normalizeMaterialKnowledgeMetadata({
        catalogId: input.catalogId,
        itemCode: toText(values.get("itemCode") ?? null),
        name: toText(values.get("name") ?? null),
        manufacturer: optionalText(values.get("manufacturer") ?? null),
        model: optionalText(values.get("model") ?? null),
        category: optionalText(values.get("category") ?? null),
        specification: optionalText(values.get("specification") ?? null),
        unit: optionalText(values.get("unit") ?? null),
        unitPrice: parseUnitPrice(values.get("unitPrice") ?? null, row.rowIndex),
        currency: optionalText(values.get("currency") ?? null),
        revision: input.revision,
        effectiveDate: input.effectiveDate,
      }),
    });
  }

  return rows;
}
