import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createIndexKecTool,
  indexKec,
} from "../src/tools/indexKec.js";
import {
  createSearchKecTool,
  searchKec,
} from "../src/tools/searchKec.js";
import type { EmbeddingProvider, EmbeddingProviderMetadata } from "../src/knowledge/embedding.js";
import { SqliteVectorStore } from "../src/knowledge/sqliteVectorStore.js";
import type { VectorStore } from "../src/knowledge/vectorStore.js";

const tempRoots: string[] = [];

class KeywordEmbeddingProvider implements EmbeddingProvider {
  getMetadata(): EmbeddingProviderMetadata {
    return {
      provider: "test",
      model: "keyword",
    };
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();

    return [
      normalized.includes("cable") || normalized.includes("케이블") ? 1 : 0,
      normalized.includes("ground") || normalized.includes("접지") ? 1 : 0,
      normalized.includes("breaker") || normalized.includes("차단기") ? 1 : 0,
    ];
  }
}

function createTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-"));
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

function createBlankPdf(): string {
  return createTextPdf("");
}

function createStore(root: string): VectorStore {
  return new SqliteVectorStore(join(root, ".voltai", "kec.sqlite"));
}

describe("KEC knowledge base", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes KEC PDF page text as chunks with source, page, text, and clause candidate", async () => {
    const root = createTempProject();
    writeProjectFile(
      root,
      "kec/kec.pdf",
      createTextPdf("KEC 232.5 cable sizing shall follow allowable current"),
    );

    const store = createStore(root);
    const result = await indexKec(
      root,
      { relativePath: "kec/kec.pdf" },
      {
        embeddingProvider: new KeywordEmbeddingProvider(),
        vectorStore: store,
      },
    );

    const chunks = await store.listChunks();

    expect(result).toMatchObject({
      relativePath: "kec/kec.pdf",
      indexedChunks: 1,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      sourcePath: "kec/kec.pdf",
      page: 1,
      clause: "KEC 232.5",
    });
    expect(chunks[0].text).toContain("cable sizing");
  });

  it("searches KEC chunks with embeddings and returns topK results with clause, page, text, and similarity", async () => {
    const root = createTempProject();
    writeProjectFile(root, "kec/kec.pdf", createTextPdf("KEC 232.5 cable sizing rule"));

    const embeddingProvider = new KeywordEmbeddingProvider();
    const vectorStore = createStore(root);

    await indexKec(root, { relativePath: "kec/kec.pdf" }, { embeddingProvider, vectorStore });

    const results = await searchKec(
      { question: "케이블 규격", topK: 5 },
      { embeddingProvider, vectorStore },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      clause: "KEC 232.5",
      page: 1,
      text: expect.stringContaining("cable sizing"),
    });
    expect(results[0].similarity).toBeGreaterThan(0);
  });

  it("works without an OpenAI API key", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const root = createTempProject();
    writeProjectFile(root, "kec/kec.pdf", createTextPdf("KEC 140 ground connection rule"));

    try {
      const embeddingProvider = new KeywordEmbeddingProvider();
      const vectorStore = createStore(root);

      await indexKec(root, { relativePath: "kec/kec.pdf" }, { embeddingProvider, vectorStore });
      const results = await searchKec(
        { question: "접지 기준", topK: 5 },
        { embeddingProvider, vectorStore },
      );

      expect(results[0].clause).toBe("KEC 140");
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });

  it("rejects non-relative, traversal, and non-PDF index paths", async () => {
    const root = createTempProject();
    const deps = {
      embeddingProvider: new KeywordEmbeddingProvider(),
      vectorStore: createStore(root),
    };

    await expect(indexKec(root, { relativePath: join(root, "kec.pdf") }, deps)).rejects.toThrow(
      "relativePath must be relative",
    );
    await expect(indexKec(root, { relativePath: "../kec.pdf" }, deps)).rejects.toThrow(
      "relativePath must stay within PROJECT_ROOT",
    );
    await expect(indexKec(root, { relativePath: "kec/kec.txt" }, deps)).rejects.toThrow(
      "Only .pdf files are supported",
    );
  });

  it("treats empty text PDFs as not indexable", async () => {
    const root = createTempProject();
    writeProjectFile(root, "kec/blank.pdf", createBlankPdf());

    await expect(
      indexKec(
        root,
        { relativePath: "kec/blank.pdf" },
        {
          embeddingProvider: new KeywordEmbeddingProvider(),
          vectorStore: createStore(root),
        },
      ),
    ).rejects.toThrow("PDF text is empty or unavailable");
  });

  it("exposes index_kec and search_kec MCP tools that return JSON", async () => {
    const root = createTempProject();
    writeProjectFile(root, "kec/kec.pdf", createTextPdf("KEC 212.3 breaker protection rule"));

    const originalProjectRoot = process.env.PROJECT_ROOT;
    const originalKecDbPath = process.env.KEC_DB_PATH;
    process.env.PROJECT_ROOT = root;
    process.env.KEC_DB_PATH = join(root, ".voltai", "tool-kec.sqlite");

    try {
      const embeddingProvider = new KeywordEmbeddingProvider();
      const indexTool = createIndexKecTool({ embeddingProvider });
      const searchTool = createSearchKecTool({ embeddingProvider });

      const indexResult = JSON.parse(await indexTool.handler({ relativePath: "kec/kec.pdf" }));
      const searchResult = JSON.parse(
        await searchTool.handler({ question: "차단기 보호", topK: 5 }),
      );

      expect(indexTool.name).toBe("index_kec");
      expect(searchTool.name).toBe("search_kec");
      expect(indexResult.indexedChunks).toBe(1);
      expect(searchResult.results[0]).toMatchObject({
        clause: "KEC 212.3",
        page: 1,
        similarity: expect.any(Number),
      });
    } finally {
      if (originalProjectRoot === undefined) {
        delete process.env.PROJECT_ROOT;
      } else {
        process.env.PROJECT_ROOT = originalProjectRoot;
      }

      if (originalKecDbPath === undefined) {
        delete process.env.KEC_DB_PATH;
      } else {
        process.env.KEC_DB_PATH = originalKecDbPath;
      }
    }
  });
});
