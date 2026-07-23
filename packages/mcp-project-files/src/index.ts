import {
  createVoltAiMcpServer,
  isMainModule,
  runStdioServer,
} from "@voltai/mcp-core";

import { createListProjectFilesTool } from "./tools/listProjectFiles.js";
import { createIndexDrawingListTool } from "./tools/indexDrawingList.js";
import { createMapDrawingPagesTool } from "./tools/mapDrawingPages.js";
import { createReadExcelTool } from "./tools/readExcel.js";
import { createReadPdfTool } from "./tools/readPdf.js";
import { createRenderPdfPageTool } from "./tools/renderPdfPage.js";
import { createSearchDrawingsTool } from "./tools/searchDrawings.js";
import { createExtractDrawingLayoutTool } from "./tools/extractDrawingLayout.js";
import { createExtractDrawingPrimitivesTool } from "./tools/extractDrawingPrimitives.js";
import { createExtractDrawingClassificationTool } from "./tools/extractDrawingClassification.js";
import { createExtractDrawingSpatialRelationsTool } from "./tools/extractDrawingSpatialRelations.js";
import { createQueryCircuitGraphTool } from "./tools/queryCircuitGraph.js";

export { listProjectFiles } from "./tools/listProjectFiles.js";
export {
  createIndexDrawingListTool,
  indexDrawingList,
} from "./tools/indexDrawingList.js";
export { readExcel } from "./tools/readExcel.js";
export { readExcelSheetWithProvenance } from "./tools/readExcel.js";
export { readPdf } from "./tools/readPdf.js";
export { renderPdfPage } from "./tools/renderPdfPage.js";
export {
  createMapDrawingPagesTool,
  mapDrawingPages,
} from "./tools/mapDrawingPages.js";
export {
  createSearchDrawingsTool,
  searchDrawings,
} from "./tools/searchDrawings.js";
export {
  createExtractDrawingLayoutTool,
  extractDrawingLayout,
} from "./tools/extractDrawingLayout.js";
export {
  createExtractDrawingPrimitivesTool,
  extractDrawingPrimitives,
} from "./tools/extractDrawingPrimitives.js";
export {
  createExtractDrawingClassificationTool,
  extractDrawingClassification,
} from "./tools/extractDrawingClassification.js";
export {
  createExtractDrawingSpatialRelationsTool,
  extractDrawingSpatialRelations,
} from "./tools/extractDrawingSpatialRelations.js";
export { buildDrawingSpatialRelations } from "./drawingSpatial/buildDrawingSpatialRelations.js";
export { writeDrawingSpatialRelations } from "./drawingSpatial/writeDrawingSpatialRelations.js";
export {
  canonicalizeElectricalCandidate,
  runElectricalObjectRules,
  validateElectricalCandidate,
  validateElectricalRule,
} from "./drawingElectricalObjects/candidate.js";
export {
  computeElectricalConfidence,
  electricalObjectStatus,
} from "./drawingElectricalObjects/confidence.js";
export { createElectricalObjectId } from "./drawingElectricalObjects/objectIdentity.js";
export { validateElectricalConstructionInput } from "./drawingElectricalObjects/validateElectricalConstructionInput.js";
export { createElectricalEvidenceIndex } from "./drawingElectricalObjects/evidenceIndex.js";
export { resolveElectricalObjectCandidates } from "./drawingElectricalObjects/resolveCandidates.js";
export { assembleElectricalObjects } from "./drawingElectricalObjects/assembleElectricalObjects.js";
export { buildElectricalConstructionGraph } from "./drawingElectricalObjects/constructionGraph.js";
export {
  validateElectricalDocument,
  validateElectricalObjects,
} from "./drawingElectricalObjects/validateElectricalObjects.js";
export {
  serializeElectricalDocument,
  serializeElectricalObjects,
} from "./drawingElectricalObjects/serializeElectricalObjects.js";
export {
  writeElectricalDocument,
  writeElectricalObjects,
} from "./drawingElectricalObjects/writeElectricalObjects.js";
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
export type {
  DrawingPaintedPath,
  DrawingPaintStyle,
  DrawingPathCommand,
  DrawingPrimitiveDocument,
  NormalizedPoint,
} from "./drawingPrimitive/types.js";
export type {
  ExtractDrawingPrimitivesInput,
  ExtractDrawingPrimitivesResult,
} from "./tools/extractDrawingPrimitives.js";
export type {
  DrawingPrimitiveClassificationDocument,
  PrimitiveClassification,
  PrimitiveClassificationDiagnostics,
  PrimitiveClassificationGeometry,
  PrimitiveClassificationKind,
  PrimitiveClassificationStatistics,
} from "./drawingClassification/types.js";
export type {
  ExtractDrawingClassificationInput,
  ExtractDrawingClassificationResult,
} from "./tools/extractDrawingClassification.js";
export type {
  DrawingSpatialRelationDocument,
  SpatialRelation,
  SpatialRelationGeometry,
  SpatialRelationPolicy,
  SpatialRelationStatistics,
  SpatialRelationType,
  SpatialTextEntityType,
  SpatialTopology,
} from "./drawingSpatial/types.js";
export type {
  ExtractDrawingSpatialRelationsInput,
  ExtractDrawingSpatialRelationsResult,
} from "./tools/extractDrawingSpatialRelations.js";
export type {
  BuildElectricalObjectsInput,
  CandidateConflict,
  CandidateResolution,
  ConstructionGraph,
  ConstructionGraphComponent,
  ConstructionGraphEdge,
  ConstructionGraphEdgeType,
  DrawingElectricalObjectDocument,
  ElectricalAttribute,
  ElectricalConfidenceComponents,
  ElectricalConstructionContext,
  ElectricalObject,
  ElectricalObjectCandidate,
  ElectricalObjectDiagnostics,
  ElectricalObjectLabel,
  ElectricalObjectRule,
  ElectricalObjectStatistics,
  ElectricalObjectStatus,
  ElectricalObjectType,
} from "./drawingElectricalObjects/types.js";
export type { ConstructionGraphEdgeInput } from "./drawingElectricalObjects/constructionGraph.js";
export type { ElectricalEvidenceIndex } from "./drawingElectricalObjects/evidenceIndex.js";
export type { ElectricalObjectIdentityInput } from "./drawingElectricalObjects/objectIdentity.js";
export type {
  ElectricalValidationIssue,
  ElectricalValidationIssueSeverity,
  ElectricalValidationResult,
} from "./drawingElectricalObjects/validateElectricalObjects.js";

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
      createExtractDrawingPrimitivesTool(),
      createExtractDrawingClassificationTool(),
      createExtractDrawingSpatialRelationsTool(),
      createQueryCircuitGraphTool(),
    ],
  });
}

export async function main(): Promise<void> {
  await runStdioServer(createServer());
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
