import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { createListProjectFilesTool } from "./tools/listProjectFiles.js";
import { createReadExcelTool } from "./tools/readExcel.js";
import { createReadPdfTool } from "./tools/readPdf.js";
import { createRenderPdfPageTool } from "./tools/renderPdfPage.js";

export { listProjectFiles } from "./tools/listProjectFiles.js";
export { readExcel } from "./tools/readExcel.js";
export { readExcelSheetWithProvenance } from "./tools/readExcel.js";
export { readPdf } from "./tools/readPdf.js";
export { renderPdfPage } from "./tools/renderPdfPage.js";
export type { ProjectFile } from "./tools/listProjectFiles.js";
export type { ReadExcelResult } from "./tools/readExcel.js";
export type {
  ExcelProvenanceRow,
  ReadExcelSheetWithProvenanceResult,
} from "./tools/readExcel.js";
export type { ReadPdfResult } from "./tools/readPdf.js";
export type {
  RenderPdfPageInput,
  RenderPdfPageResult,
} from "./tools/renderPdfPage.js";

export function createServer() {
  return createVoltAiMcpServer({
    name: "mcp-project-files",
    version: "0.1.0",
    tools: [
      createListProjectFilesTool(),
      createReadPdfTool(),
      createReadExcelTool(),
      createRenderPdfPageTool(),
    ],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
