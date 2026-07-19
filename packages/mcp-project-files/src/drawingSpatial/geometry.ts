import type { PageBBox } from "../drawingPrimitive/types.js";
import type {
  SpatialRelationGeometry,
  SpatialRelationType,
  SpatialTopology,
} from "./types.js";

export const TOUCH_EPSILON_PT = 0.01;

export class SpatialGeometryUnrepresentableError extends Error {
  constructor() {
    super("Drawing spatial geometry derived metrics are not representable");
    this.name = "SpatialGeometryUnrepresentableError";
  }
}

export type SpatialGeometryAnalysis = SpatialRelationGeometry & {
  relationTypes: SpatialRelationType[];
  distancePt: number;
  rawHorizontalGapPt: number;
  rawVerticalGapPt: number;
  rawDistancePt: number;
  rawCenterDeltaXPt: number;
  rawCenterDeltaYPt: number;
  rawIntersectionAreaPt2: number;
};

function canonicalNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new SpatialGeometryUnrepresentableError();
  }
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}

type AxisIntervalAnalysis = {
  relation: "before" | "after" | "overlap";
  gap: number;
  overlapLength: number;
  legacyOverlapLength: number | null;
  centerDelta: number;
  publicCenterDelta: number;
};

const PUBLIC_HALF_STEP_PT = 0.0005;

function additionError(start: number, offset: number): number {
  return Math.abs(((start + offset) - start) - offset);
}

function legacyOverlapLength(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
): number | null {
  const firstEnd = firstStart + firstLength;
  const secondEnd = secondStart + secondLength;
  if (!Number.isFinite(firstEnd) || !Number.isFinite(secondEnd)) return null;
  return Math.max(
    0,
    Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart),
  );
}

function publicIntersectionArea(
  stableArea: number,
  horizontalLegacyOverlap: number | null,
  verticalLegacyOverlap: number | null,
): number {
  if (horizontalLegacyOverlap === null || verticalLegacyOverlap === null) {
    return stableArea;
  }
  const legacyArea = horizontalLegacyOverlap * verticalLegacyOverlap;
  return Number.isFinite(legacyArea) &&
      Math.abs(legacyArea - stableArea) < PUBLIC_HALF_STEP_PT
    ? legacyArea
    : stableArea;
}

function publicCenterDelta(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
  stableCenterDelta: number,
): number {
  const firstHalfLength = firstLength / 2;
  const secondHalfLength = secondLength / 2;
  const firstCenter = firstStart + firstHalfLength;
  const secondCenter = secondStart + secondHalfLength;
  const firstAdditionError = additionError(firstStart, firstHalfLength);
  const secondAdditionError = additionError(secondStart, secondHalfLength);

  // Preserve existing serialized values when endpoint addition loses less than
  // the public 3-decimal resolution. Raw decisions always use the stable form.
  if (
    Number.isFinite(firstCenter) &&
    Number.isFinite(secondCenter) &&
    firstAdditionError < PUBLIC_HALF_STEP_PT &&
    secondAdditionError < PUBLIC_HALF_STEP_PT
  ) {
    return firstCenter - secondCenter;
  }
  return stableCenterDelta;
}

function analyzeAxisIntervals(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
): AxisIntervalAnalysis {
  const firstStartsEarlier = firstStart <= secondStart;
  const startDelta = firstStartsEarlier
    ? secondStart - firstStart
    : firstStart - secondStart;
  const leadingLength = firstStartsEarlier ? firstLength : secondLength;
  const trailingLength = firstStartsEarlier ? secondLength : firstLength;
  const signedGap = startDelta - leadingLength;
  const relation = signedGap > 0
    ? firstStartsEarlier ? "before" : "after"
    : "overlap";
  const gap = relation === "overlap" ? 0 : signedGap;
  const overlapLength = relation === "overlap"
    ? Math.max(0, Math.min(leadingLength - startDelta, trailingLength))
    : 0;
  const centerDelta = (firstStart - secondStart) +
    (firstLength - secondLength) / 2;
  return {
    relation,
    gap,
    overlapLength,
    legacyOverlapLength: legacyOverlapLength(
      firstStart,
      firstLength,
      secondStart,
      secondLength,
    ),
    centerDelta,
    publicCenterDelta: publicCenterDelta(
      firstStart,
      firstLength,
      secondStart,
      secondLength,
      centerDelta,
    ),
  };
}

