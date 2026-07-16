import { Util } from "pdfjs-dist/legacy/build/pdf.mjs";

import type {
  DrawingItemGeometry,
  DrawingLayoutPageInput,
  NormalizedBBox,
  PageBBox,
  PdfTextItemLike,
} from "./types.js";

const POINT_PRECISION = 3;
const NORMALIZED_PRECISION = 6;

function canonicalNumber(value: number, precision: number): number {
  const rounded = Math.round(value * 10 ** precision) / 10 ** precision;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundPoint(value: number): number {
  return canonicalNumber(value, POINT_PRECISION);
}

export function roundNormalized(value: number): number {
  return canonicalNumber(value, NORMALIZED_PRECISION);
}

export function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  const normalized = ((value % 360) + 360) % 360;
  const rounded = roundPoint(normalized);
  return rounded === 360 ? 0 : rounded;
}

function isFiniteArray(value: readonly number[], length: number): boolean {
  return value.length === length && value.every(Number.isFinite);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedBBox(pageBBox: PageBBox, pageWidth: number, pageHeight: number): NormalizedBBox {
  const x = roundNormalized(pageBBox.x / pageWidth);
  const y = roundNormalized(pageBBox.y / pageHeight);
  const width = roundNormalized(pageBBox.width / pageWidth);
  const height = roundNormalized(pageBBox.height / pageHeight);

  return {
    x,
    y,
    width: roundNormalized(Math.min(width, 1 - x)),
    height: roundNormalized(Math.min(height, 1 - y)),
  };
}

export function createTextItemGeometry(
  page: DrawingLayoutPageInput,
  item: PdfTextItemLike,
): DrawingItemGeometry | null {
  if (
    !Number.isFinite(page.pageWidth) ||
    !Number.isFinite(page.pageHeight) ||
    page.pageWidth <= 0 ||
    page.pageHeight <= 0 ||
    !isFiniteArray(page.viewportTransform, 6) ||
    !isFiniteArray(item.transform, 6) ||
    !Number.isFinite(item.width) ||
    !Number.isFinite(item.height) ||
    item.width <= 0 ||
    item.height <= 0
  ) {
    return null;
  }

  const transform = [...item.transform];
  const viewportTransform =
    page.rotation === 0 &&
    page.viewportTransform[0] === 1 &&
    page.viewportTransform[1] === 0 &&
    page.viewportTransform[2] === 0 &&
    page.viewportTransform[3] === -1
      ? [1, 0, 0, -1, -page.cropBox.x, page.cropBox.y + page.pageHeight]
      : [...page.viewportTransform];
  const visual = Util.transform(
    viewportTransform as number[],
    transform as number[],
  );
  if (!isFiniteArray(visual, 6)) {
    return null;
  }

  const baselineLength = Math.hypot(visual[0], visual[1]);
  const verticalLength = Math.hypot(visual[2], visual[3]);
  if (baselineLength <= 0 || verticalLength <= 0) {
    return null;
  }

  const baseline = {
    x: visual[0] / baselineLength,
    y: visual[1] / baselineLength,
  };
  const vertical = {
    x: visual[2] / verticalLength,
    y: visual[3] / verticalLength,
  };
  const origin = { x: visual[4], y: visual[5] };
  const corners = [
    origin,
    { x: origin.x + baseline.x * item.width, y: origin.y + baseline.y * item.width },
    { x: origin.x + vertical.x * item.height, y: origin.y + vertical.y * item.height },
    {
      x: origin.x + baseline.x * item.width + vertical.x * item.height,
      y: origin.y + baseline.y * item.width + vertical.y * item.height,
    },
  ];
  if (corners.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    return null;
  }

  const minimumX = Math.min(...corners.map(({ x }) => x));
  const maximumX = Math.max(...corners.map(({ x }) => x));
  const minimumY = Math.min(...corners.map(({ y }) => y));
  const maximumY = Math.max(...corners.map(({ y }) => y));
  if (
    maximumX <= 0 ||
    maximumY <= 0 ||
    minimumX >= page.pageWidth ||
    minimumY >= page.pageHeight
  ) {
    return null;
  }

  const left = clamp(minimumX, 0, page.pageWidth);
  const right = clamp(maximumX, 0, page.pageWidth);
  const top = clamp(minimumY, 0, page.pageHeight);
  const bottom = clamp(maximumY, 0, page.pageHeight);
  if (right <= left || bottom <= top) {
    return null;
  }

  const pageBBox: PageBBox = {
    x: roundPoint(left),
    y: roundPoint(top),
    width: roundPoint(right - left),
    height: roundPoint(bottom - top),
  };

  return {
    pageBBox,
    bbox: normalizedBBox(pageBBox, page.pageWidth, page.pageHeight),
    rotation: normalizeAngle(
      (Math.atan2(transform[1]!, transform[0]!) * 180) / Math.PI + page.rotation,
    ),
    fontSize: roundPoint(baselineLength),
    provenance: {
      transform,
      width: item.width,
      height: item.height,
    },
  };
}

export function createNormalizedBBox(
  pageBBox: PageBBox,
  pageWidth: number,
  pageHeight: number,
): NormalizedBBox {
  return normalizedBBox(pageBBox, pageWidth, pageHeight);
}
