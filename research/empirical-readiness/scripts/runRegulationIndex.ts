import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { OllamaEmbeddingProvider } from "../../../packages/mcp-kec/src/knowledge/embedding.js";
import { readPdfPages } from "../../../packages/mcp-kec/src/knowledge/pdfPages.js";

import {
  buildProvisionalRegulationIndexFromPages,
  searchProvisionalRegulationIndex,
} from "./regulationIndex.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const collectionId = "kec-regulation-provisional";
const sourcePath = ".volt-ai/kec-regulation-provisional/raw/kea-kec-consolidated.pdf";
const absoluteSourcePath = resolve(workspaceRoot, sourcePath);
const targetDbPath = resolve(
  workspaceRoot,
  ".volt-ai/kec-regulation-provisional/index.db",
);
const protectedDrawingIndexPath = resolve(workspaceRoot, ".volt-ai/kec/index.db");

const sourcePageUrl =
  "https://kec.kea.kr/sub_tech/regulation_all.php?b_name=report2&mode=view&number=2381";
const directDownloadUrl =
  "https://kec.kea.kr/bbs_sun/download.v2.php?b_name=report2&bd_number=2381&seq=1";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function shortExcerpt(text: string): string {
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 40).join("");
}

function classifyChunk(text: string):
  | "REGULATION_TEXT"
  | "DRAWING_TEXT"
  | "MIXED"
  | "INDETERMINATE" {
  const regulation =
    /\b\d{2,4}(?:\.\d+){1,3}\b/.test(text) ||
    /하여야|한다|경우|다만|부\s*칙|공통사항|저압 전기설비/.test(text);
  const drawing =
    /BLOCK DIAGRAM|결선도|분전반|BREAKER SIZE|MCCB|도면번호/i.test(text);

  if (regulation && drawing) return "MIXED";
  if (regulation) return "REGULATION_TEXT";
  if (drawing) return "DRAWING_TEXT";
  return "INDETERMINATE";
}

function deterministicSampleRowids(total: number): number[] {
  const first = [1, 2, 3, 4, 5];
  const middleStart = Math.floor((total - 5) / 2) + 1;
  const middle = Array.from({ length: 5 }, (_, index) => middleStart + index);
  const last = Array.from({ length: 5 }, (_, index) => total - 4 + index);
  const selected = new Set([...first, ...middle, ...last]);
  const remaining = Array.from({ length: total }, (_, index) => index + 1).filter(
    (rowid) => !selected.has(rowid),
  );
  const evenlySpaced = Array.from({ length: 5 }, (_, index) => {
    const rank = Math.floor(((index + 1) * (remaining.length + 1)) / 6);
    return remaining[rank - 1];
  });

  return [...selected, ...evenlySpaced].sort((left, right) => left - right);
}