export function isBeyondSpatialDistance(
  primitiveBBox: PageBBox,
  textBBox: PageBBox,
  maximumDistancePt: number,
): boolean {
  validateBBox(primitiveBBox, "primitive");
  validateBBox(textBBox, "text");
  if (!Number.isFinite(maximumDistancePt) || maximumDistancePt < 0) {
    throw new Error("Drawing spatial maximum distance must be finite and non-negative");
  }
  const horizontal = analyzeAxisIntervals(
    primitiveBBox.x,
    primitiveBBox.width,
    textBBox.x,
    textBBox.width,
  );
  if (horizontal.gap > maximumDistancePt) return true;
  const vertical = analyzeAxisIntervals(
    primitiveBBox.y,
    primitiveBBox.height,
    textBBox.y,
    textBBox.height,
  );
  return vertical.gap > maximumDistancePt ||
    Math.hypot(horizontal.gap, vertical.gap) > maximumDistancePt;
}

function validateBBox(bbox: PageBBox, label: string): void {
  for (const [field, value] of Object.entries(bbox)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Drawing spatial ${label} bbox.${field} must be finite`);
    }
  }
  if (bbox.width < 0 || bbox.height < 0) {
    throw new Error(
      `Drawing spatial ${label} bbox dimensions must be non-negative`,
    );
  }
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOUCH_EPSILON_PT;
}

function equalBBox(left: PageBBox, right: PageBBox): boolean {
  return (
    approximatelyEqual(left.x, right.x) &&
    approximatelyEqual(left.y, right.y) &&
    approximatelyEqual(left.width, right.width) &&
    approximatelyEqual(left.height, right.height)
  );
}

function contains(outer: PageBBox, inner: PageBBox): boolean {
  const containsAxis = (
    outerStart: number,
    outerLength: number,
    innerStart: number,
    innerLength: number,
  ) => {
    const startDelta = innerStart - outerStart;
    return startDelta >= -TOUCH_EPSILON_PT &&
      startDelta <= outerLength - innerLength + TOUCH_EPSILON_PT;
  };
  return containsAxis(outer.x, outer.width, inner.x, inner.width) &&
    containsAxis(outer.y, outer.height, inner.y, inner.height);
}

function relationTypes(topology: SpatialTopology): SpatialRelationType[] {
  switch (topology) {
    case "contains":
      return ["contains", "intersects"];
    case "inside":
      return ["inside", "intersects"];
    case "overlaps":
      return ["intersects", "overlaps"];
    case "touches":
      return ["touches"];
    case "disjoint":
      return [];
  }
}

export function analyzeSpatialGeometry(
  primitiveBBox: PageBBox,
  textBBox: PageBBox,
): SpatialGeometryAnalysis {
  validateBBox(primitiveBBox, "primitive");
  validateBBox(textBBox, "text");

  const horizontal = analyzeAxisIntervals(
    primitiveBBox.x,
    primitiveBBox.width,
    textBBox.x,
    textBBox.width,
  );
  const vertical = analyzeAxisIntervals(
    primitiveBBox.y,
    primitiveBBox.height,
    textBBox.y,
    textBBox.height,
  );
  const intersectionWidth = horizontal.overlapLength;
  const intersectionHeight = vertical.overlapLength;
  const horizontalGap = horizontal.gap;
  const verticalGap = vertical.gap;
  const edgeDistance = Math.hypot(horizontalGap, verticalGap);
  const centerDeltaX = horizontal.centerDelta;
  const centerDeltaY = vertical.centerDelta;
  const intersectionArea = intersectionWidth * intersectionHeight;
  const serializedIntersectionArea = publicIntersectionArea(
    intersectionArea,
    horizontal.legacyOverlapLength,
    vertical.legacyOverlapLength,
  );

  let topology: SpatialTopology;
  if (equalBBox(primitiveBBox, textBBox)) {
    topology = "overlaps";
  } else if (contains(primitiveBBox, textBBox)) {
    topology = "contains";
  } else if (contains(textBBox, primitiveBBox)) {
    topology = "inside";
  } else if (
    intersectionWidth > TOUCH_EPSILON_PT &&
    intersectionHeight > TOUCH_EPSILON_PT
  ) {
    topology = "overlaps";
  } else if (edgeDistance <= TOUCH_EPSILON_PT) {
    topology = "touches";
  } else {
    topology = "disjoint";
  }

  return {
    basis: "page-bbox",
    topology,
    relationTypes: relationTypes(topology),
    distancePt: topology === "disjoint" ? canonicalNumber(edgeDistance) : 0,
    rawHorizontalGapPt: horizontalGap,
    rawVerticalGapPt: verticalGap,
    rawDistancePt: topology === "disjoint" ? edgeDistance : 0,
    rawCenterDeltaXPt: centerDeltaX,
    rawCenterDeltaYPt: centerDeltaY,
    rawIntersectionAreaPt2: intersectionArea,
    horizontalGapPt: canonicalNumber(horizontalGap),
    verticalGapPt: canonicalNumber(verticalGap),
    centerDeltaXPt: canonicalNumber(horizontal.publicCenterDelta),
    centerDeltaYPt: canonicalNumber(vertical.publicCenterDelta),
    intersectionAreaPt2: canonicalNumber(serializedIntersectionArea),
  };
}
