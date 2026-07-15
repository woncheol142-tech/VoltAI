import type {
  DrawingCategory,
  DrawingIndexRecord,
  DrawingIndexWarning,
  DrawingListParseResult,
  DrawingListTextItem,
  DrawingListTextPage,
} from "./types.js";

const drawingNumberPattern = /^[A-Z]{1,4}-\d{2,4}[A-Z]?$/u;
const drawingPrefixPattern = /^[A-Z]{1,4}-$/u;
const drawingSuffixPattern = /^\d{2,4}[A-Z]?$/u;
const scalePattern = /^\d+\s*\/\s*\d+$/u;
const rowTolerance = 6;
const exactRowTolerance = 0.75;
const minimumConfidence = 0.75;

type HeaderKind = "drawingNo" | "title" | "scaleA1" | "scaleA3";

type NormalizedItem = {
  text: string;
  compactText: string;
  x: number;
  y: number;
  width: number;
};

type HeaderAnchor = Record<HeaderKind, NormalizedItem> & {
  index: number;
  lowerBound: number;
  upperBound: number;
};

type ItemGroup = {
  x: number;
  items: NormalizedItem[];
};

type NumberCandidate = {
  x: number;
  drawingNo: string | null;
  ambiguous: boolean;
};

type ParsedRecord = {
  record: DrawingIndexRecord;
  page: number;
  block: number;
  row: number;
};

type CategoryMatch = {
  category: DrawingCategory;
  matched: DrawingCategory[];
};

const categoryRules: ReadonlyArray<{
  category: Exclude<DrawingCategory, "기타">;
  pattern: RegExp;
}> = [
  { category: "도면목록", pattern: /도면\s*목록/u },
  { category: "MCC", pattern: /MCC/iu },
  { category: "보안등", pattern: /보안등/u },
  { category: "조경등", pattern: /조경등/u },
  { category: "태양광", pattern: /태양광/u },
  { category: "피뢰", pattern: /피뢰/u },
  { category: "접지", pattern: /접지/u },
  { category: "수변전", pattern: /수변전/u },
  { category: "분전반", pattern: /분전반/u },
  { category: "전력간선", pattern: /전력\s*간선/u },
  { category: "전등", pattern: /전등/u },
  { category: "전열", pattern: /전열/u },
  { category: "동력", pattern: /동력/u },
  { category: "소방", pattern: /소방/u },
  { category: "기계", pattern: /기계/u },
];

