import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SqliteVectorStore } from "@voltai/mcp-kec";

import type { ReviewFixture } from "./reviewFixture.js";

const kecSourcePath = "knowledge/kec-source.pdf";
const deterministicKecText = "KEC 232.5 cable sizing requirement for breaker and grounding.";

export type IndexedKecResult = {
  relativePath: string;
  indexedChunks: number;
};

function isIndexedKecResult(value: unknown): value is IndexedKecResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "relativePath" in value &&
    typeof value.relativePath === "string" &&
    "indexedChunks" in value &&
    typeof value.indexedChunks === "number"
  );
}

export async function prepareDeterministicKecStore(fixture: ReviewFixture): Promise<void> {
  const store = new SqliteVectorStore(fixture.kecDbPath);

  try {
    const embedding = await fixture.embeddingProvider.embed(deterministicKecText);
    const metadata = fixture.embeddingProvider.getMetadata();

    await store.replaceSource(
      "kec",
      kecSourcePath,
      [
        {
          id: "knowledge/kec-source.pdf#page=1#chunk=0",
          sourcePath: kecSourcePath,
          page: 1,
          chunkIndex: 0,
          clause: "KEC 232.5",
          text: deterministicKecText,
          embedding,
        },
      ],
      {
        embeddingProvider: metadata.provider,
        embeddingModel: metadata.model,
        dimensions: embedding.length,
        indexedAt: "2026-01-01T00:00:00.000Z",
      },
    );
  } finally {
    await store.close();
  }
}

export async function indexKecFixtureThroughMcp(client: Client): Promise<IndexedKecResult> {
  const response = await client.callTool({
    name: "index_kec",
    arguments: { relativePath: kecSourcePath },
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text : undefined;

  if (response.isError || text === undefined) {
    throw new Error("index_kec fixture setup failed");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("index_kec fixture setup returned invalid JSON");
  }

  if (!isIndexedKecResult(parsed)) {
    throw new Error("index_kec fixture setup returned an invalid result");
  }

  return parsed;
}

export async function assertNoDuplicateKecChunks(
  store: SqliteVectorStore,
  sourcePath: string,
  options: { expectedCount: number; excludedText?: string },
): Promise<void> {
  const sourceChunks = (await store.listChunks("kec")).filter(
    (chunk) => chunk.sourcePath === sourcePath,
  );
  const ids = new Set(sourceChunks.map((chunk) => chunk.id));

  if (sourceChunks.length === 0) {
    throw new Error("KEC fixture source was not indexed");
  }

  if (sourceChunks.length !== options.expectedCount) {
    throw new Error("KEC fixture reindex left stale chunks");
  }

  if (ids.size !== sourceChunks.length) {
    throw new Error("KEC fixture reindex left duplicate chunks");
  }

  if (
    options.excludedText !== undefined &&
    sourceChunks.some((chunk) => chunk.text.includes(options.excludedText))
  ) {
    throw new Error("KEC fixture reindex left stale source text");
  }
}
