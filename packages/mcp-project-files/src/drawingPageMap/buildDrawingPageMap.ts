import type { BuildDrawingPageMapInput, DrawingPageMapDocument, DrawingPageMapping } from "./types.js";

const DRAWING_NUMBER_PARTS = /^([A-Z]{1,4})-(\d{1,4})([A-Z]?)$/u;

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDrawingNumber(left: string, right: string): number {
  const leftMatch = DRAWING_NUMBER_PARTS.exec(left);
  const rightMatch = DRAWING_NUMBER_PARTS.exec(right);
  if (!leftMatch || !rightMatch) return compareCodePoint(left, right);
  return (
    compareCodePoint(leftMatch[1]!, rightMatch[1]!) ||
    Number(leftMatch[2]) - Number(rightMatch[2]) ||
    compareCodePoint(leftMatch[3]!, rightMatch[3]!)
  );
}

function compareMapping(left: DrawingPageMapping, right: DrawingPageMapping): number {
  return left.drawingPage - right.drawingPage || compareDrawingNumber(left.drawingNo, right.drawingNo);
}

function roundCoverage(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000;
}

export function buildDrawingPageMap(input: BuildDrawingPageMapInput): DrawingPageMapDocument {
  if (input.index.drawings.length === 0 || input.index.drawingCount === 0) {
    throw new Error("Drawing index has no drawings (empty index)");
  }
  if (input.endPage < input.startPage) {
    throw new Error("endPage must be greater than or equal to startPage");
  }

  const processed = input.pageResults.filter((result) => result.status === "processed");
  if (processed.length === 0) {
    throw new Error("All drawing pages failed; no page was processed");
  }
  const mismatchedPage = processed.find(
    (result) => result.mapping !== null && result.mapping.drawingPage !== result.page,
  );
  if (mismatchedPage?.mapping) {
    throw new Error(
      `Mapping page ${mismatchedPage.mapping.drawingPage} does not match scan result page ${mismatchedPage.page}`,
    );
  }

  const mappings = processed
    .flatMap((result) => (result.mapping ? [{ ...result.mapping }] : []))
    .sort(compareMapping);
  const outOfRange = mappings.find(
    ({ drawingPage }) => drawingPage < input.startPage || drawingPage > input.endPage,
  );
  if (outOfRange) {
    throw new Error(
      `Mapping page ${outOfRange.drawingPage} is outside the scanned range ${input.startPage}-${input.endPage}`,
    );
  }
  const pagesByDrawing = new Map<string, number[]>();
  for (const mapping of mappings) {
    const pages = pagesByDrawing.get(mapping.drawingNo) ?? [];
    pages.push(mapping.drawingPage);
    pagesByDrawing.set(mapping.drawingNo, pages);
  }
  const duplicatePageMatches = [...pagesByDrawing]
    .filter(([, pages]) => pages.length > 1)
    .map(([drawingNo, pages]) => ({ drawingNo, pages: [...pages].sort((a, b) => a - b) }))
    .sort((left, right) => compareDrawingNumber(left.drawingNo, right.drawingNo));
  const mappedNumbers = new Set(mappings.map(({ drawingNo }) => drawingNo));
  const unmatchedDrawingNumbers = [...new Set(input.index.drawings.map(({ drawingNo }) => drawingNo))]
    .filter((drawingNo) => !mappedNumbers.has(drawingNo))
    .sort(compareDrawingNumber);
  const warnings = [
    ...processed.flatMap(({ warnings }) => warnings),
    ...input.pageResults.flatMap((result) =>
      result.status === "failed" ? [`page ${result.page} extraction failed: ${result.message}`] : [],
    ),
    ...duplicatePageMatches.map(
      ({ drawingNo, pages }) => `duplicate drawing ${drawingNo} mapped to pages ${pages.join(", ")}`,
    ),
    ...(mappings.length === 0 ? ["no drawing page mapping was found in the scanned range"] : []),
  ].sort(compareCodePoint);

  return {
    schemaVersion: 1,
    source: input.source,
    sourceSha256: input.sourceSha256,
    indexPath: input.indexPath,
    indexSourceSha256: input.index.sourceSha256,
    startPage: input.startPage,
    endPage: input.endPage,
    scannedPageCount: input.endPage - input.startPage + 1,
    indexedDrawingCount: input.index.drawings.length,
    mappingCount: mappings.length,
    unmatchedCount: unmatchedDrawingNumbers.length,
    coverageRatio: roundCoverage(mappings.length / input.index.drawings.length),
    mappings,
    unmatchedDrawingNumbers,
    duplicatePageMatches,
    warnings,
  };
}
