export type NormalizedBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DrawingTextItem = {
  id: string;
  text: string;
  normalizedText: string;
  bbox: NormalizedBBox;
  pageBBox: PageBBox;
  rotation: number;
  fontName: string | null;
  fontSize: number | null;
  direction: "ltr" | "rtl" | "ttb" | null;
  hasEOL: boolean;
  sourceOrder: number;
  provenance: {
    transform: number[];
    width: number;
    height: number;
  };
};

export type DrawingTextLine = {
  id: string;
  text: string;
  normalizedText: string;
  bbox: NormalizedBBox;
  pageBBox: PageBBox;
  rotation: number;
  itemIds: string[];
  sourceOrders: number[];
};

export type DrawingLayoutDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  page: number;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  coordinateSystem: "normalized-top-left";
  itemCount: number;
  lineCount: number;
  items: DrawingTextItem[];
  lines: DrawingTextLine[];
  warnings: string[];
  relativeLayoutPath?: string;
};

export type PdfTextItemLike = {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
  fontName?: string;
  dir?: string;
  hasEOL?: boolean;
  sourceOrder?: number;
};

export type DrawingLayoutPageInput = {
  page: number;
  pageWidth: number;
  pageHeight: number;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  rotation: number;
  viewportTransform: readonly number[];
  items: readonly PdfTextItemLike[];
};

export type DrawingItemGeometry = {
  bbox: NormalizedBBox;
  pageBBox: PageBBox;
  rotation: number;
  fontSize: number;
  provenance: {
    transform: number[];
    width: number;
    height: number;
  };
};

export type NormalizePageItemsResult = {
  itemCount: number;
  items: DrawingTextItem[];
  warnings: string[];
};
