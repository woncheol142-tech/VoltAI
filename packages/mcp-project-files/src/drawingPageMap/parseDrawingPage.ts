import type { DrawingIndexRecord } from "../drawingIndex/types.js";
import type {
  DrawingPageCandidate,
  DrawingPageParseResult,
  DrawingPageTextItem,
  DrawingPageTextPage,
} from "./types.js";

const DRAWING_NUMBER_PATTERN = /^[A-Z]{1,4}-\d{2,4}[A-Z]?$/u;
const NUMBER_ZONE = { minX: 0.095, maxX: 0.125, minY: 0.07, maxY: 0.17 };
const TITLE_ZONE = { minX: 0.13, maxX: 0.21, minY: 0.075, maxY: 0.18 };
const NUMBER_COLUMN_X = 65.9 / 595;
const COLUMN_TOLERANCE = 0.0035;

type PositionedItem = {
  text: string;
  x: number;
  y: number;
};

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replaceAll("\0", " ").replace(/\s+/gu, " ").trim();
}

function compactDrawingNumber(value: string): string {
  return normalizeText(value).toUpperCase().replace(/[\s-]+/gu, "");
}

function canonicalDrawingNumber(value: string): string | null {
  const compact = compactDrawingNumber(value);
  const match = /^([A-Z]{1,4})(\d{2,4})([A-Z]?)$/u.exec(compact);
  if (!match) return null;
  const canonical = `${match[1]}-${match[2]}${match[3]}`;
  return DRAWING_NUMBER_PATTERN.test(canonical) ? canonical : null;
}

function positioned(item: DrawingPageTextItem, page: DrawingPageTextPage): PositionedItem | null {
  const text = normalizeText(item.str);
  if (!text || page.width <= 0 || page.height <= 0) return null;

  return {
    text,
    x: (item.transform[4] - (page.originX ?? 0)) / page.width,
    y: (item.transform[5] - (page.originY ?? 0)) / page.height,
  };
}

function inZone(item: PositionedItem, zone: typeof NUMBER_ZONE): boolean {
  return item.x >= zone.minX && item.x <= zone.maxX && item.y >= zone.minY && item.y <= zone.maxY;
}

function groupNumberColumns(items: readonly PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((left, right) => left.x - right.x || right.y - left.y);
  const groups: PositionedItem[][] = [];

  for (const item of sorted) {
    const group = groups.find(
      (candidate) => Math.abs(candidate.reduce((sum, value) => sum + value.x, 0) / candidate.length - item.x) <= COLUMN_TOLERANCE,
    );
    if (group) group.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => [...group].sort((left, right) => right.y - left.y));
}

function reconstructedNumbers(group: readonly PositionedItem[]): string[] {
  const values = new Set<string>();
  for (let start = 0; start < group.length; start += 1) {
    const canonical = canonicalDrawingNumber(group.slice(start).map(({ text }) => text).join(""));
    if (canonical) values.add(canonical);
  }
  for (const { text } of group) {
    const canonical = canonicalDrawingNumber(text);
    if (canonical) values.add(canonical);
  }
  return [...values].sort(compareCodePoint);
}