export function normalizeDrawingText(text: string): string {
  return text.normalize("NFKC").replaceAll("\u0000", " ").replace(/\s+/gu, " ").trim();
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compact(text: string): string {
  return text.replace(/\s+/gu, "");
}

function normalizeItem(item: DrawingListTextItem): NormalizedItem | null {
  const text = normalizeDrawingText(item.str);

  if (text.length === 0) {
    return null;
  }

  return {
    text,
    compactText: compact(text),
    x: item.transform[4],
    y: item.transform[5],
    width: item.width,
  };
}

function deduplicateItems(items: DrawingListTextItem[]): NormalizedItem[] {
  const unique = new Map<string, NormalizedItem>();

  for (const rawItem of items) {
    const item = normalizeItem(rawItem);
    if (!item) {
      continue;
    }

    const key = [item.text, item.x, item.y, item.width].join("\u0001");
    unique.set(key, item);
  }

  return [...unique.values()];
}

function isHeader(item: NormalizedItem, kind: HeaderKind): boolean {
  switch (kind) {
    case "drawingNo":
      return item.compactText === "도면번호";
    case "title":
      return item.compactText === "도면명";
    case "scaleA1":
      return item.compactText.toUpperCase() === "A1";
    case "scaleA3":
      return item.compactText.toUpperCase() === "A3";
  }
}

function findHeaderAnchors(items: NormalizedItem[]): HeaderAnchor[] {
  const byKind = (kind: HeaderKind) =>
    items.filter((item) => isHeader(item, kind)).sort((left, right) => right.y - left.y);
  const drawingNo = byKind("drawingNo");
  const title = byKind("title");
  const scaleA1 = byKind("scaleA1");
  const scaleA3 = byKind("scaleA3");
  const blockCount = Math.min(
    drawingNo.length,
    title.length,
    scaleA1.length,
    scaleA3.length,
  );
  const partial = Array.from({ length: blockCount }, (_, index) => ({
    index,
    drawingNo: drawingNo[index],
    title: title[index],
    scaleA1: scaleA1[index],
    scaleA3: scaleA3[index],
  }));

  return partial.map((anchor, index) => ({
    ...anchor,
    upperBound:
      index === 0
        ? Number.POSITIVE_INFINITY
        : (partial[index - 1].scaleA3.y + anchor.drawingNo.y) / 2,
    lowerBound:
      index === partial.length - 1
        ? anchor.scaleA3.y - 100
        : (anchor.scaleA3.y + partial[index + 1].drawingNo.y) / 2,
  }));
}

function groupByRow(items: NormalizedItem[], tolerance = exactRowTolerance): ItemGroup[] {
  const groups: ItemGroup[] = [];

  for (const item of [...items].sort((left, right) => right.x - left.x || right.y - left.y)) {
    const existing = groups.find((group) => Math.abs(group.x - item.x) <= tolerance);

    if (existing) {
      existing.items.push(item);
      existing.x =
        existing.items.reduce((total, candidate) => total + candidate.x, 0) /
        existing.items.length;
    } else {
      groups.push({ x: item.x, items: [item] });
    }
  }

  return groups.sort((left, right) => right.x - left.x);
}

function isScaleToken(item: NormalizedItem): boolean {
  return item.compactText.toUpperCase() === "NONE" || scalePattern.test(item.compactText);
}

function normalizeScale(item: NormalizedItem | undefined): string | null {
  if (!item || item.compactText.toUpperCase() === "NONE") {
    return null;
  }

  return item.compactText;
}

function isDrawingToken(item: NormalizedItem): boolean {
  const token = item.compactText.toUpperCase();
  return (
    drawingNumberPattern.test(token) ||
    drawingPrefixPattern.test(token) ||
    drawingSuffixPattern.test(token)
  );
}

function createNumberCandidates(
  items: NormalizedItem[],
  anchor: HeaderAnchor,
): NumberCandidate[] {
  const numberItems = items.filter(
    (item) =>
      Math.abs(item.y - anchor.drawingNo.y) <= 25 &&
      item.x < anchor.drawingNo.x - 8 &&
      isDrawingToken(item),
  );

  return groupByRow(numberItems).map((group) => {
    const tokens = [...new Set(group.items.map((item) => item.compactText.toUpperCase()))];
    const full = tokens.filter((token) => drawingNumberPattern.test(token));
    const prefixes = tokens.filter((token) => drawingPrefixPattern.test(token));
    const suffixes = tokens.filter((token) => drawingSuffixPattern.test(token));

    if (full.length === 1 && prefixes.length === 0 && suffixes.length === 0) {
      return { x: group.x, drawingNo: full[0], ambiguous: false };
    }

    if (full.length === 0 && prefixes.length === 1 && suffixes.length === 1) {
      const drawingNo = `${prefixes[0]}${suffixes[0]}`;
      return {
        x: group.x,
        drawingNo: drawingNumberPattern.test(drawingNo) ? drawingNo : null,
        ambiguous: false,
      };
    }

    return { x: group.x, drawingNo: null, ambiguous: true };
  });
}

function findClosestGroup(groups: ItemGroup[], x: number): ItemGroup[] {
  const supported = groups
    .map((group) => ({ group, distance: Math.abs(group.x - x) }))
    .filter((candidate) => candidate.distance <= rowTolerance)
    .sort((left, right) => left.distance - right.distance || right.group.x - left.group.x);

  if (supported.length === 0) {
    return [];
  }

  const closestDistance = supported[0].distance;
  return supported
    .filter((candidate) => Math.abs(candidate.distance - closestDistance) <= 0.001)
    .map((candidate) => candidate.group);
}

function createTitleGroups(items: NormalizedItem[], anchor: HeaderAnchor): ItemGroup[] {
  const titleItems = items.filter((item) => {
    if (item.x >= anchor.drawingNo.x - 8) {
      return false;
    }
    if (item.y > anchor.drawingNo.y - 8 || item.y < anchor.lowerBound) {
      return false;
    }
    if (isDrawingToken(item) || isScaleToken(item)) {
      return false;
    }
    return !(["drawingNo", "title", "scaleA1", "scaleA3"] as const).some((kind) =>
      isHeader(item, kind),
    );
  });

  return groupByRow(titleItems).map((group) => ({
    ...group,
    items: group.items.sort(
      (left, right) => right.y - left.y || compareCodePoints(left.text, right.text),
    ),
  }));
}

function findScale(
  items: NormalizedItem[],
  anchor: HeaderAnchor,
  x: number,
  kind: "scaleA1" | "scaleA3",
): NormalizedItem | undefined {
  const header = anchor[kind];
  return items
    .filter(
      (item) =>
        isScaleToken(item) &&
        Math.abs(item.x - x) <= rowTolerance &&
        Math.abs(item.y - header.y) <= 15,
    )
    .sort(
      (left, right) =>
        Math.abs(left.x - x) - Math.abs(right.x - x) ||
        Math.abs(left.y - header.y) - Math.abs(right.y - header.y),
    )[0];
}

function classifyTitle(title: string): CategoryMatch {
  const matched = categoryRules
    .filter((rule) => rule.pattern.test(title))
    .map((rule) => rule.category);

  return {
    category: matched[0] ?? "기타",
    matched,
  };
}

function extractFloor(title: string): string | null {
  const patterns = [
    /지하\d+층/u,
    /기준\([^)]*\)층/u,
    /기준층/u,
    /옥탑지붕층/u,
    /옥탑층/u,
    /지붕층/u,
    /PIT층/iu,
    /\d+층/u,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function formatWarning(warning: DrawingIndexWarning): string {
  if (warning.row === 0) {
    return `[page ${warning.page}] ${warning.message}`;
  }

  return `[page ${warning.page} block ${warning.block + 1} row ${warning.row}] ${warning.message}`;
}

function sortWarnings(warnings: DrawingIndexWarning[]): DrawingIndexWarning[] {
  return [...warnings].sort(
    (left, right) =>
      left.page - right.page ||
      left.block - right.block ||
      left.row - right.row ||
      compareCodePoints(left.message, right.message),
  );
}

function parseBlock(
  page: number,
  anchor: HeaderAnchor,
  allItems: NormalizedItem[],
): { records: ParsedRecord[]; warnings: DrawingIndexWarning[] } {
  const items = allItems.filter(
    (item) => item.y <= anchor.upperBound && item.y >= anchor.lowerBound,
  );
  const numbers = createNumberCandidates(items, anchor);
  const titleGroups = createTitleGroups(items, anchor);
  const usedTitles = new Set<ItemGroup>();
  const warnings: DrawingIndexWarning[] = [];
  const records: ParsedRecord[] = [];

  for (const [rowIndex, number] of numbers.entries()) {
    const row = rowIndex + 1;
    if (number.ambiguous || !number.drawingNo) {
      warnings.push({
        page,
        block: anchor.index,
        row,
        message: "ambiguous drawing number row was omitted",
      });
      continue;
    }

    const closestTitles = findClosestGroup(titleGroups, number.x);
    if (closestTitles.length !== 1) {
      warnings.push({
        page,
        block: anchor.index,
        row,
        message:
          closestTitles.length === 0
            ? `title is missing for drawing ${number.drawingNo}`
            : `ambiguous title row for drawing ${number.drawingNo} was omitted`,
      });
      continue;
    }

    const titleGroup = closestTitles[0];
    usedTitles.add(titleGroup);
    const title = normalizeDrawingText(titleGroup.items.map((item) => item.text).join(" "));
    if (title.length === 0) {
      warnings.push({
        page,
        block: anchor.index,
        row,
        message: `title is missing for drawing ${number.drawingNo}`,
      });
      continue;
    }

    const scaleA1Item = findScale(items, anchor, number.x, "scaleA1");
    const scaleA3Item = findScale(items, anchor, number.x, "scaleA3");
    const scaleA1 = normalizeScale(scaleA1Item);
    const scaleA3 = normalizeScale(scaleA3Item);
    const complex = title.match(/\d+단지/u)?.[0] ?? null;
    const building = title.match(/\d{3}동/u)?.[0] ?? null;
    const floor = extractFloor(title);
    const categoryMatch = classifyTitle(title);
    let confidence = 0.8;
    confidence += scaleA1Item ? 0.075 : 0;
    confidence += scaleA3Item ? 0.075 : 0;
    confidence +=
      complex || building || floor || categoryMatch.category !== "기타" ? 0.05 : 0;

    if (categoryMatch.matched.length > 1) {
      confidence -= 0.1;
      warnings.push({
        page,
        block: anchor.index,
        row,
        message: `category conflict for ${number.drawingNo}: ${categoryMatch.matched.join(", ")}`,
      });
    }

    confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));
    if (confidence < minimumConfidence) {
      warnings.push({
        page,
        block: anchor.index,
        row,
        message: `low-confidence drawing ${number.drawingNo} was omitted`,
      });
      continue;
    }

    const record: DrawingIndexRecord = {
      drawingNo: number.drawingNo,
      title,
      category: categoryMatch.category,
      complex,
      building,
      floor,
      scaleA1,
      scaleA3,
      sourceListPage: page,
      confidence,
      rawText: `${number.drawingNo} | ${title} | A1:${scaleA1 ?? "NONE"} | A3:${scaleA3 ?? "NONE"}`,
    };
    records.push({ record, page, block: anchor.index, row });
  }

  const orphanTitles = titleGroups.filter(
    (group) =>
      !usedTitles.has(group) &&
      !numbers.some((number) => Math.abs(number.x - group.x) <= rowTolerance),
  );
  for (const [orphanIndex, orphanTitle] of orphanTitles.entries()) {
    const title = normalizeDrawingText(orphanTitle.items.map((item) => item.text).join(" "));
    warnings.push({
      page,
      block: anchor.index,
      row: numbers.length + orphanIndex + 1,
      message: `drawing number is missing for orphan title: ${title}`,
    });
  }

  return { records, warnings };
}

