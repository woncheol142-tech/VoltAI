import { existsSync } from "node:fs";

import { createServer as createKecServer, SqliteVectorStore } from "@voltai/mcp-kec";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer as createAgentServer } from "../../src/index.js";
import { callReviewProject, connectInMemoryMcp } from "./helpers/mcpHarness.js";
import { assertNoDuplicateKecChunks, indexKecFixtureThroughMcp } from "./helpers/kecFixture.js";
import {
  createReviewFixture,
  normalizeMarkdown,
  rewriteKecSourcePdf,
  withE2eEnvironment,
} from "./helpers/reviewFixture.js";

const requiredReportSections = [
  "# 프로젝트 개요",
  "# 주요 설계 내용",
  "# 관련 KEC 조항",
  "# 항목별 검토",
  "# 잠재 위험",
  "# 확인 필요사항",
  "# 검토 의견",
];

function responseText(result: { content: Array<{ type: string; text: string }> }): string {
  const first = result.content[0];

  if (!first || first.type !== "text") {
    throw new Error("MCP review_project response did not contain text");
  }

  return first.text;
}

function expectRequiredSections(markdown: string): void {
  for (const section of requiredReportSections) {
    expect(markdown.includes(section)).toBe(true);
  }
}

describe("review project MCP E2E", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reindexes KEC without stale chunks and returns deterministic markdown through review_project", async () => {
    const fixture = await createReviewFixture();
    const fetchSpy = vi.fn(async () => {
      throw new Error("E2E tests must not make network requests");
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await withE2eEnvironment(fixture, async () => {
        const kecConnection = await connectInMemoryMcp(createKecServer());

        try {
          const firstIndex = await indexKecFixtureThroughMcp(kecConnection.client);
          rewriteKecSourcePdf(fixture);
          const secondIndex = await indexKecFixtureThroughMcp(kecConnection.client);

          expect(firstIndex.indexedChunks).toBeGreaterThan(0);
          expect(firstIndex.indexedChunks).toBeGreaterThan(secondIndex.indexedChunks);
          expect(secondIndex.indexedChunks).toBe(1);
        } finally {
          await kecConnection.close();
          expect(kecConnection.isClosed()).toBe(true);
        }

        const store = new SqliteVectorStore(fixture.kecDbPath);
        try {
          await assertNoDuplicateKecChunks(store, "knowledge/kec-source.pdf", {
            expectedCount: 1,
            excludedText: "Obsolete KEC source content.",
          });
        } finally {
          await store.close();
        }

        const agentConnection = await connectInMemoryMcp(createAgentServer());

        try {
          const firstResponse = await callReviewProject(agentConnection.client);
          const secondResponse = await callReviewProject(agentConnection.client);
          const firstMarkdown = responseText(firstResponse);
          const secondMarkdown = responseText(secondResponse);

          expect(firstResponse.isError).not.toBe(true);
          expect(typeof firstMarkdown).toBe("string");
          expect(firstMarkdown.length).toBeGreaterThan(0);
          expectRequiredSections(firstMarkdown);
          expect(firstMarkdown.includes("KEC 232.5 p.1:")).toBe(true);
          expect(
            firstMarkdown.includes(
              "warning: estimates/load-schedule.xlsx has 2 sheets; reviewed first sheet only: Summary",
            ),
          ).toBe(true);
          expect(
            firstMarkdown.includes(
              "warning: estimates/load-schedule.xlsx [Summary] was limited to 50 rows",
            ),
          ).toBe(true);
          expect(normalizeMarkdown(firstMarkdown, fixture.projectRoot)).toBe(
            normalizeMarkdown(secondMarkdown, fixture.projectRoot),
          );
        } finally {
          await agentConnection.close();
          expect(agentConnection.isClosed()).toBe(true);
        }

        expect(fetchSpy).not.toHaveBeenCalled();
      });
    } finally {
      await fixture.cleanup();
    }

    expect(existsSync(fixture.projectRoot)).toBe(false);
  });
});
