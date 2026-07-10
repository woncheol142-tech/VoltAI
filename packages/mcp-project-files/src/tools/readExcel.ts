import { extname } from "node:path";

import type { VoltAiTool } from "@voltai/mcp-core";
import ExcelJS from "exceljs";
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
  totalRows?: number;
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

  if (extension !== ".xlsx") {
    throw new Error("Only .xlsx files are supported");
  }
}

function readSheetRows(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  maxRows?: number,
): { rows: unknown[][]; totalRows: number } {
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error("Sheet not found");
  }

  const rows: unknown[][] = [];
  let totalRows = 0;

  sheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    let lastValueIndex = -1;

    for (let index = 0; index < values.length; index += 1) {
      if (values[index] !== null && values[index] !== undefined) {
        lastValueIndex = index;
      }
    }

    if (lastValueIndex < 0) {
      return;
    }

    totalRows += 1;

    if (maxRows !== undefined && rows.length >= maxRows) {
      return;
    }

    const normalizedValues: unknown[] = [];

    for (let index = 0; index <= lastValueIndex; index += 1) {
      const value = values[index];

      if (value === undefined) {
        normalizedValues.push(null);
      } else if (value instanceof Date) {
        normalizedValues.push(value);
      } else if (typeof value === "object" && value !== null && "result" in value) {
        normalizedValues.push((value as { result?: unknown }).result ?? null);
      } else {
        normalizedValues.push(value);
      }
    }

    rows.push(normalizedValues);
  });

  return { rows, totalRows };
}

export async function readExcel(
  projectRoot: string | undefined,
  input: unknown,
): Promise<ReadExcelResult> {
  const root = assertProjectRoot(projectRoot);
  const { relativePath, sheetName, maxRows } = assertReadExcelInput(input);

  assertAllowedRelativePath(relativePath);

  const absolutePath = resolveProjectFile(root, relativePath, "Excel file does not exist");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);
  const result: ReadExcelResult = {
    relativePath,
    sheets: workbook.worksheets.map((sheet) => sheet.name),
  };

  if (sheetName === undefined) {
    return result;
  }

  const sheetRows = readSheetRows(workbook, sheetName, maxRows);

  return {
    ...result,
    sheetName,
    rows: sheetRows.rows,
    totalRows: sheetRows.totalRows,
  };
}

export function createReadExcelTool(): VoltAiTool<ReadExcelResult> {
  return {
    name: "read_excel",
    description: "Read workbook sheets and sheet rows from an Excel file under PROJECT_ROOT.",
    inputSchema: {
      relativePath: z.string().min(1),
      sheetName: z.string().optional(),
      maxRows: z.number().int().positive().optional(),
    },
    handler: async (input) => readExcel(process.env.PROJECT_ROOT, input),
  };
}
