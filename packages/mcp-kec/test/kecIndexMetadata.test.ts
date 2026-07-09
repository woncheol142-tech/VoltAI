import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { EmbeddingProvider, EmbeddingProviderMetadata } from "../src/knowledge/embedding.js";
import { SqliteVectorStore } from "../src/knowledge/sqliteVectorStore.js";
import type { VectorStore } from "../src/knowledge/vectorStore.js";
import { indexKec } from "../src/tools/indexKec.js";
import { searchKec } from "../src/tools/searchKec.js";

const metadataMismatchError = "KEC index embedding metadata mismatch. Please re-run index_kec.";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
const tempRoots: string[] = [];

class MetadataEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly metadata: EmbeddingProviderMetadata,
    private readonly dimensions: number,
  ) {}

  getMetadata(): EmbeddingProviderMetadata {
    return this.metadata;
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();
    const vector = Array.from({ length: this.dimensions }, () => 0);

    if (vector.length > 0) {
      vector[0] = normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0;
    }

    if (vector.length > 1) {
      vector[1] = normalized.length > 0 ? 1 : 0;
    }

    return vector;
  }
}

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-metadata-"));
  tempRoots.push(root);
  return root;
}

function writeProjectFile(root: string, relativePath: string, content: string): void {
  const parts = relativePath.split("/");
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("relativePath must include a file name");
  }

  mkdirSync(join(root, ...parts), { recursive: true });
  writeFileSync(join(root, ...parts, fileName), content);
}

function createTextPdf(text: string): string {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return pdf;
}

function createProvider(
  provider = "placeholder",
  model = "test-model",
  dimensions = 2,
): EmbeddingProvider {
  return new MetadataEmbeddingProvider({ provider, model }, dimensions);
}

function createStore(root: string): VectorStore {
  return new SqliteVectorStore(join(root, ".voltai", "kec.sqlite"));
}

async function indexFixture(
  root: string,
  embeddingProvider: EmbeddingProvider,
  vectorStore: VectorStore,
): Promise<void> {
  writeProjectFile(root, "kec/kec.pdf", createTextPdf("KEC 232.5 cable sizing rule"));
  await indexKec(root, { relativePath: "kec/kec.pdf" }, { embeddingProvider, vectorStore });
}

