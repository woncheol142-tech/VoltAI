import { createVoltAiMcpServer, isMainModule, runStdioServer } from "@voltai/mcp-core";

import { createListProjectFilesTool } from "./tools/listProjectFiles.js";
import { createIndexDrawingListTool } from "./tools/indexDrawingList.js";
import { createMapDrawingPagesTool } from "./tools/mapDrawingPages.js";
import { createReadExcelTool } from "./tools/readExcel.js";
import { createReadPdfTool } from "./tools/readPdf.js";
import { createRenderPdfPageTool } from "./tools/renderPdfPage.js";
import { createSearchDrawingsTool } from "./tools/searchDrawings.js";
import { createExtractDrawingLayoutTool } from "./tools/extractDrawingLayout.js";

export { listProjectFiles } from "./tools/listProjectFiles.js";
export {
  createIndexDrawingListTool,
  indexDrawingList,
} from "./tools/indexDrawingList.js";
export { readExcel } from "./tools/readExcel.js";
export { readExcelSheetWithProvenance } from "./tools/readExcel.js";
export { readPdf } from "./tools/readPdf.js";
export { renderPdfPage } from "./tools/renderPdfPage.js";
export { createMapDrawingPagesTool, mapDrawingPages } from "./tools/mapDrawingPages.js";
export { createSearchDrawingsTool, searchDrawings } from "./tools/searchDrawings.js";
export {
  createExtractDrawingLayoutTool,
  extractDrawingLayout,
} from "./tools/extractDrawingLayout.js";
export type { ProjectFile } from "./tools/listProjectFiles.js";
export type {
  IndexDrawingListInput,
  IndexDrawingListResult,
} from "./tools/indexDrawingList.js";
export type {
  DrawingCategory,
  DrawingIndexDocument,
  DrawingIndexRecord,
} from "./drawingIndex/types.js";
export type {
  DrawingPageMapping,
  DrawingPageMapDocument,
  DuplicatePageMatch,
} from "./drawingPageMap/types.js";
export type {
  MapDrawingPagesInput,
  MapDrawingPagesResult,
} from "./tools/mapDrawingPages.js";
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
export type {
  DrawingSearchFilters,
  DrawingSearchInput,
  DrawingSearchMatch,
  DrawingSearchOptions,
  DrawingSearchResult,
  NormalizedDrawingQuery,
} from "./drawingSearch/types.js";
export type {
  DrawingLayoutDocument,
  DrawingTextItem,
  DrawingTextLine,
  NormalizedBBox,
  PageBBox,
} from "./drawingLayout/types.js";
export type {
  ExtractDrawingLayoutInput,
  ExtractDrawingLayoutResult,
} from "./tools/extractDrawingLayout.js";

export function createServer() {
  return createVoltAiMcpServer({
    name: "mcp-project-files",
    version: "0.1.0",
    tools: [
      createListProjectFilesTool(),
      createReadPdfTool(),
      createReadExcelTool(),
      createRenderPdfPageTool(),
      createIndexDrawingListTool(),
      createMapDrawingPagesTool(),
      createSearchDrawingsTool(),
      createExtractDrawingLayoutTool(),
    ],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
