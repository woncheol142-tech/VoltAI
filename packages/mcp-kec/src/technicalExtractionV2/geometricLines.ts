import type {
  KecV2ProvenanceTextItem,
  KecV2ProvenanceTextItemPage,
} from "./glyphProvenance.js";
import type { KecV2RawItemAnomaly } from "./rawTextItems.js";

export type KecV2GeometricRole = "CONTENT" | "BRIDGE";
export type KecV2BoundaryEvidence = "SEPARATED" | "UNCERTAIN_CONTINUITY";
export type KecV2UnplacedReason =
  "AMBIGUOUS_MEMBERSHIP" | "UNSUPPORTED_ORIENTATION" | "INVALID_GEOMETRY";

export interface KecV2RunMember {
  readonly originalItemIndex: number;
  readonly geometricRole: KecV2GeometricRole;
}

export interface KecV2ScriptAttachment {
  readonly originalItemIndex: number;
  readonly displacement: "SUPERSCRIPT" | "SUBSCRIPT";
}

export interface KecV2GeometricRun {
  readonly members: readonly KecV2RunMember[];
  readonly scripts: readonly KecV2ScriptAttachment[];
  readonly projectedExtent: Readonly<{
    startRaw: number;
    endRaw: number;
    startQuantized: number;
  }>;
  readonly leadingBoundary: KecV2BoundaryEvidence | undefined;
}

export interface KecV2GeometricLine {
  readonly writingDirection: string;
  readonly anchorBaseline: Readonly<{ raw: number; quantized: number }>;
  readonly runs: readonly KecV2GeometricRun[];
}

export interface KecV2UnplacedItem {
  readonly originalItemIndex: number;
  readonly reason: KecV2UnplacedReason;
}

export interface KecV2GeometricLinePage {
  readonly pageNumber: number;
  readonly lines: readonly KecV2GeometricLine[];
  readonly unplacedItems: readonly KecV2UnplacedItem[];
  readonly sourceAnomalies: readonly KecV2RawItemAnomaly[];
}

export interface KecV2GeometricTechnicalPage extends KecV2ProvenanceTextItemPage {
  readonly geometricLines: KecV2GeometricLinePage;
}

type GeometryProfile = Readonly<{
  version: string;
  baselineFloor: number;
  baselineScaleRatio: number;
  runJoinRatio: number;
  runSplitRatio: number;
  scriptScaleRatio: number;
  scriptDisplacementRatio: number;
  scriptHorizontalAdvance: number;
}>;

const GEOMETRY_PROFILE: GeometryProfile = Object.freeze({
  version: "kec:v2:r2:geometry-profile:v1",
  baselineFloor: 0.75,
  baselineScaleRatio: 0.2,
  runJoinRatio: 1,
  runSplitRatio: 3,
  scriptScaleRatio: 0.65,
  scriptDisplacementRatio: 0.65,
  scriptHorizontalAdvance: 4,
});

type ItemView = Readonly<{
  source: KecV2ProvenanceTextItem;
  baselineRaw: number;
  baselineQuantized: number;
  positionRaw: number;
  positionQuantized: number;
  extent: number;
  scale: number;
  role: KecV2GeometricRole;
}>;

type BaselineBand = {
  readonly anchor: ItemView;
  readonly members: ItemView[];
  minimumBaseline: number;
  maximumBaseline: number;
};

type RunDraft = {
  readonly band: BaselineBand;
  readonly members: ItemView[];
  readonly leadingBoundary: KecV2BoundaryEvidence | undefined;
  startRaw: number;
  endRaw: number;
  startQuantized: number;
  representativeScale: number;
};

type BandRuns = Readonly<{
  band: BaselineBand;
  runs: readonly RunDraft[];
}>;

function lowerMedian(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) / 2)];
}

function whitespaceOnly(value: string): boolean {
  return value.length === 0 || /^\s+$/u.test(value);
}

function isSupported(item: KecV2ProvenanceTextItem): boolean {
  const transform = item.rawGeometry.transform;
  return (
    transform[1] === 0 &&
    transform[3] > 0 &&
    Math.hypot(transform[2], transform[3]) > 0 &&
    item.rawGeometry.direction === "ltr"
  );
}

