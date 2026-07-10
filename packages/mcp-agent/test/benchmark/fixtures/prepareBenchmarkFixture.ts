import { reviewProject, type ReviewReport } from "@voltai/agent-review";
import { SqliteVectorStore } from "@voltai/mcp-kec";

import { createLocalReviewPorts } from "../../../src/ports/localReviewPorts.js";
import {
  createCapturingMockReviewLlm,
  createReviewFixture,
  withE2eEnvironment,
} from "../../e2e/helpers/reviewFixture.js";
import type { ReviewBenchmarkInput } from "../helpers/evaluateReview.js";

const relatedKecText = "KEC 232.5 cable sizing requirement for breaker and grounding.";
const distractorKecText = "KEC 999.1 unrelated auxiliary compliance record.";

export type PreparedBenchmarkFixture = {
  projectRoot: string;
  runReview: () => Promise<ReviewBenchmarkInput>;
  cleanup: () => Promise<void>;
};

async function seedBenchmarkKnowledge(
  fixture: Awaited<ReturnType<typeof createReviewFixture>>,
): Promise<void> {
  const store = new SqliteVectorStore(fixture.kecDbPath);

  try {
    const metadata = fixture.embeddingProvider.getMetadata();
    const relatedEmbedding = await fixture.embeddingProvider.embed(relatedKecText);
    const distractorEmbedding = await fixture.embeddingProvider.embed(distractorKecText);
    const indexMetadata = {
      embeddingProvider: metadata.provider,
      embeddingModel: metadata.model,
      dimensions: relatedEmbedding.length,
      indexedAt: "2026-01-01T00:00:00.000Z",
    };

    await store.replaceSource(
      "kec",
      "knowledge/kec-source.pdf",
      [
        {
          id: "knowledge/kec-source.pdf#page=1#chunk=0",
          sourcePath: "knowledge/kec-source.pdf",
          page: 1,
          chunkIndex: 0,
          clause: "KEC 232.5",
          text: relatedKecText,
          embedding: relatedEmbedding,
        },
      ],
      indexMetadata,
    );
    await store.replaceSource(
      "kec",
      "knowledge/distractor.pdf",
      [
        {
          id: "knowledge/distractor.pdf#page=1#chunk=0",
          sourcePath: "knowledge/distractor.pdf",
          page: 1,
          chunkIndex: 0,
          clause: "KEC 999.1",
          text: distractorKecText,
          embedding: distractorEmbedding,
        },
      ],
      indexMetadata,
    );
  } finally {
    await store.close();
  }
}

function getCapturedReport(llm: ReturnType<typeof createCapturingMockReviewLlm>): ReviewReport {
  if (!llm.report) {
    throw new Error("Benchmark MockReviewLlm did not receive a ReviewReport input");
  }

  return llm.report;
}

export async function prepareBenchmarkFixture(): Promise<PreparedBenchmarkFixture> {
  const fixture = await createReviewFixture();

  await withE2eEnvironment(fixture, async () => {
    await seedBenchmarkKnowledge(fixture);
  });

  return {
    projectRoot: fixture.projectRoot,
    runReview: async () =>
      withE2eEnvironment(fixture, async () => {
        const llm = createCapturingMockReviewLlm();
        const ports = createLocalReviewPorts(fixture.projectRoot, {
          embeddingProvider: fixture.embeddingProvider,
          vectorStoreFactory: () => new SqliteVectorStore(fixture.kecDbPath),
          llm,
        });
        const markdown = await reviewProject({ projectPath: fixture.projectRoot }, ports);

        return {
          report: getCapturedReport(llm),
          markdown,
        };
      }),
    cleanup: fixture.cleanup,
  };
}
