import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import { reviewProject as defaultReviewProject } from "@voltai/agent-review";
import type { ReviewProjectPorts } from "@voltai/agent-review";
import type { VoltAiTool } from "@voltai/mcp-core";
import { z } from "zod";

import { createLocalReviewPorts } from "../ports/localReviewPorts.js";

export type ReviewProjectToolInput = {
  projectPath?: string;
};

export type ReviewProjectFunction = (
  input: ReviewProjectToolInput,
  ports: ReviewProjectPorts,
) => Promise<string>;

export type ReviewProjectToolOptions = {
  reviewProject?: ReviewProjectFunction;
};

function assertReviewProjectToolInput(input: unknown): ReviewProjectToolInput {
  if (input === undefined) {
    return {};
  }

  if (!input || typeof input !== "object") {
    throw new Error("projectPath must be a string");
  }

  const candidate = input as Partial<ReviewProjectToolInput>;

  if (candidate.projectPath !== undefined) {
    if (typeof candidate.projectPath !== "string" || candidate.projectPath.length === 0) {
      throw new Error("projectPath must be a string");
    }
  }

  return { projectPath: candidate.projectPath };
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

function isWithinProjectRoot(projectRoot: string, projectPath: string): boolean {
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`;

  return projectPath === projectRoot || projectPath.startsWith(rootPrefix);
}

function resolveReviewProjectPath(projectRoot: string, requestedPath: string | undefined): string {
  if (requestedPath === undefined) {
    return projectRoot;
  }

  let stats;
  const absolutePath = resolve(requestedPath);

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

export function createReviewProjectTool(options: ReviewProjectToolOptions = {}): VoltAiTool {
  return {
    name: "review_project",
    description: "Generate an engineering design review report for a project folder.",
    inputSchema: {
      projectPath: z.string().min(1).optional(),
    },
    handler: async (input) => {
      const toolInput = assertReviewProjectToolInput(input);
      const runReviewProject = options.reviewProject ?? defaultReviewProject;
      const projectRoot = assertProjectRoot(process.env.PROJECT_ROOT);
      const projectPath = resolveReviewProjectPath(projectRoot, toolInput.projectPath);

      return runReviewProject({ projectPath }, createLocalReviewPorts(projectPath));
    },
  };
}
