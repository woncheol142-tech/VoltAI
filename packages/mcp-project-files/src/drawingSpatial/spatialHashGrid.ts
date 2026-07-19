import type { DrawingPaintedPath, PageBBox } from "../drawingPrimitive/types.js";

const CELL_SIZE_PT = 8;
const MAX_CELLS_PER_PRIMITIVE = 64;
const MAX_QUERY_CELLS = 4_096;

export type SpatialHashGridDiagnostics = {
  gridBucketCount: number;
  gridReferenceCount: number;
  overflowPrimitiveCount: number;
};

export type SpatialHashGrid = {
  readonly diagnostics: SpatialHashGridDiagnostics;
  query(bbox: PageBBox, expansionPt: number): number[];
};

type CellRange = {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
  count: number;
  safe: boolean;
};

function validateBBox(bbox: PageBBox): void {
  for (const value of Object.values(bbox)) {
    if (!Number.isFinite(value)) {
      throw new Error("Drawing spatial grid bbox must contain finite numbers");
    }
  }
  if (bbox.width < 0 || bbox.height < 0) {
    throw new Error("Drawing spatial grid bbox dimensions must be non-negative");
  }
}

function cellRange(bbox: PageBBox, expansionPt = 0): CellRange {
  validateBBox(bbox);
  if (!Number.isFinite(expansionPt) || expansionPt < 0) {
    throw new Error("Drawing spatial grid expansion must be finite and non-negative");
  }
  const minimumX = Math.floor((bbox.x - expansionPt) / CELL_SIZE_PT);
  const maximumX = Math.floor(
    (bbox.x + bbox.width + expansionPt) / CELL_SIZE_PT,
  );
  const minimumY = Math.floor((bbox.y - expansionPt) / CELL_SIZE_PT);
  const maximumY = Math.floor(
    (bbox.y + bbox.height + expansionPt) / CELL_SIZE_PT,
  );
  const width = maximumX - minimumX + 1;
  const height = maximumY - minimumY + 1;
  const count = width * height;
  return {
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    count,
    safe: Number.isSafeInteger(minimumX) &&
      Number.isSafeInteger(maximumX) &&
      Number.isSafeInteger(minimumY) &&
      Number.isSafeInteger(maximumY) &&
      Number.isSafeInteger(count) &&
      count > 0,
  };
}

function zigZag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function cellKey(x: number, y: number): number | null {
  const left = zigZag(x);
  const right = zigZag(y);
  const key = left >= right
    ? left * left + left + right
    : left + right * right;
  if (!Number.isSafeInteger(key)) {
    return null;
  }
  return key;
}

function intersectsExpandedBBox(
  primitiveBBox: PageBBox,
  queryBBox: PageBBox,
  expansionPt: number,
): boolean {
  return !(
    primitiveBBox.x + primitiveBBox.width < queryBBox.x - expansionPt ||
    primitiveBBox.x > queryBBox.x + queryBBox.width + expansionPt ||
    primitiveBBox.y + primitiveBBox.height < queryBBox.y - expansionPt ||
    primitiveBBox.y > queryBBox.y + queryBBox.height + expansionPt
  );
}

export function createSpatialHashGrid(
  primitives: readonly DrawingPaintedPath[],
): SpatialHashGrid {
  const buckets = new Map<number, number[]>();
  const overflow: number[] = [];
  let referenceCount = 0;

  for (const [primitiveIndex, primitive] of primitives.entries()) {
    const range = cellRange(primitive.pageBBox);
    if (!range.safe || range.count > MAX_CELLS_PER_PRIMITIVE) {
      overflow.push(primitiveIndex);
      continue;
    }
    const keys: number[] = [];
    for (let x = range.minimumX; x <= range.maximumX; x += 1) {
      for (let y = range.minimumY; y <= range.maximumY; y += 1) {
        const key = cellKey(x, y);
        if (key === null) {
          keys.length = 0;
          break;
        }
        keys.push(key);
      }
      if (keys.length === 0) break;
    }
    if (keys.length !== range.count) {
      overflow.push(primitiveIndex);
      continue;
    }
    for (const key of keys) {
        const bucket = buckets.get(key);
        if (bucket) bucket.push(primitiveIndex);
        else buckets.set(key, [primitiveIndex]);
        referenceCount += 1;
    }
  }

  const markers = new Uint32Array(primitives.length);
  const allPrimitiveIndexes = primitives.map((_, index) => index);
  let generation = 0;

  return {
    diagnostics: {
      gridBucketCount: buckets.size,
      gridReferenceCount: referenceCount,
      overflowPrimitiveCount: overflow.length,
    },
    query(bbox, expansionPt) {
      const range = cellRange(bbox, expansionPt);
      if (!range.safe || range.count > MAX_QUERY_CELLS) {
        return [...allPrimitiveIndexes];
      }
      generation += 1;
      if (generation === 0xffff_ffff) {
        markers.fill(0);
        generation = 1;
      }
      const result: number[] = [];
      const append = (primitiveIndex: number) => {
        if (markers[primitiveIndex] === generation) return;
        markers[primitiveIndex] = generation;
        result.push(primitiveIndex);
      };
      for (let x = range.minimumX; x <= range.maximumX; x += 1) {
        for (let y = range.minimumY; y <= range.maximumY; y += 1) {
          const key = cellKey(x, y);
          if (key === null) return [...allPrimitiveIndexes];
          for (const primitiveIndex of buckets.get(key) ?? []) {
            const primitive = primitives[primitiveIndex];
            if (
              primitive &&
              (expansionPt === 0 ||
                intersectsExpandedBBox(primitive.pageBBox, bbox, expansionPt))
            ) {
              append(primitiveIndex);
            }
          }
        }
      }
      for (const primitiveIndex of overflow) append(primitiveIndex);
      return result;
    },
  };
}
