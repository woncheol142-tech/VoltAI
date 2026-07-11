import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import ExcelJS from "../../../mcp-project-files/node_modules/exceljs";

export { connectInMemoryMcp } from "../../../mcp-agent/test/e2e/helpers/mcpHarness.js";

export type MaterialMcpFixture = {
  projectRoot: string;
  dbPath: string;
  xlsxRelativePath: string;
  outsideRoot: string;
  cleanup: () => void;
};

function workbookPath(root: string, relativePath: string): string {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export async function writeMaterialWorkbook(
  root: string,
  relativePath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const catalog = workbook.addWorksheet("Catalog");
  catalog.addRow([
    "Item Code",
    "Name",
    "Manufacturer",
    "Model",
    "Category",
    "Specification",
    "Unit",
    "Unit Price",
    "Currency",
  ]);
  catalog.addRow([
    "CB-001",
    "XLPE Cable",
    "Volt Electric",
    "X-100",
    "Cable",
    "0.6/1kV 4C 25sq",
    "m",
    12000,
    "KRW",
  ]);
  catalog.addRow([
    "BR-002",
    "MCCB Breaker",
    null,
    null,
    "Breaker",
    "3P 100A",
    "ea",
    85000,
    "KRW",
  ]);
  const notes = workbook.addWorksheet("Notes");
  notes.addRow(["Note"]);
  notes.addRow(["Not part of the indexed Catalog sheet"]);

  await workbook.xlsx.writeFile(workbookPath(root, relativePath));
}

export async function createMaterialMcpFixture(): Promise<MaterialMcpFixture> {
  const projectRoot = mkdtempSync(join(tmpdir(), "voltai-mcp-material-"));
  const outsideRoot = mkdtempSync(
    join(tmpdir(), "voltai-mcp-material-outside-"),
  );
  const xlsxRelativePath = "catalogs/electrical-materials.xlsx";
  const dbPath = join(projectRoot, ".voltai", "material-test.sqlite");

  await writeMaterialWorkbook(projectRoot, xlsxRelativePath);
  await writeMaterialWorkbook(outsideRoot, "outside.xlsx");

  return {
    projectRoot,
    dbPath,
    xlsxRelativePath,
    outsideRoot,
    cleanup: () => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    },
  };
}

export function createOutsideSymlink(fixture: MaterialMcpFixture): string {
  const relativePath = "catalogs/outside-link.xlsx";
  const linkPath = workbookPath(fixture.projectRoot, relativePath);
  symlinkSync(join(fixture.outsideRoot, "outside.xlsx"), linkPath);
  return relativePath;
}

export function materialMcpEnvironment(
  fixture: MaterialMcpFixture,
): Record<string, string> {
  return {
    PROJECT_ROOT: fixture.projectRoot,
    KNOWLEDGE_DB_PATH: fixture.dbPath,
    MATERIAL_EMBED_PROVIDER: "placeholder",
  };
}

export function readToolText(result: unknown): string {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("MCP result content is missing");
  }

  const first = result.content[0] as
    { type?: unknown; text?: unknown } | undefined;
  if (first?.type !== "text" || typeof first.text !== "string") {
    throw new Error("MCP result did not contain text");
  }

  return first.text;
}

export async function loadMcpMaterial() {
  return import("../../../mcp-material/src/index.js");
}