function itemView(item: KecV2ProvenanceTextItem): ItemView {
  const bridge = whitespaceOnly(item.rawText);
  const width = item.rawGeometry.width;
  const extent = !bridge && Number.isFinite(width) && width >= 0 ? width : 0;
  return Object.freeze({
    source: item,
    baselineRaw: item.rawGeometry.transform[5],
    baselineQuantized: item.quantizedGeometry.bbox.y,
    positionRaw: item.rawGeometry.transform[4],
    positionQuantized: item.quantizedGeometry.bbox.x,
    extent,
    scale: item.rawGeometry.transform[3],
    role: bridge ? "BRIDGE" : "CONTENT",
  });
}

function intrinsicAdvance(item: ItemView): number | undefined {
  if (item.role !== "CONTENT" || item.extent <= 0) return undefined;
  const codePointCount = Array.from(item.source.rawText).length;
  return codePointCount === 0 ? undefined : item.extent / codePointCount;
}

function compareForBands(left: ItemView, right: ItemView): number {
  return (
    right.baselineQuantized - left.baselineQuantized ||
    right.baselineRaw - left.baselineRaw ||
    left.source.originalItemIndex - right.source.originalItemIndex
  );
}

function compareForRuns(left: ItemView, right: ItemView): number {
  return (
    left.positionQuantized - right.positionQuantized ||
    left.positionRaw - right.positionRaw ||
    left.source.originalItemIndex - right.source.originalItemIndex
  );
}

function baselineTolerance(
  anchor: ItemView,
  item: ItemView,
  referenceScale: number | undefined,
  profile: GeometryProfile,
): number {
  const scale = Math.min(
    anchor.scale,
    item.scale,
    referenceScale ?? Math.min(anchor.scale, item.scale),
  );
  return Math.max(profile.baselineFloor, scale * profile.baselineScaleRatio);
}

function buildBands(
  items: readonly ItemView[],
  referenceScale: number | undefined,
  profile: GeometryProfile,
): readonly BaselineBand[] {
  const bands: BaselineBand[] = [];
  for (const item of [...items].sort(compareForBands)) {
    const current = bands.at(-1);
    if (current === undefined) {
      bands.push({
        anchor: item,
        members: [item],
        minimumBaseline: item.baselineRaw,
        maximumBaseline: item.baselineRaw,
      });
      continue;
    }

    const tolerance = baselineTolerance(
      current.anchor,
      item,
      referenceScale,
      profile,
    );
    const nextMinimum = Math.min(current.minimumBaseline, item.baselineRaw);
    const nextMaximum = Math.max(current.maximumBaseline, item.baselineRaw);
    if (
      Math.abs(item.baselineRaw - current.anchor.baselineRaw) <= tolerance &&
      nextMaximum - nextMinimum <= tolerance
    ) {
      current.members.push(item);
      current.minimumBaseline = nextMinimum;
      current.maximumBaseline = nextMaximum;
      continue;
    }

    bands.push({
      anchor: item,
      members: [item],
      minimumBaseline: item.baselineRaw,
      maximumBaseline: item.baselineRaw,
    });
  }
  return bands;
}

function projectedGap(previous: ItemView, current: ItemView): number {
  return current.positionRaw - (previous.positionRaw + previous.extent);
}

function updateExtent(run: RunDraft, item: ItemView): void {
  run.startRaw = Math.min(run.startRaw, item.positionRaw);
  run.endRaw = Math.max(run.endRaw, item.positionRaw + item.extent);
  run.startQuantized = Math.min(run.startQuantized, item.positionQuantized);
}

