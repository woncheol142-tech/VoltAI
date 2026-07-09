import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPageChunks,
  extractClauseCandidate,
} from "../src/knowledge/chunk.js";
import type { EmbeddingProvider, EmbeddingProviderMetadata } from "../src/knowledge/embedding.js";
import { SqliteVectorStore } from "../src/knowledge/sqliteVectorStore.js";
import type { VectorStore } from "../src/knowledge/vectorStore.js";
import { indexKec } from "../src/tools/indexKec.js";
import { searchKec } from "../src/tools/searchKec.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
const tempRoots: string[] = [];

class KeywordEmbeddingProvider implements EmbeddingProvider {
  getMetadata(): EmbeddingProviderMetadata {
    return {
      provider: "test",
      model: "chunking",
    };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();

    return [
      normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0,
      normalized.includes("ground") || normalized.includes("접지") ? 1 : 0,
      normalized.length > 0 ? 1 : 0,
    ];
  }
}

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-chunking-"));
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

function createStore(root: string): VectorStore {
  return new SqliteVectorStore(join(root, ".voltai", "kec.sqlite"));
}

describe("KEC chunking", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("splits long page text into paragraph-based chunks with overlap", () => {
    const chunks = createPageChunks(
      "kec/kec.pdf",
      [
        {
          page: 1,
          text: [
            "KEC 232.5 cable paragraph alpha alpha alpha alpha",
            "cable paragraph beta beta beta beta",
            "cable paragraph gamma gamma gamma gamma",
          ].join("\n\n"),
        },
      ],
      {
        chunkSize: 65,
        chunkOverlap: 12,
      },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.startsWith(chunks[0].text.slice(-12))).toBe(true);
  });

  it("stores chunkIndex in chunk metadata", () => {
    const chunks = createPageChunks(
      "kec/kec.pdf",
      [{ page: 1, text: "KEC 232.5 cable paragraph one\n\ncable paragraph two" }],
      {
        chunkSize: 35,
        chunkOverlap: 5,
      },
    );

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(chunks.map((chunk) => chunk.id)).toEqual([
      "kec/kec.pdf#page=1#chunk=0",
      "kec/kec.pdf#page=1#chunk=1",
    ]);
  });

  it("uses index_kec chunkSize and chunkOverlap input options", async () => {
    const root = createTempProject();
    writeProjectFile(
      root,
      "kec/kec.pdf",
      createTextPdf(
        "KEC 232.5 cable paragraph alpha alpha alpha cable paragraph beta beta beta cable paragraph gamma gamma gamma",
      ),
    );

    const vectorStore = createStore(root);
    const result = await indexKec(
      root,
      {
        relativePath: "kec/kec.pdf",
        chunkSize: 45,
        chunkOverlap: 8,
      },
      {
        embeddingProvider: new KeywordEmbeddingProvider(),
        vectorStore,
      },
    );

    const chunks = await vectorStore.listChunks("kec");

    expect(result.indexedChunks).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("uses default chunkSize 1200 and chunkOverlap 150", () => {
    const chunks = createPageChunks(
      "kec/kec.pdf",
      [
        {
          page: 1,
          text: `KEC 232.5 ${"cable ".repeat(1400)}`,
        },
      ],
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.startsWith(chunks[0].text.slice(-150))).toBe(true);
    expect(chunks[0].text.length).toBeLessThanOrEqual(1200);
  });

  it("rejects chunkOverlap greater than or equal to chunkSize", async () => {
    const root = createTempProject();
    writeProjectFile(root, "kec/kec.pdf", createTextPdf("KEC 232.5 cable sizing rule"));

    await expect(
      indexKec(
        root,
        {
          relativePath: "kec/kec.pdf",
          chunkSize: 100,
          chunkOverlap: 100,
        },
        {
          embeddingProvider: new KeywordEmbeddingProvider(),
          vectorStore: createStore(root),
        },
      ),
    ).rejects.toThrow("chunkOverlap must be smaller than chunkSize");
  });

  it("excludes chunks that are too short", () => {
    const chunks = createPageChunks(
      "kec/kec.pdf",
      [
        {
          page: 1,
          text: "짧음\n\nKEC 232.5 cable paragraph long enough for indexing",
        },
      ],
      {
        chunkSize: 1200,
        chunkOverlap: 150,
        minChunkLength: 20,
      },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).not.toContain("짧음");
  });

  it("extracts clause candidates from KEC 232.5, 232.5.1, and 제232조 patterns", () => {
    expect(extractClauseCandidate("KEC 232.5 cable sizing")).toBe("KEC 232.5");
    expect(extractClauseCandidate("232.5.1 cable sizing details")).toBe("232.5.1");
    expect(extractClauseCandidate("제232조 전선의 선정")).toBe("제232조");
  });

  it("keeps existing search_kec result shape", async () => {
    const root = createTempProject();
    const vectorStore = createStore(root);
    const embeddingProvider = new KeywordEmbeddingProvider();
    writeProjectFile(root, "kec/kec.pdf", createTextPdf("KEC 232.5 cable sizing rule"));

    await indexKec(root, { relativePath: "kec/kec.pdf" }, { embeddingProvider, vectorStore });

    const [result] = await searchKec(
      { question: "케이블 규격", topK: 5 },
      { embeddingProvider, vectorStore },
    );

    expect(result).toEqual({
      clause: "KEC 232.5",
      page: 1,
      text: expect.stringContaining("cable sizing"),
      similarity: expect.any(Number),
      sourcePath: "kec/kec.pdf",
    });
  });

  it("migrates old databases without chunk_index column", async () => {
    const root = createTempProject();
    const dbPath = join(root, ".voltai", "legacy.sqlite");
    mkdirSync(dirname(dbPath), { recursive: true });

    const database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE kec_chunks (
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        page INTEGER NOT NULL,
        clause TEXT,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL
      );
    `);

    const vectorStore = new SqliteVectorStore(dbPath);

    await expect(vectorStore.listChunks("kec")).resolves.toEqual([]);
  });
});
