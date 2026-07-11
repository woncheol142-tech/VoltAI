import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  KnowledgeCodecs,
  KnowledgeLocator,
  KnowledgeMetadata,
} from "@voltai/knowledge-core";
import { SqliteKnowledgeStore } from "../../../knowledge-sqlite/src/index.js";

export const tempRoots: string[] = [];

export class DeterministicMaterialEmbeddingProvider {
  constructor(
    private readonly provider = "test",
    private readonly model = "material-keywords",
    private readonly dimensions = 3,
  ) {}

  getMetadata(): { provider: string; model: string } {
    return { provider: this.provider, model: this.model };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();
    const values = [
      normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0,
      normalized.includes("breaker") || normalized.includes("차단기") ? 1 : 0,
      normalized.length > 0 ? 1 : 0,
    ];

    return values.slice(0, this.dimensions);
  }
}

export function createTempStore(): {
  root: string;
  dbPath: string;
  store: SqliteKnowledgeStore;
} {
  const root = mkdtempSync(join(tmpdir(), "voltai-material-knowledge-"));
  const dbPath = join(root, "knowledge.sqlite");
  tempRoots.push(root);

  return { root, dbPath, store: new SqliteKnowledgeStore(dbPath) };
}

export function cleanupTempStores(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function materialInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourcePath: "catalogs/electrical-materials.xlsx",
    catalogId: "CAT-ELEC-001",
    sheetName: "Catalog",
    columnMap: {
      itemCode: "Item Code",
      name: "Name",
      manufacturer: "Manufacturer",
      model: "Model",
      category: "Category",
      specification: "Specification",
      unit: "Unit",
      unitPrice: "Unit Price",
      currency: "Currency",
    },
    revision: "A",
    effectiveDate: "2026-07-01",
    ...overrides,
  };
}

export function materialSheet(): {
  relativePath: string;
  sheetName: string;
  rows: Array<{ rowIndex: number; values: unknown[] }>;
} {
  return {
    relativePath: "catalogs/electrical-materials.xlsx",
    sheetName: "Catalog",
    rows: [
      {
        rowIndex: 1,
        values: [
          "Item Code",
          "Name",
          "Manufacturer",
          "Model",
          "Category",
          "Specification",
          "Unit",
          "Unit Price",
          "Currency",
        ],
      },
      {
        rowIndex: 2,
        values: [
          "CB-001",
          "XLPE Cable",
          "Volt Electric",
          "X-100",
          "Cable",
          "0.6/1kV 4C 25sq",
          "m",
          12000,
          "KRW",
        ],
      },
      { rowIndex: 3, values: [] },
      {
        rowIndex: 4,
        values: [
          "BR-002",
          "MCCB Breaker",
          null,
          null,
          "Breaker",
          "3P 100A",
          "ea",
          85000,
          "KRW",
        ],
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type LegacyMetadata = { label: string };

export const legacyCollectionCodecs: KnowledgeCodecs<
  LegacyMetadata,
  KnowledgeLocator
> = {
  metadata: {
    encode: (value): KnowledgeMetadata => ({ label: value.label }),
    decode: (value): LegacyMetadata => {
      if (!isRecord(value) || typeof value.label !== "string") {
        throw new Error("invalid legacy metadata");
      }
      return { label: value.label };
    },
  },
  locator: {
    encode: (value): KnowledgeLocator => ({ ...value }),
    decode: (value): KnowledgeLocator => {
      if (
        !isRecord(value) ||
        value.kind !== "page" ||
        !Number.isInteger(value.page)
      ) {
        throw new Error("invalid legacy locator");
      }
      return { kind: "page", page: Number(value.page) };
    },
  },
};

export async function seedLegacyCollection(
  store: SqliteKnowledgeStore,
  collection: "kec" | "company",
): Promise<void> {
  await store.upsert(
    collection,
    [
      {
        chunkId: `${collection}:shared-source`,
        documentId: `${collection}:catalogs/electrical-materials.xlsx`,
        sourcePath: "catalogs/electrical-materials.xlsx",
        chunkIndex: 0,
        locator: { kind: "page", page: 1 },
        metadata: { label: collection },
        text: `${collection} fixture`,
        embedding: [1, 0, 1],
      },
    ],
    legacyCollectionCodecs,
  );
}

export async function loadMaterialDomain() {
  return import("../../../knowledge-material/src/index.js");
}