function runsForBand(
  band: BaselineBand,
  referenceAdvance: number | undefined,
  profile: GeometryProfile,
): readonly RunDraft[] {
  const ordered = [...band.members].sort(compareForRuns);
  const runs: RunDraft[] = [];
  const pendingBridges: ItemView[] = [];
  let previousContent: ItemView | undefined;
  for (const item of ordered) {
    if (item.role === "BRIDGE") {
      pendingBridges.push(item);
      continue;
    }

    const current = runs.at(-1);
    if (current === undefined) {
      runs.push({
        band,
        members: [...pendingBridges, item],
        leadingBoundary: undefined,
        startRaw: Math.min(
          item.positionRaw,
          ...pendingBridges.map((bridge) => bridge.positionRaw),
        ),
        endRaw: item.positionRaw + item.extent,
        startQuantized: Math.min(
          item.positionQuantized,
          ...pendingBridges.map((bridge) => bridge.positionQuantized),
        ),
        representativeScale: item.scale,
      });
      pendingBridges.length = 0;
      previousContent = item;
      continue;
    }

    const gap = projectedGap(previousContent!, item);
    if (
      gap <= 0 ||
      (referenceAdvance !== undefined &&
        gap / referenceAdvance <= profile.runJoinRatio)
    ) {
      for (const bridge of pendingBridges) {
        current.members.push(bridge);
        updateExtent(current, bridge);
      }
      current.members.push(item);
      updateExtent(current, item);
      pendingBridges.length = 0;
      previousContent = item;
      continue;
    }

    for (const bridge of pendingBridges) {
      current.members.push(bridge);
      updateExtent(current, bridge);
    }
    pendingBridges.length = 0;
    const leadingBoundary =
      referenceAdvance === undefined ||
      gap / referenceAdvance < profile.runSplitRatio
        ? "UNCERTAIN_CONTINUITY"
        : "SEPARATED";
    runs.push({
      band,
      members: [item],
      leadingBoundary,
      startRaw: item.positionRaw,
      endRaw: item.positionRaw + item.extent,
      startQuantized: item.positionQuantized,
      representativeScale: item.scale,
    });
    previousContent = item;
  }

  if (pendingBridges.length > 0) {
    const current = runs.at(-1);
    if (current === undefined) {
      runs.push({
        band,
        members: [...pendingBridges],
        leadingBoundary: undefined,
        startRaw: Math.min(...pendingBridges.map((item) => item.positionRaw)),
        endRaw: Math.max(...pendingBridges.map((item) => item.positionRaw)),
        startQuantized: Math.min(
          ...pendingBridges.map((item) => item.positionQuantized),
        ),
        representativeScale: lowerMedian(
          pendingBridges.map((item) => item.scale),
        )!,
      });
    } else {
      for (const bridge of pendingBridges) {
        current.members.push(bridge);
        updateExtent(current, bridge);
      }
    }
  }
  for (const run of runs) {
    run.representativeScale = lowerMedian(
      run.members.map((item) => item.scale),
    )!;
  }
  return runs;
}