export function parseDrawingListPages(pages: DrawingListTextPage[]): DrawingListParseResult {
  const records: ParsedRecord[] = [];
  const warnings: DrawingIndexWarning[] = [];
  let detectedPageCount = 0;

  for (const page of [...pages].sort((left, right) => left.page - right.page)) {
    const items = deduplicateItems(page.items);
    const anchors = findHeaderAnchors(items);

    if (anchors.length === 0) {
      warnings.push({
        page: page.page,
        block: 0,
        row: 0,
        message: "drawing list table was not detected on this page",
      });
      continue;
    }

    detectedPageCount += 1;
    for (const anchor of anchors) {
      const parsed = parseBlock(page.page, anchor, items);
      records.push(...parsed.records);
      warnings.push(...parsed.warnings);
    }
  }

  if (detectedPageCount === 0) {
    throw new Error("No drawing list table was detected in the requested page range");
  }

  records.sort(
    (left, right) =>
      left.page - right.page ||
      left.block - right.block ||
      left.row - right.row ||
      compareCodePoints(left.record.drawingNo, right.record.drawingNo),
  );

  const byDrawingNumber = new Map<string, ParsedRecord[]>();
  for (const record of records) {
    const duplicates = byDrawingNumber.get(record.record.drawingNo) ?? [];
    duplicates.push(record);
    byDrawingNumber.set(record.record.drawingNo, duplicates);
  }
  for (const [drawingNo, duplicates] of byDrawingNumber) {
    if (duplicates.length < 2) {
      continue;
    }
    const duplicate = duplicates[1];
    warnings.push({
      page: duplicate.page,
      block: duplicate.block,
      row: duplicate.row,
      message: `duplicate drawing number ${drawingNo}`,
    });
  }

  return {
    drawings: records.map((record) => record.record),
    warnings: sortWarnings(warnings).map(formatWarning),
  };
}
