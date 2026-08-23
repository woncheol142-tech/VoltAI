import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const drawingIndexPath = join(workspaceRoot, ".volt-ai/kec/index.db");
const implementationUrl = new URL("../scripts/regulationIndex.ts", import.meta.url);
const sanitizerUrl = new URL("../scripts/nulSanitizer.ts", import.meta.url);

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function loadImplementation() {
  return import(implementationUrl.href);
}

test("existing drawing index remains byte-for-byte unchanged", async () => {
  assert.ok(
    existsSync(drawingIndexPath),
    "protected drawing index must exist for this contract to be meaningful",
  );
  const before = sha256(drawingIndexPath);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kec-regulation-index-test-"));

  try {
    const { buildProvisionalRegulationIndexFromPages } = await loadImplementation();
    await buildProvisionalRegulationIndexFromPages({
      collectionId: "kec-regulation-provisional",
      targetDbPath: join(temporaryDirectory, "index.db"),
      protectedDrawingIndexPath: drawingIndexPath,
      sourcePath: "synthetic-regulation.pdf",
      sourceSha256: "a".repeat(64),
      pages: [{ page: 1, text: "241.17.3 조건\u0000문장에 따른 설비 기준" }],
      embed: async () => [1, 0, 0],
      embeddingMetadata: { provider: "test", model: "deterministic-test" },
      indexedAt: "2026-08-23T00:00:00.000Z",
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  assert.equal(sha256(drawingIndexPath), before);
});

test("NUL sanitizer is a research-only import-free space replacement", async () => {
  const sanitizerSource = await readFile(sanitizerUrl, "utf8");
  assert.doesNotMatch(sanitizerSource, /^\s*import\s/m);

  const { sanitizeExtractedText } = await import(sanitizerUrl.href);
  assert.equal(sanitizeExtractedText("abc\u0000def"), "abc def");
  assert.equal(sanitizeExtractedText("already clean"), "already clean");

  const productionDiff = execFileSync(
    "git",
    ["diff", "--name-only", "--", "packages/mcp-kec/src"],
    { cwd: workspaceRoot, encoding: "utf8" },
  );
  assert.equal(productionDiff, "");
});

test("provisional collection is distinct and the drawing DB path is rejected", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kec-regulation-index-test-"));
  const before = sha256(drawingIndexPath);

  try {
    const { buildProvisionalRegulationIndexFromPages } = await loadImplementation();
    const targetDbPath = join(temporaryDirectory, "index.db");
    const input = {
      collectionId: "kec-regulation-provisional",
      targetDbPath,
      protectedDrawingIndexPath: drawingIndexPath,
      sourcePath: "synthetic-regulation.pdf",
      sourceSha256: "b".repeat(64),
      pages: [{ page: 1, text: "접지 조건\u0000규정에 따른 전기설비 기준" }],
      embed: async () => [0, 1, 0],
      embeddingMetadata: { provider: "test", model: "deterministic-test" },
      indexedAt: "2026-08-23T00:00:00.000Z",
    };

    await buildProvisionalRegulationIndexFromPages(input);

    const database = new DatabaseSync(targetDbPath, { readOnly: true });
    try {
      const metadata = database
        .prepare("SELECT id FROM index_metadata")
        .all() as Array<{ id: string }>;
      assert.deepEqual(
        metadata.map((row) => row.id),
        ["kec-regulation-provisional"],
      );
      assert.notEqual(metadata[0]?.id, "kec");

      const rows = database
        .prepare("SELECT text, metadata_json FROM kec_chunks ORDER BY rowid")
        .all() as Array<{ text: string; metadata_json: string }>;
      assert.ok(rows.length > 0, "successful build must persist at least one chunk");

      for (const row of rows) {
        assert.doesNotMatch(row.text, /\u0000/);
        assert.equal(JSON.parse(row.metadata_json).sourceSha256, "b".repeat(64));
      }

      assert.match(rows[0]?.text ?? "", /접지 조건 규정에 따른 전기설비 기준/);
    } finally {
      database.close();
    }

    await assert.rejects(
      buildProvisionalRegulationIndexFromPages({
        ...input,
        targetDbPath: drawingIndexPath,
      }),
      /protected drawing index/i,
    );
    assert.equal(sha256(drawingIndexPath), before);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