function normalizedTitle(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function titleSimilarity(detected: string | null, indexed: string): number {
  if (!detected) return 0;
  const left = normalizedTitle(detected);
  const right = normalizedTitle(indexed);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  const leftBigrams = new Set(Array.from({ length: Math.max(0, left.length - 1) }, (_, index) => left.slice(index, index + 2)));
  const rightBigrams = new Set(Array.from({ length: Math.max(0, right.length - 1) }, (_, index) => right.slice(index, index + 2)));
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;
  let overlap = 0;
  for (const token of leftBigrams) if (rightBigrams.has(token)) overlap += 1;
  return overlap / Math.max(leftBigrams.size, rightBigrams.size);
}

function extractTitle(items: readonly PositionedItem[]): string | null {
  const titleItems = items
    .filter((item) => inZone(item, TITLE_ZONE))
    .filter(({ text }) => text !== "NONE" && !/^\d+\/\d+$/u.test(text))
    .sort((left, right) => right.x - left.x || right.y - left.y);
  const title = normalizeText(titleItems.map(({ text }) => text).join(""));
  return title || null;
}

function confidence(candidate: DrawingPageCandidate, hasMultiple: boolean): number {
  const titleContribution = candidate.titleExact
    ? 0.15
    : Math.min(0.08, candidate.titleSimilarity * 0.08);
  const titlePresence = !candidate.titleExact && candidate.titleSimilarity > 0 ? 0.01 : 0;
  const ambiguityPenalty = hasMultiple ? 0.02 : 0;
  return Math.max(
    0,
    Math.min(1, Math.round((0.76 + candidate.zoneStrength * 0.08 + titleContribution + titlePresence - ambiguityPenalty) * 1000) / 1000),
  );
}

export function parseDrawingPage(
  page: DrawingPageTextPage,
  drawings: readonly DrawingIndexRecord[],
): DrawingPageParseResult {
  const positionedItems = page.items
    .map((item) => positioned(item, page))
    .filter((item): item is PositionedItem => item !== null);
  const title = extractTitle(positionedItems);
  const indexed = new Map(drawings.map((drawing) => [drawing.drawingNo, drawing]));
  const warnings: string[] = [];
  const candidates: DrawingPageCandidate[] = [];

  for (const group of groupNumberColumns(positionedItems.filter((item) => inZone(item, NUMBER_ZONE)))) {
    const numbers = reconstructedNumbers(group);
    const indexedNumbers = numbers.filter((drawingNo) => indexed.has(drawingNo));
    for (const drawingNo of numbers) {
      const drawing = indexed.get(drawingNo);
      if (!drawing) {
        if (indexedNumbers.length === 0) {
          warnings.push(`page ${page.page} title-block drawing number ${drawingNo} is not present in the index`);
        }
        continue;
      }
      const x = group.reduce((sum, item) => sum + item.x, 0) / group.length;
      candidates.push({
        drawing,
        normalizedX: x,
        titleSimilarity: titleSimilarity(title, drawing.title),
        titleExact:
          title !== null && normalizedTitle(title) === normalizedTitle(drawing.title),
        zoneStrength: Math.max(0, 1 - Math.abs(x - NUMBER_COLUMN_X) / 0.02),
        rawText: normalizeText(group.map(({ text }) => text).join(" ")),
      });
    }
  }

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.drawing.drawingNo, candidate])).values()];
  if (uniqueCandidates.length === 0) {
    return { page: page.page, mapping: null, warnings: warnings.sort(compareCodePoint) };
  }

  let selected: DrawingPageCandidate | undefined;
  if (uniqueCandidates.length === 1) {
    selected = uniqueCandidates[0];
  } else {
    const ranked = [...uniqueCandidates].sort(
      (left, right) =>
        right.titleSimilarity - left.titleSimilarity ||
        right.zoneStrength - left.zoneStrength ||
        compareCodePoint(left.drawing.drawingNo, right.drawing.drawingNo),
    );
    if (ranked[0]!.titleSimilarity > 0 && ranked[0]!.titleSimilarity - ranked[1]!.titleSimilarity >= 0.15) {
      selected = ranked[0];
    } else {
      warnings.push(
        `page ${page.page} has ambiguous title-block candidates: ${ranked.map(({ drawing }) => drawing.drawingNo).sort(compareCodePoint).join(", ")}`,
      );
    }
  }

  if (!selected) {
    return { page: page.page, mapping: null, warnings: warnings.sort(compareCodePoint) };
  }

  if (title && !selected.titleExact) {
    warnings.push(`page ${page.page} ${selected.drawing.drawingNo} title does not match the drawing index`);
  }

  return {
    page: page.page,
    mapping: {
      drawingNo: selected.drawing.drawingNo,
      drawingPage: page.page,
      detectedTitle: title,
      confidence: confidence(selected, uniqueCandidates.length > 1),
      matchMethod: "title-block-coordinate",
      rawText: selected.rawText,
    },
    warnings: warnings.sort(compareCodePoint),
  };
}
