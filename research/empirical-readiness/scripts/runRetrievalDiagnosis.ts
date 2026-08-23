import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { OllamaEmbeddingProvider } from "../../../packages/mcp-kec/src/knowledge/embedding.js";

import { searchProvisionalRegulationIndex } from "./regulationIndex.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const collectionId = "kec-regulation-provisional";
const originalDbPath = resolve(
  workspaceRoot,
  ".volt-ai/kec-regulation-provisional/index.db",
);
const targetDbPath = resolve(
  workspaceRoot,
  ".volt-ai/kec-regulation-provisional/diagnostic-copy/index.db",
);

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function centeredExcerpt(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const matchIndex = normalized.indexOf(query);
  const start = matchIndex < 0 ? 0 : Math.max(0, matchIndex - 12);
  return Array.from(normalized).slice(start, start + 40).join("");
}

async function main(): Promise<void> {
  const originalDatabaseSha256Before = sha256(originalDbPath);
  const diagnosticCopySha256Before = sha256(targetDbPath);

  if (diagnosticCopySha256Before !== originalDatabaseSha256Before) {
    throw new Error("Diagnostic copy does not match the new original baseline");
  }

  const provider = new OllamaEmbeddingProvider();
  const metadata = provider.getMetadata();

  if (metadata.provider !== "ollama" || metadata.model !== "nomic-embed-text") {
    throw new Error("Production default nomic-embed-text is required");
  }

  const definitions = [
    { id: "CLAUSE_IDENTIFIER", query: "241.17.3" },
    { id: "CONDITIONAL_PHRASE", query: "다만" },
    { id: "TOPIC", query: "접지" },
  ] as const;
  const queries = [];

  for (const definition of definitions) {
    const hits = await searchProvisionalRegulationIndex({
      collectionId,
      targetDbPath,
      query: definition.query,
      topK: 10,
      embed: (text) => provider.embed(text),
    });
    const database = new DatabaseSync(targetDbPath, { readOnly: true });

    try {
      queries.push({
        ...definition,
        topK: 10,
        hits: hits.map((hit, index) => {
          const stored = database
            .prepare(
              "SELECT rowid, text FROM kec_chunks WHERE collection = ? AND id = ?",
            )
            .get(collectionId, hit.chunkId) as
            | { rowid: number; text: string }
            | undefined;

          if (!stored) throw new Error("Retrieved chunk is unavailable");

          return {
            rank: index + 1,
            rowid: stored.rowid,
            page: hit.locator.page,
            containsExactQuery: stored.text.includes(definition.query),
            similarity: hit.similarity,
            excerpt: centeredExcerpt(stored.text, definition.query),
          };
        }),
      });
    } finally {
      database.close();
    }
  }

  const diagnosticCopySha256After = sha256(targetDbPath);
  const originalDatabaseSha256After = sha256(originalDbPath);

  if (originalDatabaseSha256After !== originalDatabaseSha256Before) {
    throw new Error("Original provisional database changed during copy-based diagnosis");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        retrievalFunction:
          "research/empirical-readiness/scripts/regulationIndex.ts::searchProvisionalRegulationIndex",
        collectionId,
        provider: metadata.provider,
        model: metadata.model,
        originalDbPath,
        diagnosticCopyPath: targetDbPath,
        originalDatabaseSha256Before,
        originalDatabaseSha256After,
        diagnosticCopySha256Before,
        diagnosticCopySha256After,
        diagnosticCopyMutatedByReadPath:
          diagnosticCopySha256After !== diagnosticCopySha256Before,
        queryCount: definitions.length,
        retryCount: 0,
        queries,
      },
      null,
      2,
    )}\n`,
  );
}

void main();