describe("KEC index embedding metadata", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores provider, model, dimensions, and indexedAt after indexKec", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);
    const embeddingProvider = createProvider("ollama", "nomic-embed-text", 2);

    await indexFixture(root, embeddingProvider, vectorStore);

    await expect(vectorStore.getIndexMetadata("kec")).resolves.toMatchObject({
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      dimensions: 2,
    });
    expect(new Date((await vectorStore.getIndexMetadata("kec"))?.indexedAt ?? "").toString()).not.toBe(
      "Invalid Date",
    );
  });

  it("keeps index metadata isolated by collection", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await vectorStore.saveIndexMetadata("kec", {
      embeddingProvider: "placeholder",
      embeddingModel: "kec-model",
      dimensions: 2,
      indexedAt: "2026-01-01T00:00:00.000Z",
    });
    await vectorStore.saveIndexMetadata("company", {
      embeddingProvider: "ollama",
      embeddingModel: "company-model",
      dimensions: 3,
      indexedAt: "2026-01-02T00:00:00.000Z",
    });

    await expect(vectorStore.getIndexMetadata("kec")).resolves.toMatchObject({
      embeddingModel: "kec-model",
      dimensions: 2,
    });
    await expect(vectorStore.getIndexMetadata("company")).resolves.toMatchObject({
      embeddingModel: "company-model",
      dimensions: 3,
    });
  });

  it("deletes chunks by collection and sourcePath only", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await vectorStore.upsert("kec", [
      {
        id: "shared#page=1#chunk=0",
        sourcePath: "shared.pdf",
        page: 1,
        chunkIndex: 0,
        clause: "KEC 232.5",
        text: "kec cable",
        embedding: [1, 1],
      },
    ]);
    await vectorStore.upsert("company", [
      {
        id: "shared#page=1#chunk=0",
        sourcePath: "shared.pdf",
        page: 1,
        chunkIndex: 0,
        clause: null,
        text: "company cable",
        embedding: [1, 1],
      },
    ]);

    await vectorStore.deleteBySourcePath("kec", "shared.pdf");

    await expect(vectorStore.listChunks("kec")).resolves.toEqual([]);
    await expect(vectorStore.listChunks("company")).resolves.toHaveLength(1);
  });

  it("rolls back replaceSource when metadata save fails", async () => {
    const root = createTempProject();
    const dbPath = join(root, ".voltai", "kec.sqlite");
    const vectorStore = new SqliteVectorStore(dbPath);

    await expect(
      vectorStore.replaceSource(
        "kec",
        "kec/kec.pdf",
        [
          {
            id: "kec/kec.pdf#page=1#chunk=0",
            sourcePath: "kec/kec.pdf",
            page: 1,
            chunkIndex: 0,
            clause: "KEC 232.5",
            text: "cable rule",
            embedding: [1, 1],
          },
        ],
        {
          embeddingProvider: "placeholder",
          embeddingModel: "broken",
          dimensions: -1,
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
      ),
    ).rejects.toThrow();

    await expect(vectorStore.listChunks("kec")).resolves.toEqual([]);
    await expect(vectorStore.getIndexMetadata("kec")).resolves.toBeNull();
  });

  it("searches normally when metadata matches", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);
    const embeddingProvider = createProvider();

    await indexFixture(root, embeddingProvider, vectorStore);

    const results = await searchKec(
      { question: "케이블 규격", topK: 5 },
      { embeddingProvider, vectorStore },
    );

    expect(results[0]).toMatchObject({
      clause: "KEC 232.5",
      page: 1,
    });
  });

  it("requires re-indexing when provider does not match", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await indexFixture(root, createProvider("placeholder", "test-model", 2), vectorStore);

    await expect(
      searchKec(
        { question: "케이블 규격", topK: 5 },
        { embeddingProvider: createProvider("ollama", "test-model", 2), vectorStore },
      ),
    ).rejects.toThrow(metadataMismatchError);
  });

  it("requires re-indexing when model does not match", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await indexFixture(root, createProvider("ollama", "nomic-embed-text", 2), vectorStore);

    await expect(
      searchKec(
        { question: "케이블 규격", topK: 5 },
        { embeddingProvider: createProvider("ollama", "bge-m3", 2), vectorStore },
      ),
    ).rejects.toThrow(metadataMismatchError);
  });

  it("requires re-indexing when dimensions do not match", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await indexFixture(root, createProvider("placeholder", "test-model", 2), vectorStore);

    await expect(
      searchKec(
        { question: "케이블 규격", topK: 5 },
        { embeddingProvider: createProvider("placeholder", "test-model", 3), vectorStore },
      ),
    ).rejects.toThrow(metadataMismatchError);
  });

  it("requires re-indexing when old databases have no metadata", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await vectorStore.upsert("kec", [
      {
        id: "legacy#page=1",
        sourcePath: "legacy.pdf",
        page: 1,
        chunkIndex: 0,
        clause: "KEC 232.5",
        text: "KEC 232.5 cable sizing rule",
        embedding: [1, 1],
      },
    ]);

    await expect(
      searchKec(
        { question: "케이블 규격", topK: 5 },
        { embeddingProvider: createProvider(), vectorStore },
      ),
    ).rejects.toThrow(metadataMismatchError);
  });

  it("migrates old databases without an index_metadata table", async () => {
    const root = createTempProject();
    const storePath = join(root, ".voltai", "kec.sqlite");
    const vectorStore = new SqliteVectorStore(storePath);

    await expect(vectorStore.getIndexMetadata("kec")).resolves.toBeNull();
  });

  it("migrates old databases without collection column as kec collection", async () => {
    const root = createTempProject();
    const storePath = join(root, ".voltai", "legacy.sqlite");
    mkdirSync(join(root, ".voltai"), { recursive: true });

    const database = new DatabaseSync(storePath);
    database.exec(`
      CREATE TABLE kec_chunks (
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        page INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        clause TEXT,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL
      );

      INSERT INTO kec_chunks (id, source_path, page, chunk_index, clause, text, embedding)
      VALUES ('legacy#page=1#chunk=0', 'legacy.pdf', 1, 0, 'KEC 232.5', 'legacy cable', '[1,1]');
    `);
    database.close();

    const vectorStore = new SqliteVectorStore(storePath);

    await expect(vectorStore.listChunks("kec")).resolves.toEqual([
      {
        id: "legacy#page=1#chunk=0",
        sourcePath: "legacy.pdf",
        page: 1,
        chunkIndex: 0,
        clause: "KEC 232.5",
        text: "legacy cable",
      },
    ]);
  });

  it("exposes a close lifecycle method", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);

    await expect(vectorStore.close()).resolves.toBeUndefined();
  });
});
