export type Task98R2ObservedMember = Readonly<{
  originalItemIndex: number;
  geometricRole: unknown;
}>;

export type Task98R2ObservedScript = Readonly<{
  originalItemIndex: number;
  displacement: unknown;
}>;

export type Task98R2ObservedRun = Readonly<{
  members: readonly Task98R2ObservedMember[];
  scripts: readonly Task98R2ObservedScript[];
  projectedExtent: unknown;
  leadingBoundary: unknown;
  raw: Readonly<Record<string, unknown>>;
}>;

export type Task98R2ObservedLine = Readonly<{
  writingDirection: unknown;
  anchorBaseline: unknown;
  runs: readonly Task98R2ObservedRun[];
  raw: Readonly<Record<string, unknown>>;
}>;

export type Task98R2ObservedUnplaced = Readonly<{
  originalItemIndex: number;
  reason: unknown;
}>;

export type Task98R2ObservedPage = Readonly<{
  surfacePresent: boolean;
  pageNumber: number;
  lines: readonly Task98R2ObservedLine[];
  unplacedItems: readonly Task98R2ObservedUnplaced[];
  sourceAnomalies: readonly unknown[];
  raw: Readonly<Record<string, unknown>> | undefined;
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`R2_HARNESS_INVALID_${label}`);
  return value;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`R2_HARNESS_INVALID_${label}`);
  return value;
}

function requiredIndex(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`R2_HARNESS_INVALID_${label}`);
  }
  return value as number;
}

export function technicalPage(result: unknown, pageIndex = 0): UnknownRecord {
  const root = requiredRecord(result, "RESULT");
  const pages = requiredArray(root.pages, "PAGES");
  return requiredRecord(pages[pageIndex], `PAGE_${pageIndex}`);
}

export function technicalItems(
  result: unknown,
  pageIndex = 0,
): readonly UnknownRecord[] {
  return requiredArray(
    technicalPage(result, pageIndex).items,
    `ITEMS_${pageIndex}`,
  ).map((item, itemIndex) => requiredRecord(item, `ITEM_${itemIndex}`));
}

export function technicalAnomalies(
  result: unknown,
  pageIndex = 0,
): readonly unknown[] {
  return requiredArray(
    technicalPage(result, pageIndex).anomalies,
    `ANOMALIES_${pageIndex}`,
  );
}

function geometricPageRecord(page: UnknownRecord): UnknownRecord | undefined {
  if (Array.isArray(page.lines)) return page;
  return Object.values(page).find(
    (candidate): candidate is UnknownRecord =>
      isRecord(candidate) &&
      Array.isArray(candidate.lines) &&
      Array.isArray(candidate.unplacedItems) &&
      Array.isArray(candidate.sourceAnomalies),
  );
}

function observedMember(value: unknown, label: string): Task98R2ObservedMember {
  const member = requiredRecord(value, label);
  return Object.freeze({
    originalItemIndex: requiredIndex(
      member.originalItemIndex,
      `${label}_ORIGINAL_ITEM_INDEX`,
    ),
    geometricRole: member.geometricRole,
  });
}

function observedScript(value: unknown, label: string): Task98R2ObservedScript {
  const script = requiredRecord(value, label);
  return Object.freeze({
    originalItemIndex: requiredIndex(
      script.originalItemIndex,
      `${label}_ORIGINAL_ITEM_INDEX`,
    ),
    displacement: script.displacement,
  });
}

function observedRun(value: unknown, label: string): Task98R2ObservedRun {
  const run = requiredRecord(value, label);
  return Object.freeze({
    members: Object.freeze(
      requiredArray(run.members, `${label}_MEMBERS`).map((member, index) =>
        observedMember(member, `${label}_MEMBER_${index}`),
      ),
    ),
    scripts: Object.freeze(
      requiredArray(run.scripts, `${label}_SCRIPTS`).map((script, index) =>
        observedScript(script, `${label}_SCRIPT_${index}`),
      ),
    ),
    projectedExtent: run.projectedExtent,
    leadingBoundary: run.leadingBoundary,
    raw: run,
  });
}

function observedLine(value: unknown, label: string): Task98R2ObservedLine {
  const line = requiredRecord(value, label);
  return Object.freeze({
    writingDirection: line.writingDirection,
    anchorBaseline: line.anchorBaseline,
    runs: Object.freeze(
      requiredArray(line.runs, `${label}_RUNS`).map((run, index) =>
        observedRun(run, `${label}_RUN_${index}`),
      ),
    ),
    raw: line,
  });
}

function observedUnplaced(
  value: unknown,
  label: string,
): Task98R2ObservedUnplaced {
  const item = requiredRecord(value, label);
  return Object.freeze({
    originalItemIndex: requiredIndex(
      item.originalItemIndex,
      `${label}_ORIGINAL_ITEM_INDEX`,
    ),
    reason: item.reason,
  });
}

export function observeR2Page(
  result: unknown,
  pageIndex = 0,
): Task98R2ObservedPage {
  const sourcePage = technicalPage(result, pageIndex);
  const geometricPage = geometricPageRecord(sourcePage);
  if (geometricPage === undefined) {
    return Object.freeze({
      surfacePresent: false,
      pageNumber: requiredIndex(sourcePage.pageNumber, "SOURCE_PAGE_NUMBER"),
      lines: Object.freeze([]),
      unplacedItems: Object.freeze([]),
      sourceAnomalies: Object.freeze([]),
      raw: undefined,
    });
  }

  return Object.freeze({
    surfacePresent: true,
    pageNumber: requiredIndex(geometricPage.pageNumber, "R2_PAGE_NUMBER"),
    lines: Object.freeze(
      requiredArray(geometricPage.lines, "R2_LINES").map((line, index) =>
        observedLine(line, `R2_LINE_${index}`),
      ),
    ),
    unplacedItems: Object.freeze(
      requiredArray(geometricPage.unplacedItems, "R2_UNPLACED_ITEMS").map(
        (item, index) => observedUnplaced(item, `R2_UNPLACED_${index}`),
      ),
    ),
    sourceAnomalies: Object.freeze(
      requiredArray(geometricPage.sourceAnomalies, "R2_SOURCE_ANOMALIES"),
    ),
    raw: geometricPage,
  });
}

export function lineMemberIndices(
  line: Task98R2ObservedLine,
): readonly (readonly number[])[] {
  return line.runs.map((run) =>
    run.members.map((member) => member.originalItemIndex),
  );
}

export function primaryDispositionIndices(
  page: Task98R2ObservedPage,
): readonly number[] {
  return page.lines
    .flatMap((line) =>
      line.runs.flatMap((run) => [
        ...run.members.map((member) => member.originalItemIndex),
        ...run.scripts.map((script) => script.originalItemIndex),
      ]),
    )
    .concat(page.unplacedItems.map((item) => item.originalItemIndex));
}

export function deepKeys(
  value: unknown,
  keys = new Set<string>(),
): Set<string> {
  if (!isRecord(value) && !Array.isArray(value)) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    deepKeys(child, keys);
  }
  return keys;
}

export function withoutHasEOL(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutHasEOL);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "hasEOL")
      .map(([key, child]) => [key, withoutHasEOL(child)]),
  );
}
