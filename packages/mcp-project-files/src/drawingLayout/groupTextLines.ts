import type {
  DrawingTextItem,
  DrawingTextLine,
  NormalizedBBox,
  PageBBox,
} from "./types.js";

const ANGLE_TOLERANCE_DEGREES = 2;

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ProjectedItem {
  item: DrawingTextItem;
  alongStart: number;
  alongEnd: number;
  perpendicularStart: number;
  perpendicularEnd: number;
  perpendicularCenter: number;
}

interface LineCandidate {
  rotation: number;
  projectionRotation: number;
  items: ProjectedItem[];
}

function normalizeAngle(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  const rounded = Math.round(normalized * 1000) / 1000;
  return rounded === 360 || Object.is(rounded, -0) ? 0 : rounded;
}

function projectionRotation(item: DrawingTextItem): number {
  const [a = 0, b = 0] = item.provenance.transform;
  const rawRotation = normalizeAngle((Math.atan2(b, a) * 180) / Math.PI);
  const pageRotation = normalizeAngle(item.rotation - rawRotation);
  return normalizeAngle(pageRotation - rawRotation);
}

function circularAngleDifference(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

function projectItem(item: DrawingTextItem, rotation: number): ProjectedItem {
  const radians = (rotation * Math.PI) / 180;
  const alongX = Math.cos(radians);
  const alongY = Math.sin(radians);
  const perpendicularX = -alongY;
  const perpendicularY = alongX;
  const { x, y, width, height } = item.pageBBox;
  const corners = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ] as const;
  const along = corners.map(([cornerX, cornerY]) => cornerX * alongX + cornerY * alongY);
  const perpendicular = corners.map(
    ([cornerX, cornerY]) => cornerX * perpendicularX + cornerY * perpendicularY,
  );
  const perpendicularStart = Math.min(...perpendicular);
  const perpendicularEnd = Math.max(...perpendicular);

  return {
    item,
    alongStart: Math.min(...along),
    alongEnd: Math.max(...along),
    perpendicularStart,
    perpendicularEnd,
    perpendicularCenter: (perpendicularStart + perpendicularEnd) / 2,
  };
}

function projectedThickness(item: ProjectedItem): number {
  return item.perpendicularEnd - item.perpendicularStart;
}

function canJoin(candidate: LineCandidate, projected: ProjectedItem): boolean {
  if (
    circularAngleDifference(
      candidate.projectionRotation,
      projectionRotation(projected.item),
    ) > ANGLE_TOLERANCE_DEGREES
  ) {
    return false;
  }

  const averageCenter =
    candidate.items.reduce((sum, item) => sum + item.perpendicularCenter, 0) /
    candidate.items.length;
  const maxThickness = Math.max(
    projectedThickness(projected),
    ...candidate.items.map(projectedThickness),
  );

  return Math.abs(projected.perpendicularCenter - averageCenter) <= Math.max(1, maxThickness * 0.6);
}

function compareProjectedItems(left: ProjectedItem, right: ProjectedItem): number {
  return (
    left.alongStart - right.alongStart ||
    left.alongEnd - right.alongEnd ||
    left.item.sourceOrder - right.item.sourceOrder ||
    compareCodePoint(left.item.id, right.item.id)
  );
}

function joinText(items: ProjectedItem[]): string {
  let result = "";

  for (let index = 0; index < items.length; index += 1) {
    const current = items[index]!;
    if (index === 0) {
      result = current.item.normalizedText;
      continue;
    }

    const previous = items[index - 1]!;
    const gap = current.alongStart - previous.alongEnd;
    result +=
      gap <= 0.5
        ? current.item.normalizedText
        : ` ${current.item.normalizedText}`;
  }

  return result;
}

