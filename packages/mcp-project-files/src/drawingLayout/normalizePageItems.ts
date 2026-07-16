import { createTextItemGeometry } from "./geometry.js";
import type {
  DrawingLayoutPageInput,
  DrawingTextItem,
  NormalizePageItemsResult,
  PdfTextItemLike,
} from "./types.js";

type WarningRecord = {
  code: "EMPTY_TEXT" | "INVALID_GEOMETRY" | "NO_TEXT_ITEMS" | "OUTSIDE_PAGE";
  sourceOrder: number | null;
  reason: string;
};

type Candidate = Omit<DrawingTextItem, "id">;

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replaceAll("\u0000", " ").replace(/\s+/gu, " ").trim();
}

function warningText(warning: WarningRecord): string {
  if (warning.sourceOrder === null) {
    return `${warning.code}: ${warning.reason}`;
  }
  return `${warning.code} sourceOrder=${warning.sourceOrder}: ${warning.reason}`;
}

function compareWarning(left: WarningRecord, right: WarningRecord): number {
  return (
    compareCodePoint(left.code, right.code) ||
    compareNumber(left.sourceOrder ?? Number.MAX_SAFE_INTEGER, right.sourceOrder ?? Number.MAX_SAFE_INTEGER) ||
    compareCodePoint(left.reason, right.reason)
  );
}

function geometryFailure(item: PdfTextItemLike): { code: WarningRecord["code"]; reason: string } {
  if (!Array.isArray(item.transform) || item.transform.length !== 6) {
    return { code: "INVALID_GEOMETRY", reason: "malformed transform" };
  }
  if (!item.transform.every(Number.isFinite)) {
    return { code: "INVALID_GEOMETRY", reason: "non-finite transform" };
  }
  if (!Number.isFinite(item.width)) {
    return { code: "INVALID_GEOMETRY", reason: "non-finite width" };
  }
  if (!Number.isFinite(item.height)) {
    return { code: "INVALID_GEOMETRY", reason: "non-finite height" };
  }
  if (item.width === 0) {
    return { code: "INVALID_GEOMETRY", reason: "zero width" };
  }
  if (item.height === 0) {
    return { code: "INVALID_GEOMETRY", reason: "zero height" };
  }
  if (item.width < 0) {
    return { code: "INVALID_GEOMETRY", reason: "negative width" };
  }
  if (item.height < 0) {
    return { code: "INVALID_GEOMETRY", reason: "negative height" };
  }
  return { code: "OUTSIDE_PAGE", reason: "item excluded" };
}

function compareArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const compared = compareNumber(left[index]!, right[index]!);
    if (compared !== 0) {
      return compared;
    }
  }
  return compareNumber(left.length, right.length);
}

function compareCandidate(left: Candidate, right: Candidate): number {
  return (
    compareNumber(left.rotation, right.rotation) ||
    compareNumber(left.pageBBox.y, right.pageBBox.y) ||
    compareNumber(left.pageBBox.x, right.pageBBox.x) ||
    compareNumber(left.pageBBox.height, right.pageBBox.height) ||
    compareNumber(left.pageBBox.width, right.pageBBox.width) ||
    compareCodePoint(left.normalizedText, right.normalizedText) ||
    compareCodePoint(left.text, right.text) ||
    compareCodePoint(left.fontName ?? "", right.fontName ?? "") ||
    compareCodePoint(left.direction ?? "", right.direction ?? "") ||
    compareNumber(Number(left.hasEOL), Number(right.hasEOL)) ||
    compareArrays(left.provenance.transform, right.provenance.transform) ||
    compareNumber(left.provenance.width, right.provenance.width) ||
    compareNumber(left.provenance.height, right.provenance.height) ||
    compareNumber(left.sourceOrder, right.sourceOrder)
  );
}

function direction(value: string | undefined): DrawingTextItem["direction"] {
  return value === "ltr" || value === "rtl" || value === "ttb" ? value : null;
}

function stableFontName(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.replace(/^g_d\d+_/u, "");
}

export function normalizePageItems(page: DrawingLayoutPageInput): NormalizePageItemsResult {
  const candidates: Candidate[] = [];
  const warnings: WarningRecord[] = [];

  page.items.forEach((item, itemIndex) => {
    const sourceOrder = item.sourceOrder ?? itemIndex;
    const text = item.str;
    const normalizedText = normalizeText(text);
    if (normalizedText.length === 0) {
      warnings.push({
        code: "EMPTY_TEXT",
        sourceOrder,
        reason: "normalized text is empty",
      });
      return;
    }

    const geometry = createTextItemGeometry(page, item);
    if (!geometry) {
      const failure = geometryFailure(item);
      warnings.push({ ...failure, sourceOrder });
      return;
    }

    candidates.push({
      text,
      normalizedText,
      bbox: geometry.bbox,
      pageBBox: geometry.pageBBox,
      rotation: geometry.rotation,
      fontName: stableFontName(item.fontName),
      fontSize: geometry.fontSize,
      direction: direction(item.dir),
      hasEOL: item.hasEOL === true,
      sourceOrder,
      provenance: geometry.provenance,
    });
  });

  const items = candidates
    .sort(compareCandidate)
    .map((item, index): DrawingTextItem => ({
      id: `text-item-${String(index + 1).padStart(6, "0")}`,
      ...item,
    }));

  if (
    items.length === 0 &&
    (page.items.length === 0 || warnings.some(({ code }) => code !== "EMPTY_TEXT"))
  ) {
    warnings.push({
      code: "NO_TEXT_ITEMS",
      sourceOrder: null,
      reason: "page contains no valid text items",
    });
  }

  return {
    itemCount: items.length,
    items,
    warnings: warnings.sort(compareWarning).map(warningText),
  };
}
