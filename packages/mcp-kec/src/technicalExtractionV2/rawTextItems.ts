export interface KecV2RawGeometry {
  readonly transform: readonly [number, number, number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly hasEOL: boolean;
  readonly direction: string;
}

export interface KecV2RawBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface KecV2QuantizedGeometry {
  readonly unit: "1/1000-point";
  readonly bbox: KecV2RawBoundingBox;
}

export interface KecV2RawTextItem {
  readonly pageNumber: number;
  readonly originalItemIndex: number;
  readonly rawText: string;
  readonly fontName: string;
  readonly rawGeometry: KecV2RawGeometry;
  readonly bbox: KecV2RawBoundingBox;
  readonly quantizedGeometry: KecV2QuantizedGeometry;
}

export type KecV2RawItemAnomalyKind =
  "INVALID_RAW_ITEM" | "INVALID_RAW_GEOMETRY";

export interface KecV2RawItemAnomaly {
  readonly kind: KecV2RawItemAnomalyKind;
  readonly pageNumber: number;
  readonly originalItemIndex: number;
  readonly reason: string;
}

export interface KecV2RawTextItemPage {
  readonly pageNumber: number;
  readonly items: readonly KecV2RawTextItem[];
  readonly anomalies: readonly KecV2RawItemAnomaly[];
}

export interface KecV2PdfTextContent {
  readonly items: readonly unknown[];
  readonly styles?: Readonly<Record<string, unknown>>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eligibleTextItem(value: unknown): value is UnknownRecord & {
  readonly str: string;
} {
  return isRecord(value) && typeof value.str === "string";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rawTransform(
  value: unknown,
): KecV2RawGeometry["transform"] | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    !value.every(finiteNumber)
  ) {
    return undefined;
  }
  return Object.freeze([
    value[0],
    value[1],
    value[2],
    value[3],
    value[4],
    value[5],
  ]) as KecV2RawGeometry["transform"];
}

function anomaly(
  kind: KecV2RawItemAnomalyKind,
  pageNumber: number,
  originalItemIndex: number,
  reason: string,
): KecV2RawItemAnomaly {
  return Object.freeze({ kind, pageNumber, originalItemIndex, reason });
}

function quantize(value: number): number | undefined {
  const quantized = Math.round(value * 1_000);
  if (!Number.isSafeInteger(quantized)) return undefined;
  return Object.is(quantized, -0) ? 0 : quantized;
}

function frozenBbox(
  x: number,
  y: number,
  width: number,
  height: number,
): KecV2RawBoundingBox {
  return Object.freeze({ x, y, width, height });
}

export function captureKecV2RawTextItemPage(
  pageNumber: number,
  content: KecV2PdfTextContent,
): KecV2RawTextItemPage {
  const items: KecV2RawTextItem[] = [];
  const anomalies: KecV2RawItemAnomaly[] = [];

  content.items.forEach((sourceItem, originalItemIndex) => {
    if (!eligibleTextItem(sourceItem)) return;

    const transform = rawTransform(sourceItem.transform);
    if (
      transform === undefined ||
      !finiteNumber(sourceItem.width) ||
      !finiteNumber(sourceItem.height)
    ) {
      anomalies.push(
        anomaly(
          "INVALID_RAW_GEOMETRY",
          pageNumber,
          originalItemIndex,
          "transform must contain six finite numbers and dimensions must be finite",
        ),
      );
      return;
    }
    if (
      typeof sourceItem.dir !== "string" ||
      sourceItem.dir.length === 0 ||
      typeof sourceItem.fontName !== "string" ||
      sourceItem.fontName.length === 0 ||
      typeof sourceItem.hasEOL !== "boolean"
    ) {
      anomalies.push(
        anomaly(
          "INVALID_RAW_ITEM",
          pageNumber,
          originalItemIndex,
          "direction, font name, and EOL flag are required",
        ),
      );
      return;
    }

    const bbox = frozenBbox(
      transform[4],
      transform[5],
      sourceItem.width,
      sourceItem.height,
    );
    const quantizedX = quantize(bbox.x);
    const quantizedY = quantize(bbox.y);
    const quantizedWidth = quantize(bbox.width);
    const quantizedHeight = quantize(bbox.height);
    if (
      quantizedX === undefined ||
      quantizedY === undefined ||
      quantizedWidth === undefined ||
      quantizedHeight === undefined
    ) {
      anomalies.push(
        anomaly(
          "INVALID_RAW_GEOMETRY",
          pageNumber,
          originalItemIndex,
          "geometry cannot be represented at 1/1000-point precision",
        ),
      );
      return;
    }
    const quantizedBbox = frozenBbox(
      quantizedX,
      quantizedY,
      quantizedWidth,
      quantizedHeight,
    );
    items.push(
      Object.freeze({
        pageNumber,
        originalItemIndex,
        rawText: sourceItem.str,
        fontName: sourceItem.fontName,
        rawGeometry: Object.freeze({
          transform,
          width: sourceItem.width,
          height: sourceItem.height,
          hasEOL: sourceItem.hasEOL,
          direction: sourceItem.dir,
        }),
        bbox,
        quantizedGeometry: Object.freeze({
          unit: "1/1000-point" as const,
          bbox: quantizedBbox,
        }),
      }),
    );
  });

  return Object.freeze({
    pageNumber,
    items: Object.freeze(items),
    anomalies: Object.freeze(anomalies),
  });
}
