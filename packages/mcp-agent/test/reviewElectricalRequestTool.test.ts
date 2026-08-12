import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ElectricalReviewPorts,
  ElectricalReviewResult,
} from "@voltai/agent-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/index.js";
import { createReviewElectricalRequestTool } from "../src/tools/reviewElectricalRequestTool.js";
import { connectInMemoryMcp } from "./e2e/helpers/mcpHarness.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-electrical-tool-"));
  roots.push(root);
  return root;
}

function fakePorts(): ElectricalReviewPorts {
  return {
    searchDrawings: vi.fn(),
    readDrawingPage: vi.fn(),
    searchKec: vi.fn(),
    llm: { generateReview: vi.fn() },
  };
}

function notFoundResult(): ElectricalReviewResult {
  return {
    selection: "not-found",
    drawingQuery: "101동 전력간선",
    candidates: [],
    selectedDrawings: [],
    warnings: ["lexical search did not find a match"],
    kecCitations: [],
  };
}

describe("review_electrical_request MCP tool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the review_electrical_request name and exposes only request and projectPath", () => {
    const tool = createReviewElectricalRequestTool();

    expect(tool.name).toBe("review_electrical_request");
    expect(Object.keys(tool.inputSchema).sort()).toEqual([
      "projectPath",
      "request",
    ]);
  });

  it("accepts a request and binds an omitted projectPath to PROJECT_ROOT", async () => {
    const root = tempRoot();
    vi.stubEnv("PROJECT_ROOT", root);
    const ports = fakePorts();
    const createPorts = vi.fn(() => ports);
    const reviewElectricalRequest = vi.fn(async () => notFoundResult());
    const tool = createReviewElectricalRequestTool({
      createPorts,
      reviewElectricalRequest,
    });

    const result = await tool.handler({ request: "101동 전력간선 검토해줘" });

    expect(createPorts).toHaveBeenCalledWith(realpathSync(root));
    expect(reviewElectricalRequest).toHaveBeenCalledWith(
      {
        projectPath: realpathSync(root),
        request: "101동 전력간선 검토해줘",
      },
      ports,
    );
    expect(result.selection).toBe("not-found");
  });

  it.each(["sourcePath", "indexPath", "pageMapPath"])(
    "rejects caller-controlled %s",
    async (field) => {
      const tool = createReviewElectricalRequestTool();

      await expect(
        tool.handler({
          request: "101동 전력간선",
          [field]: "caller-controlled",
        }),
      ).rejects.toThrow(`unsupported field: ${field}`);
    },
  );

  it("requires PROJECT_ROOT", async () => {
    vi.stubEnv("PROJECT_ROOT", "");
    const tool = createReviewElectricalRequestTool({
      createPorts: () => fakePorts(),
      reviewElectricalRequest: vi.fn(async () => notFoundResult()),
    });

    await expect(tool.handler({ request: "101동 전력간선" })).rejects.toThrow(
      "PROJECT_ROOT is required",
    );
  });

  it("rejects projectPath outside PROJECT_ROOT", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    vi.stubEnv("PROJECT_ROOT", root);
    const reviewElectricalRequest = vi.fn(async () => notFoundResult());
    const tool = createReviewElectricalRequestTool({
      createPorts: () => fakePorts(),
      reviewElectricalRequest,
    });

    await expect(
      tool.handler({ projectPath: outside, request: "101동 전력간선" }),
    ).rejects.toThrow("projectPath must stay within PROJECT_ROOT");
    expect(reviewElectricalRequest).not.toHaveBeenCalled();
  });

  it("is registered exactly once in the agent server", async () => {
    const connection = await connectInMemoryMcp(createServer());

    try {
      const tools = await connection.client.listTools();
      const names = tools.tools.map((tool) => tool.name);

      expect(
        names.filter((name) => name === "review_electrical_request"),
      ).toEqual(["review_electrical_request"]);
    } finally {
      await connection.close();
    }
  });
});
