export type NormalizedPoint = {
  x: number;
  y: number;
};

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

export type DrawingPathCommand =
  | { command: "M"; points: [NormalizedPoint] }
  | { command: "L"; points: [NormalizedPoint] }
  | {
      command: "C";
      points: [NormalizedPoint, NormalizedPoint, NormalizedPoint];
    }
  | { command: "Q"; points: [NormalizedPoint, NormalizedPoint] }
  | { command: "Z"; points: [] };

export type DrawingPaintStyle = {
  strokeWidthUserSpace: number | null;
  lineCap: number | null;
  lineJoin: number | null;
  miterLimit: number | null;
  dashArray: number[] | null;
  dashPhase: number | null;
  strokeColor: string | number[] | null;
  fillColor: string | number[] | null;
  strokeAlpha: number | null;
  fillAlpha: number | null;
};

export type DrawingPaintedPath = {
  id: string;
  type: "path";
  paint: "stroke" | "fill" | "fill-stroke";
  fillRule: "nonzero" | "evenodd" | null;
  bbox: NormalizedBBox;
  pageBBox: PageBBox;
  commands: DrawingPathCommand[];
  subpathCount: number;
  closedSubpathCount: number;
  style: DrawingPaintStyle;
  sourceOrder: number;
  provenance: {
    operatorIndex: number;
    pathOperatorCount: number;
  };
};

export type DrawingPrimitiveDocument = {
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
  primitiveCount: number;
  primitives: DrawingPaintedPath[];
  warnings: string[];
  relativePrimitivePath?: string;
};
