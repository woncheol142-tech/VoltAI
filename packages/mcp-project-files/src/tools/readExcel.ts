import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import * as XLSX from "xlsx";
import { z } from "zod";

import {
  assertAllowedRelativePath as assertAllowedProjectRelativePath,
  assertProjectRoot,
  resolveProjectFile,
} from "../projectPath.js";

export type ReadExcelInput = {
  relativePath: string;
  sheetName?: string;
  maxRows?: number;
};

export type ReadExcelResult = {
  relativePath: string;
  sheets: string[];
  sheetName?: string;
  rows?: unknown[][];
};

function assertReadExcelInput(input: unknown): ReadExcelInput {
  if (!input || typeof input !== "object") {
    throw new Error("relativePath is required");
  }

  const candidate = input as Partial<ReadExcelInput>;

  if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0) {
    throw new Error("relativePath is required");
  }

  if (candidate.sheetName !== undefined && typeof candidate.sheetName !== "string") {
    throw new Error("sheetName must be a string");
  }

  if (
    candidate.maxRows !== undefined &&
    (!Number.isInteger(candidate.maxRows) || candidate.maxRows < 1)
  ) {
    throw new Error("maxRows must be a positive integer");
  }

  return {
    relativePath: candidate.relativePath,
    sheetName: candidate.sheetName,
    maxRows: candidate.maxRows,
  };
}

function assertAllowedRelativePath(relativePath: string): void {
  assertAllowedProjectRelativePath(relativePath);

  const extension = extname(relativePath).toLowerCase();

  if (extension !== ".xlsx" && extension !== ".xls") {
    throw new Error("Only .xlsx and .xls files are supported");
  }
}

function readSheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string,
  maxRows?: number,
): unknown[][] {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error("Sheet not found");
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });

  if (maxRows === undefined) {
    return rows;
  }

  return rows.slice(0, maxRows);
}

export async function readExcel(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ReadExcelResult> {
  const root = assertProjectRoot(projectRoot);
  const { relativePath, sheetName, maxRows } = assertReadExcelInput(input);

  assertAllowedRelativePath(relativePath);

  const absolutePath = resolveProjectFile(root, relativePath, "Excel file does not exist");
  const workbook = XLSX.readFile(absolutePath);
  const result: ReadExcelResult = {
    relativePath,
    sheets: workbook.SheetNames,
  };

  if (sheetName === undefined) {
    return result;
  }

  return {
    ...result,
    sheetName,
    rows: readSheetRows(workbook, sheetName, maxRows),
  };
}

export function createReadExcelTool(): VoltAiTool {
  return {
    name: "read_excel",
    description: "Read workbook sheets and sheet rows from an Excel file under PROJECT_ROOT.",
    inputSchema: {
      relativePath: z.string().min(1),
      sheetName: z.string().optional(),
      maxRows: z.number().int().positive().optional(),
    },
    handler: async (input) => JSON.stringify(await readExcel(process.env.PROJECT_ROOT, input)),
  };
}
