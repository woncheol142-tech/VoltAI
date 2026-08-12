import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import {
  reviewElectricalRequest as defaultReviewElectricalRequest,
  type ElectricalReviewPorts,
  type ElectricalReviewRequestInput,
  type ElectricalReviewResult,
} from "@voltai/agent-review";
import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import { createLocalElectricalReviewPorts } from "../ports/localElectricalReviewPorts.js";

const DEFAULT_INDEX_PATH = ".volt-ai/indexes/drawing-index.json";
const DEFAULT_PAGE_MAP_PATH = ".volt-ai/page-maps/drawing-pages.json";
const INPUT_FIELDS = new Set(["projectPath", "request"]);

export type ReviewElectricalRequestToolInput = {
  projectPath?: string;
  request: string;
};

export type ReviewElectricalRequestFunction = (
  input: ElectricalReviewRequestInput,
  ports: ElectricalReviewPorts,
) => Promise<ElectricalReviewResult>;

export type ReviewElectricalRequestToolOptions = {
  reviewElectricalRequest?: ReviewElectricalRequestFunction;
  createPorts?: (projectPath: string) => ElectricalReviewPorts;
  indexPath?: string;
  pageMapPath?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertToolInput(input: unknown): ReviewElectricalRequestToolInput {
  if (!isRecord(input)) {
    throw new Error("request is required");
  }
  const unsupported = Object.keys(input).find(
    (field) => !INPUT_FIELDS.has(field),
  );
  if (unsupported !== undefined) {
    throw new Error(
      `review_electrical_request input contains unsupported field: ${unsupported}`,
    );
  }
  if (typeof input.request !== "string" || input.request.trim().length === 0) {
    throw new Error("request is required");
  }
  if (
    input.projectPath !== undefined &&
    (typeof input.projectPath !== "string" || input.projectPath.length === 0)
  ) {
    throw new Error("projectPath must be a string");
  }

  return {
    request: input.request,
    ...(input.projectPath === undefined
      ? {}
      : { projectPath: input.projectPath }),
  };
}

function assertProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot) {
    throw new Error("PROJECT_ROOT is required");
  }

  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    throw new Error("PROJECT_ROOT must be an existing directory");
  }
  if (!stats.isDirectory()) {
    throw new Error("PROJECT_ROOT must be an existing directory");
  }

  return realpathSync(projectRoot);
}

function isWithinProjectRoot(
  projectRoot: string,
  projectPath: string,
): boolean {
  const rootPrefix = projectRoot.endsWith(sep)
    ? projectRoot
    : `${projectRoot}${sep}`;
  return projectPath === projectRoot || projectPath.startsWith(rootPrefix);
}

function resolveProjectPath(
  projectRoot: string,
  requestedPath: string | undefined,
): string {
  if (requestedPath === undefined) {
    return projectRoot;
  }

  const absolutePath = resolve(requestedPath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    throw new Error("projectPath must be an existing directory");
  }
  if (!stats.isDirectory()) {
    throw new Error("projectPath must be an existing directory");
  }

  const realPath = realpathSync(absolutePath);
  if (!isWithinProjectRoot(projectRoot, realPath)) {
    throw new Error("projectPath must stay within PROJECT_ROOT");
  }

  return realPath;
}

export function createReviewElectricalRequestTool(
  options: ReviewElectricalRequestToolOptions = {},
): VoltAiTool<ElectricalReviewResult> {
  return {
    name: "review_electrical_request",
    description:
      "Find the requested electrical drawing and review its mapped page against KEC and optional company knowledge.",
    inputSchema: {
      projectPath: z.string().min(1).optional(),
      request: z.string().min(1),
    },
    handler: async (input) => {
      const toolInput = assertToolInput(input);
      const projectRoot = assertProjectRoot(process.env.PROJECT_ROOT);
      const projectPath = resolveProjectPath(
        projectRoot,
        toolInput.projectPath,
      );
      const runReview =
        options.reviewElectricalRequest ?? defaultReviewElectricalRequest;
      const ports =
        options.createPorts?.(projectPath) ??
        createLocalElectricalReviewPorts(projectPath, {
          indexPath: options.indexPath ?? DEFAULT_INDEX_PATH,
          pageMapPath: options.pageMapPath ?? DEFAULT_PAGE_MAP_PATH,
        });

      return runReview({ projectPath, request: toolInput.request }, ports);
    },
  };
}