function insertionIndex(runs: readonly RunDraft[], position: number): number {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (runs[middle]!.startRaw < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearbyRuns(
  runs: readonly RunDraft[],
  position: number,
): readonly RunDraft[] {
  const insertion = insertionIndex(runs, position);
  const result: RunDraft[] = [];
  if (insertion > 0) result.push(runs[insertion - 1]!);
  if (insertion < runs.length) result.push(runs[insertion]!);
  return result;
}

function horizontalDistance(item: ItemView, run: RunDraft): number {
  if (item.positionRaw < run.startRaw) return run.startRaw - item.positionRaw;
  if (item.positionRaw > run.endRaw) return item.positionRaw - run.endRaw;
  return 0;
}

function qualifiesAsScript(
  item: ItemView,
  run: RunDraft,
  referenceAdvance: number | undefined,
  profile: GeometryProfile,
): boolean {
  if (referenceAdvance === undefined) return false;
  const parentScale = run.representativeScale;
  const verticalDistance = Math.abs(
    item.baselineRaw - run.band.anchor.baselineRaw,
  );
  return (
    item.scale <= parentScale * profile.scriptScaleRatio &&
    verticalDistance >
      baselineTolerance(run.band.anchor, item, parentScale, profile) &&
    verticalDistance <= parentScale * profile.scriptDisplacementRatio &&
    horizontalDistance(item, run) <=
      referenceAdvance * profile.scriptHorizontalAdvance
  );
}

function possibleParentRuns(
  item: ItemView,
  bandIndex: number,
  allRuns: readonly BandRuns[],
  referenceAdvance: number | undefined,
  profile: GeometryProfile,
): readonly RunDraft[] {
  const adjacent = [bandIndex - 1, bandIndex + 1]
    .filter((index) => index >= 0 && index < allRuns.length)
    .flatMap((index) => nearbyRuns(allRuns[index]!.runs, item.positionRaw));
  return adjacent.filter((run) =>
    qualifiesAsScript(item, run, referenceAdvance, profile),
  );
}

function frozenMember(item: ItemView): KecV2RunMember {
  return Object.freeze({
    originalItemIndex: item.source.originalItemIndex,
    geometricRole: item.role,
  });
}

function frozenAttachment(
  item: ItemView,
  run: RunDraft,
): KecV2ScriptAttachment {
  return Object.freeze({
    originalItemIndex: item.source.originalItemIndex,
    displacement:
      item.baselineRaw > run.band.anchor.baselineRaw
        ? "SUPERSCRIPT"
        : "SUBSCRIPT",
  });
}

function freezeRun(
  run: RunDraft,
  retained: readonly ItemView[],
  scripts: readonly KecV2ScriptAttachment[],
): KecV2GeometricRun {
  let startRaw = Number.POSITIVE_INFINITY;
  let endRaw = Number.NEGATIVE_INFINITY;
  let startQuantized = Number.POSITIVE_INFINITY;
  for (const item of retained) {
    startRaw = Math.min(startRaw, item.positionRaw);
    endRaw = Math.max(endRaw, item.positionRaw + item.extent);
    startQuantized = Math.min(startQuantized, item.positionQuantized);
  }
  return Object.freeze({
    members: Object.freeze(retained.map(frozenMember)),
    scripts: Object.freeze(
      [...scripts].sort(
        (left, right) => left.originalItemIndex - right.originalItemIndex,
      ),
    ),
    projectedExtent: Object.freeze({ startRaw, endRaw, startQuantized }),
    leadingBoundary: run.leadingBoundary,
  });
}

export function buildKecV2GeometricLinePage(
  page: KecV2ProvenanceTextItemPage,
): KecV2GeometricLinePage {
  const supported: ItemView[] = [];
  const unplaced: KecV2UnplacedItem[] = [];
  for (const item of page.items) {
    if (!isSupported(item)) {
      unplaced.push(
        Object.freeze({
          originalItemIndex: item.originalItemIndex,
          reason: "UNSUPPORTED_ORIENTATION" as const,
        }),
      );
      continue;
    }
    supported.push(itemView(item));
  }

  const referenceScale = lowerMedian(supported.map((item) => item.scale));
  const referenceAdvance = lowerMedian(
    supported.flatMap((item) => {
      const advance = intrinsicAdvance(item);
      return advance === undefined ? [] : [advance];
    }),
  );
  const bands = buildBands(supported, referenceScale, GEOMETRY_PROFILE);
  const allRuns: readonly BandRuns[] = bands.map((band) =>
    Object.freeze({
      band,
      runs: runsForBand(band, referenceAdvance, GEOMETRY_PROFILE),
    }),
  );

  const removed = new Set<number>();
  const attached = new Map<RunDraft, KecV2ScriptAttachment[]>();
  allRuns.forEach(({ band }, bandIndex) => {
    for (const item of band.members) {
      const parents = possibleParentRuns(
        item,
        bandIndex,
        allRuns,
        referenceAdvance,
        GEOMETRY_PROFILE,
      );
      if (parents.length === 0) continue;
      removed.add(item.source.originalItemIndex);
      if (parents.length > 1) {
        unplaced.push(
          Object.freeze({
            originalItemIndex: item.source.originalItemIndex,
            reason: "AMBIGUOUS_MEMBERSHIP" as const,
          }),
        );
        continue;
      }
      const parent = parents[0]!;
      const scripts = attached.get(parent) ?? [];
      scripts.push(frozenAttachment(item, parent));
      attached.set(parent, scripts);
    }
  });

  const lines: KecV2GeometricLine[] = [];
  for (const { band, runs } of allRuns) {
    const frozenRuns = runs.flatMap((run) => {
      const retained = run.members.filter(
        (item) => !removed.has(item.source.originalItemIndex),
      );
      const scripts = attached.get(run) ?? [];
      if (retained.length === 0) {
        for (const script of scripts) {
          unplaced.push(
            Object.freeze({
              originalItemIndex: script.originalItemIndex,
              reason: "AMBIGUOUS_MEMBERSHIP" as const,
            }),
          );
        }
        return [];
      }
      return [freezeRun(run, retained, scripts)];
    });
    if (frozenRuns.length === 0) continue;
    lines.push(
      Object.freeze({
        writingDirection: band.anchor.source.rawGeometry.direction,
        anchorBaseline: Object.freeze({
          raw: band.anchor.baselineRaw,
          quantized: band.anchor.baselineQuantized,
        }),
        runs: Object.freeze(frozenRuns),
      }),
    );
  }

  unplaced.sort(
    (left, right) => left.originalItemIndex - right.originalItemIndex,
  );
  return Object.freeze({
    pageNumber: page.pageNumber,
    lines: Object.freeze(lines),
    unplacedItems: Object.freeze(unplaced),
    sourceAnomalies: page.anomalies,
  });
}

export function attachKecV2GeometricLines(
  page: KecV2ProvenanceTextItemPage,
): KecV2GeometricTechnicalPage {
  return Object.freeze({
    pageNumber: page.pageNumber,
    items: page.items,
    anomalies: page.anomalies,
    geometricLines: buildKecV2GeometricLinePage(page),
  });
}