function inspectBuiltIndex() {
  const database = new DatabaseSync(targetDbPath, { readOnly: true });

  try {
    const metadata = database
      .prepare(
        "SELECT id, embedding_provider, embedding_model, dimensions, indexed_at FROM index_metadata ORDER BY id",
      )
      .all();
    const total = Number(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM kec_chunks WHERE collection = ?")
          .get(collectionId) as { count: number }
      ).count,
    );
    const sources = database
      .prepare(
        "SELECT source_path, COUNT(*) AS chunk_count FROM kec_chunks WHERE collection = ? GROUP BY source_path",
      )
      .all(collectionId);
    const nulCount = Number(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM kec_chunks WHERE collection = ? AND instr(text, char(0)) > 0",
          )
          .get(collectionId) as { count: number }
      ).count,
    );
    const rowids = deterministicSampleRowids(total);
    const sample = rowids.map((rowid) => {
      const row = database
        .prepare(
          "SELECT rowid, source_path, page, clause, text FROM kec_chunks WHERE rowid = ? AND collection = ?",
        )
        .get(rowid, collectionId) as
        | {
            rowid: number;
            source_path: string;
            page: number;
            clause: string | null;
            text: string;
          }
        | undefined;

      if (!row) throw new Error(`Sample rowid ${rowid} is unavailable`);

      return {
        rowid: row.rowid,
        source: row.source_path,
        page: row.page,
        clause: row.clause,
        excerpt: shortExcerpt(row.text),
        classification: classifyChunk(row.text),
      };
    });

    return { metadata, total, sources, nulCount, rowids, sample };
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  if (existsSync(targetDbPath)) {
    throw new Error("First-run target index already exists; refusing to overwrite it");
  }

  const drawingIndexSha256Before = sha256(protectedDrawingIndexPath);
  const sourceSha256 = sha256(absoluteSourcePath);
  const provider = new OllamaEmbeddingProvider();
  const embeddingMetadata = provider.getMetadata();

  if (
    embeddingMetadata.provider !== "ollama" ||
    embeddingMetadata.model !== "nomic-embed-text"
  ) {
    throw new Error("EMBEDDING_UNAVAILABLE: production default nomic-embed-text is required");
  }

  const pages = await readPdfPages(absoluteSourcePath);
  const build = await buildProvisionalRegulationIndexFromPages({
    collectionId,
    targetDbPath,
    protectedDrawingIndexPath,
    sourcePath,
    sourceSha256,
    pages,
    embed: (text) => provider.embed(text),
    embeddingMetadata,
    indexedAt: new Date().toISOString(),
  });
  const index = inspectBuiltIndex();

  const queryDefinitions = [
    { id: "CLAUSE_IDENTIFIER", query: "241.17.3" },
    { id: "CONDITIONAL_PHRASE", query: "다만" },
    { id: "TOPIC", query: "접지" },
  ] as const;
  const retrieval = [];

  for (const definition of queryDefinitions) {
    const hits = await searchProvisionalRegulationIndex({
      collectionId,
      targetDbPath,
      query: definition.query,
      topK: 3,
      embed: (text) => provider.embed(text),
    });
    const database = new DatabaseSync(targetDbPath, { readOnly: true });

    try {
      retrieval.push({
        ...definition,
        hits: hits.map((hit) => {
          const stored = database
            .prepare(
              "SELECT rowid FROM kec_chunks WHERE collection = ? AND id = ?",
            )
            .get(collectionId, hit.chunkId) as { rowid: number } | undefined;

          if (!stored) throw new Error("Retrieved chunk rowid is unavailable");

          return {
            rowid: stored.rowid,
            source: hit.sourcePath,
            page: hit.locator.page,
            clause: hit.metadata.clause,
            similarity: hit.similarity,
            excerpt: shortExcerpt(hit.text),
            classification: classifyChunk(hit.text),
          };
        }),
      });
    } finally {
      database.close();
    }
  }

  const drawingIndexSha256After = sha256(protectedDrawingIndexPath);

  if (drawingIndexSha256After !== drawingIndexSha256Before) {
    throw new Error("Protected drawing index changed during provisional build");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        source: {
          sourcePageUrl,
          directDownloadUrl,
          revision: "2024-749",
          publicationLayer: "OFFICIAL_REPUBLICATION",
          documentScope: "CONSOLIDATED_FULL_TEXT",
          sourceProvisional: true,
          path: sourcePath,
          sha256: sourceSha256,
          sizeBytes: readFileSync(absoluteSourcePath).byteLength,
          pageCount: pages.length,
        },
        embeddingPolicy: {
          embeddingModel: "nomic-embed-text",
          embeddingModelChoice: "PRODUCTION_DEFAULT_INTENTIONAL",
          knownLimitation:
            "Korean retrieval performance is unverified for this model on regulation text",
          alternativeNotTested: "BGE-M3",
        },
        sanitization: {
          strategy: "REPLACE_WITH_U+0020",
          resultMayDependOnStrategy: true,
          ...build,
        },
        index,
        retrieval,
        drawingIndex: {
          path: ".volt-ai/kec/index.db",
          sha256Before: drawingIndexSha256Before,
          sha256After: drawingIndexSha256After,
          modified: false,
        },
      },
      null,
      2,
    )}\n`,
  );
}

void main();