function unionPageBBox(items: ProjectedItem[]): PageBBox {
  const minX = Math.min(...items.map(({ item }) => item.pageBBox.x));
  const minY = Math.min(...items.map(({ item }) => item.pageBBox.y));
  const maxX = Math.max(...items.map(({ item }) => item.pageBBox.x + item.pageBBox.width));
  const maxY = Math.max(...items.map(({ item }) => item.pageBBox.y + item.pageBBox.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function unionNormalizedBBox(items: ProjectedItem[]): NormalizedBBox {
  const minX = Math.min(...items.map(({ item }) => item.bbox.x));
  const minY = Math.min(...items.map(({ item }) => item.bbox.y));
  const maxX = Math.max(...items.map(({ item }) => item.bbox.x + item.bbox.width));
  const maxY = Math.max(...items.map(({ item }) => item.bbox.y + item.bbox.height));

  return {
    x: Number(minX.toFixed(6)),
    y: Number(minY.toFixed(6)),
    width: Number((maxX - minX).toFixed(6)),
    height: Number((maxY - minY).toFixed(6)),
  };
}

function splitAtExplicitLineEnds(items: ProjectedItem[]): ProjectedItem[][] {
  const groups: ProjectedItem[][] = [];
  let current: ProjectedItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const previous = current.at(-1);
    const gap = previous ? item.alongStart - previous.alongEnd : 0;
    const gapLimit = previous
      ? Math.max(previous.item.fontSize ?? 0, item.item.fontSize ?? 0, 12) * 2.5
      : Number.POSITIVE_INFINITY;

    if (previous && gap > gapLimit) {
      groups.push(current);
      current = [];
    }

    current.push(item);
    const next = items[index + 1];
    if (
      item.item.hasEOL &&
      (!next || item.item.sourceOrder < next.item.sourceOrder)
    ) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function compareLines(
  left: Omit<DrawingTextLine, "id">,
  right: Omit<DrawingTextLine, "id">,
): number {
  return (
    left.pageBBox.y - right.pageBBox.y ||
    left.pageBBox.x - right.pageBBox.x ||
    left.rotation - right.rotation ||
    compareCodePoint(left.text, right.text) ||
    left.sourceOrders[0]! - right.sourceOrders[0]!
  );
}

export function groupTextLines(items: readonly DrawingTextItem[]): DrawingTextLine[] {
  const candidates: LineCandidate[] = [];
  const orderedItems = [...items].sort(
    (left, right) =>
      left.pageBBox.y - right.pageBBox.y ||
      left.pageBBox.x - right.pageBBox.x ||
      left.rotation - right.rotation ||
      left.sourceOrder - right.sourceOrder ||
      compareCodePoint(left.id, right.id),
  );

  for (const item of orderedItems) {
    const matchingCandidate = candidates.find((candidate) =>
      canJoin(candidate, projectItem(item, candidate.projectionRotation)),
    );

    if (matchingCandidate) {
      matchingCandidate.items.push(
        projectItem(item, matchingCandidate.projectionRotation),
      );
    } else {
      const itemProjectionRotation = projectionRotation(item);
      candidates.push({
        rotation: item.rotation,
        projectionRotation: itemProjectionRotation,
        items: [projectItem(item, itemProjectionRotation)],
      });
    }
  }

  const lines = candidates.flatMap((candidate) => {
    const visuallyOrdered = [...candidate.items].sort(compareProjectedItems);
    return splitAtExplicitLineEnds(visuallyOrdered).map((lineItems) => {
      const text = joinText(lineItems);
      return {
        text,
        normalizedText: text,
        itemIds: lineItems.map(({ item }) => item.id),
        sourceOrders: lineItems.map(({ item }) => item.sourceOrder),
        pageBBox: unionPageBBox(lineItems),
        bbox: unionNormalizedBBox(lineItems),
        rotation: candidate.rotation,
      };
    });
  });

  return lines.sort(compareLines).map((line, index) => ({
    id: `line-${String(index + 1).padStart(6, "0")}`,
    ...line,
  }));
}
