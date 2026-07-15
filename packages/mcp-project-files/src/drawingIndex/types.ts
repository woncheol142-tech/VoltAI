export type DrawingCategory =
  | "도면목록"
  | "수변전"
  | "전력간선"
  | "분전반"
  | "MCC"
  | "전등"
  | "전열"
  | "동력"
  | "접지"
  | "피뢰"
  | "태양광"
  | "보안등"
  | "조경등"
  | "소방"
  | "기계"
  | "기타";

export type DrawingIndexRecord = {
  drawingNo: string;
  title: string;
  category: DrawingCategory;
  complex: string | null;
  building: string | null;
  floor: string | null;
  scaleA1: string | null;
  scaleA3: string | null;
  sourceListPage: number;
  confidence: number;
  rawText?: string;
};

export type DrawingIndexDocument = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  startPage: number;
  endPage: number;
  drawingCount: number;
  drawings: DrawingIndexRecord[];
  warnings: string[];
  relativeIndexPath?: string;
};

export type DrawingListTextItem = {
  str: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
};

export type DrawingListTextPage = {
  page: number;
  items: DrawingListTextItem[];
};

export type DrawingListParseResult = {
  drawings: DrawingIndexRecord[];
  warnings: string[];
};

export type DrawingIndexWarning = {
  page: number;
  block: number;
  row: number;
  message: string;
};
