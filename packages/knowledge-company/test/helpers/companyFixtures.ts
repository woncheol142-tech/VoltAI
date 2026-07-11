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

export class DeterministicCompanyEmbeddingProvider {
  constructor(
    private readonly provider = "test",
    private readonly model = "company-keywords",
    private readonly dimensions = 3,
  ) {}

  getMetadata(): { provider: string; model: string } {
    return { provider: this.provider, model: this.model };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();
    const values = [
      normalized.includes("ground") || normalized.includes("접지") ? 1 : 0,
      normalized.includes("procurement") || normalized.includes("구매") ? 1 : 0,
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
  const root = mkdtempSync(join(tmpdir(), "voltai-company-knowledge-"));
  const dbPath = join(root, "knowledge.sqlite");
  tempRoots.push(root);

  return { root, dbPath, store: new SqliteKnowledgeStore(dbPath) };
}

export function cleanupTempStores(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function companyInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourcePath: "standards/electrical-standard.pdf",
    standardId: "CS-ELEC-001",
    title: "Electrical Design Standard",
    revision: "A",
    effectiveDate: "2026-07-01",
    department: "Engineering",
    ...overrides,
  };
}

export function companyPages(): Array<{ page: number; text: string }> {
  return [
    {
      page: 1,
      text: "Grounding conductors shall follow the company grounding standard.",
    },
    {
      page: 2,
      text: "Procurement forms are retained by the purchasing department.",
    },
  ];
}

type KecFixtureMetadata = { clause: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const kecFixtureCodecs: KnowledgeCodecs<
  KecFixtureMetadata,
  KnowledgeLocator
> = {
  metadata: {
    encode: (value): KnowledgeMetadata => ({ clause: value.clause }),
    decode: (value): KecFixtureMetadata => {
      if (!isRecord(value)) {
        throw new Error("invalid KEC fixture metadata");
      }
      const clause = value.clause;
      if (clause !== null && typeof clause !== "string") {
        throw new Error("invalid KEC fixture metadata");
      }
      return { clause };
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
        throw new Error("invalid KEC fixture locator");
      }
      return { kind: "page", page: Number(value.page) };
    },
  },
};

export async function seedKecCollection(
  store: SqliteKnowledgeStore,
): Promise<void> {
  await store.upsert(
    "kec",
    [
      {
        chunkId: "kec-fixture#page=1#chunk=0",
        documentId: "kec:knowledge/kec.pdf",
        sourcePath: "knowledge/kec.pdf",
        chunkIndex: 0,
        locator: { kind: "page", page: 1 },
        metadata: { clause: "KEC 232.5" },
        text: "KEC grounding requirement.",
        embedding: [1, 0, 1],
      },
    ],
    kecFixtureCodecs,
  );
}

export async function loadCompanyDomain() {
  return import("../../../knowledge-company/src/index.js");
}
