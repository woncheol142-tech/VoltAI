import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  AnchorLocatorSpace,
  ExtractionContractId,
  ExtractionLineage,
} from "@voltai/extraction-core";
import type { Requirement } from "@voltai/knowledge-core";
import type {
  ExternalSourceLocator,
  SourceBlobHash,
  SourceRevision,
} from "@voltai/source-core";

import { assertProjectRoot, resolveKecPdfPath } from "./projectPath.js";
import type {
  KecCapturedRequirementSnapshot,
  KecContextSearchTermination,
  KecSourceCaptureDetector,
  KecSourceCaptureFragment,
  KecSourceCaptureObservation,
  KecSuppressedAssemblyObservation,
} from "./sourceCapture.js";
import {
  compareKecSourceCaptureObservations,
  KEC_SOURCE_CAPTURE_CONTRACT_ID,
  normalizeKecSourceText,
} from "./sourceCapture.js";

export { extractKecV2Technical } from "../technicalExtractionV2/technicalExtraction.js";
export type {
  ExtractKecV2TechnicalInput,
  KecTechnicalFailureCode,
  KecV2TechnicalExtractionResult,
} from "../technicalExtractionV2/technicalExtraction.js";

declare const kecRequirementIdBrand: unique symbol;

export type KecRequirementId = string & {
  readonly [kecRequirementIdBrand]: true;
};

export type ExtractKecRequirementsInput = {
  readonly projectRoot: string;
  readonly sourceLocator: ExternalSourceLocator;
  readonly sourceRevision: SourceRevision;
};

type KecPdfTextItem = {
  readonly str: string;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly hasEOL: boolean;
};

type KecPdfTextPage = {
  readonly pageNumber: number;
  readonly items: readonly KecPdfTextItem[];
};

export type KecRequirementLocator = {
  readonly pageNumber: number;
  readonly startItemIndex: number;
  readonly endItemIndexExclusive: number;
};

export type KecRequirementExtraction = {
  readonly requirement: Requirement<KecRequirementId, string>;
  readonly provenance: {
    readonly sourceRevision: SourceRevision;
    readonly lineage: ExtractionLineage;
    readonly locatorSpace: AnchorLocatorSpace;
    readonly locators: readonly [
      KecRequirementLocator,
      ...KecRequirementLocator[],
    ];
  };
};

export type KecRequirementExtractionBinding = {
  readonly sourceRevision: SourceRevision;
  readonly blobHash: SourceBlobHash;
  readonly extractionContract: ExtractionContractId;
  readonly locatorSpace: AnchorLocatorSpace;
};

export type KecRequirementExtractionSnapshot = {
  readonly binding: KecRequirementExtractionBinding;
  readonly requirements: readonly KecRequirementExtraction[];
};

// This ID names the parser, grouping, normative-detection, normalization, and
// locator behaviour below. Future behavioural changes require a deliberate ID
// bump; that process is intentionally not enforced by a registry in Task90.
export const KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID =
  "kec:pdfjs-structural-normative-paragraphs:v1" as ExtractionContractId;

export const KEC_REQUIREMENT_LOCATOR_SPACE =
  "kec:pdf-text-item-span:v1" as AnchorLocatorSpace;

type OrderedTextItem = {
  readonly item: KecPdfTextItem;
  readonly orderedIndex: number;
  readonly x: number;
  readonly y: number;
};

type TextLine = {
  readonly items: readonly OrderedTextItem[];
  readonly y: number;
  readonly height: number;
  readonly startItemIndex: number;
  readonly endItemIndexExclusive: number;
};

type TextParagraph = {
  readonly lines: readonly TextLine[];
  readonly locator: KecRequirementLocator;
  readonly structuralRegion: number;
  readonly statement: string;
};

type PdfJsDocument = {
  readonly numPages: number;
  readonly getPage: (pageNumber: number) => Promise<{
    readonly getTextContent: () => Promise<{
      readonly items: readonly unknown[];
    }>;
  }>;
  readonly cleanup: () => Promise<void>;
};

type PdfJsLoadingTask = {
  readonly promise: Promise<PdfJsDocument>;
  readonly destroy: () => Promise<void>;
};

type PdfJsModule = {
  readonly getDocument: (options: {
    readonly data: Uint8Array;
    readonly disableFontFace: boolean;
    readonly useSystemFonts: boolean;
  }) => PdfJsLoadingTask;
};

async function loadPdfJs(): Promise<PdfJsModule> {
  return import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJsModule>;
}

function isPdfTextItem(item: unknown): item is {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly hasEOL: boolean;
} {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    item.transform.length === 6 &&
    item.transform.every((value) => typeof value === "number") &&
    "width" in item &&
    typeof item.width === "number" &&
    "height" in item &&
    typeof item.height === "number" &&
    "hasEOL" in item &&
    typeof item.hasEOL === "boolean"
  );
}

async function readKecPdfBytes(absolutePdfPath: string): Promise<Uint8Array> {
  const fileBytes = await readFile(absolutePdfPath);
  return new Uint8Array(fileBytes);
}

async function parseKecPdfTextItems(
  bytes: Uint8Array,
): Promise<readonly KecPdfTextPage[]> {
  const { getDocument } = await loadPdfJs();
  const loadingTask = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: KecPdfTextPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item): KecPdfTextItem[] => {
        if (!isPdfTextItem(item)) return [];

        return [
          {
            str: item.str,
            transform: [
              item.transform[0]!,
              item.transform[1]!,
              item.transform[2]!,
              item.transform[3]!,
              item.transform[4]!,
              item.transform[5]!,
            ],
            width: item.width,
            height: item.height,
            hasEOL: item.hasEOL,
          },
        ];
      });

      pages.push({ pageNumber, items });
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }

  return pages;
}

function orderTextItems(items: readonly KecPdfTextItem[]): OrderedTextItem[] {
  const positioned = items.map((item, sourceIndex) => ({
    item,
    sourceIndex,
    x: item.transform[4],
    y: item.transform[5],
  }));

  positioned.sort((left, right) => {
    const verticalDifference = right.y - left.y;
    if (Math.abs(verticalDifference) > 2) return verticalDifference;

    const horizontalDifference = left.x - right.x;
    if (horizontalDifference !== 0) return horizontalDifference;
    return left.sourceIndex - right.sourceIndex;
  });

  return positioned.map(({ item, x, y }, orderedIndex) => ({
    item,
    orderedIndex,
    x,
    y,
  }));
}

function groupTextLines(items: readonly OrderedTextItem[]): TextLine[] {
  const lines: Array<{ items: OrderedTextItem[]; y: number; height: number }> =
    [];

  for (const positioned of items) {
    const current = lines.at(-1);
    const tolerance = Math.max(2, positioned.item.height * 0.2);

    if (!current || Math.abs(current.y - positioned.y) > tolerance) {
      lines.push({
        items: [positioned],
        y: positioned.y,
        height: positioned.item.height,
      });
      continue;
    }

    current.items.push(positioned);
    current.height = Math.max(current.height, positioned.item.height);
  }

  return lines.map((line) => ({
    items: line.items,
    y: line.y,
    height: line.height,
    startItemIndex: Math.min(...line.items.map((item) => item.orderedIndex)),
    endItemIndexExclusive:
      Math.max(...line.items.map((item) => item.orderedIndex)) + 1,
  }));
}

function hasSeparatedColumns(line: TextLine): boolean {
  const meaningfulItems = line.items.filter(
    ({ item }) => normalizeKecSourceText(item.str).length > 0,
  );

  for (let index = 1; index < meaningfulItems.length; index += 1) {
    const previous = meaningfulItems[index - 1]!;
    const current = meaningfulItems[index]!;
    const previousRight = previous.x + Math.max(previous.item.width, 0);

    if (current.x - previousRight >= 72) return true;
  }

  return false;
}

function tableLineIndexes(lines: readonly TextLine[]): ReadonlySet<number> {
  const indexes = new Set<number>();
  let start = 0;

  while (start < lines.length) {
    if (!hasSeparatedColumns(lines[start]!)) {
      start += 1;
      continue;
    }

    let end = start + 1;
    while (
      end < lines.length &&
      hasSeparatedColumns(lines[end]!) &&
      lines[end - 1]!.y - lines[end]!.y >= 8 &&
      lines[end - 1]!.y - lines[end]!.y <= 36
    ) {
      end += 1;
    }

    if (end - start >= 2) {
      for (let index = start; index < end; index += 1) indexes.add(index);
    }
    start = end;
  }

  return indexes;
}

function lineText(line: TextLine): string {
  return normalizeKecSourceText(
    line.items.map(({ item }) => item.str).join(" "),
  );
}

function paragraphFromLines(
  pageNumber: number,
  lines: readonly TextLine[],
  structuralRegion: number,
): TextParagraph {
  const startItemIndex = Math.min(...lines.map((line) => line.startItemIndex));
  const endItemIndexExclusive = Math.max(
    ...lines.map((line) => line.endItemIndexExclusive),
  );

  return {
    lines,
    locator: { pageNumber, startItemIndex, endItemIndexExclusive },
    structuralRegion,
    statement: normalizeKecSourceText(lines.map(lineText).join(" ")),
  };
}

type GroupedPage = {
  readonly paragraphs: readonly TextParagraph[];
  readonly excludedObservations: readonly KecSourceCaptureObservation[];
};

function groupParagraphs(page: KecPdfTextPage): GroupedPage {
  const lines = groupTextLines(orderTextItems(page.items));
  const excluded = tableLineIndexes(lines);
  const groups: TextLine[][] = [];
  const groupRegions: number[] = [];
  const excludedObservations: KecSourceCaptureObservation[] = [];
  let current: TextLine[] | undefined;
  let excludedLines: TextLine[] = [];
  let structuralRegion = 0;
  let insideExcludedRegion = false;

  const finishExcludedStretch = (): void => {
    if (excludedLines.length === 0) return;
    excludedObservations.push({
      kind: "column-gap-region-excluded",
      span: {
        pageNumber: page.pageNumber,
        startItemIndex: Math.min(
          ...excludedLines.map(({ startItemIndex }) => startItemIndex),
        ),
        endItemIndexExclusive: Math.max(
          ...excludedLines.map(
            ({ endItemIndexExclusive }) => endItemIndexExclusive,
          ),
        ),
      },
      observedText: normalizeKecSourceText(
        excludedLines.map(lineText).join(" "),
      ),
    });
    excludedLines = [];
  };

  for (const [lineIndex, line] of lines.entries()) {
    if (excluded.has(lineIndex)) {
      if (!insideExcludedRegion) structuralRegion += 1;
      insideExcludedRegion = true;
      excludedLines.push(line);
      current = undefined;
      continue;
    }
    finishExcludedStretch();
    insideExcludedRegion = false;

    const previous = current?.at(-1);
    const paragraphGap = previous
      ? Math.max(previous.height, line.height) * 1.5
      : 0;

    if (!current || !previous || previous.y - line.y > paragraphGap) {
      current = [line];
      groups.push(current);
      groupRegions.push(structuralRegion);
      continue;
    }

    current.push(line);
  }
  finishExcludedStretch();

  return {
    paragraphs: groups.map((linesInParagraph, index) =>
      paragraphFromLines(
        page.pageNumber,
        linesInParagraph,
        groupRegions[index]!,
      ),
    ),
    excludedObservations,
  };
}

function isNormativeStatement(statement: string): boolean {
  return /(?:하여야\s*한다|할\s*수\s*있다|하여서는\s*아니\s*된다|권장한다|이하이어야\s*한다)[.!?。]?$/u.test(
    statement,
  );
}

function paragraphGap(
  context: TextParagraph,
  normative: TextParagraph,
): number {
  const contextLastLine = context.lines.at(-1);
  const normativeFirstLine = normative.lines[0];
  if (!contextLastLine || !normativeFirstLine) return Number.POSITIVE_INFINITY;
  return contextLastLine.y - normativeFirstLine.y;
}

function isExplicitContextLead(statement: string): boolean {
  return /^(?:다만|다음(?:의)?\s*경우에는|다음\s+조건에서는|경우에는|조건\s+.+에서는)$/u.test(
    statement,
  );
}

function isNonScopeMetaLabel(statement: string): boolean {
  return statement === "참고" || statement === "예시";
}

function isObviousShortHeading(
  context: TextParagraph,
  child: TextParagraph,
): boolean {
  const text = context.statement;
  const contextLine = context.lines[0];
  const childLine = child.lines[0];

  return (
    context.lines.length === 1 &&
    contextLine !== undefined &&
    childLine !== undefined &&
    text.length > 0 &&
    text.length <= 12 &&
    !isNonScopeMetaLabel(text) &&
    !/\s/u.test(text) &&
    !/[.!?。:：]$/u.test(text) &&
    contextLine.height >= childLine.height &&
    Math.abs(contextLine.items[0]!.x - childLine.items[0]!.x) <= 12
  );
}

function isContextCandidate(
  context: TextParagraph,
  child: TextParagraph,
): boolean {
  return (
    isExplicitContextLead(context.statement) ||
    isObviousShortHeading(context, child)
  );
}

function contextCandidateEvaluation(
  context: TextParagraph,
  child: TextParagraph,
  captureEnabled: boolean,
): {
  readonly candidate: boolean;
  readonly detectors: readonly KecSourceCaptureDetector[];
} {
  if (!captureEnabled) {
    return { candidate: isContextCandidate(context, child), detectors: [] };
  }
  const detectors: KecSourceCaptureDetector[] = [];
  if (isExplicitContextLead(context.statement)) {
    detectors.push("explicit-context-lead");
  }
  if (isObviousShortHeading(context, child)) {
    detectors.push("short-heading-adjacent");
  }
  return { candidate: detectors.length > 0, detectors };
}

type ContextualRequirement = {
  readonly statement: string;
  readonly locators: readonly [
    KecRequirementLocator,
    ...KecRequirementLocator[],
  ];
  readonly fragments: readonly [
    KecSourceCaptureFragment,
    ...KecSourceCaptureFragment[],
  ];
  readonly contextSearchTermination: KecContextSearchTermination;
};

function contextualRequirements(
  paragraphs: readonly TextParagraph[],
  captureEnabled: boolean,
): {
  readonly requirements: readonly ContextualRequirement[];
  readonly suppressed: readonly KecSuppressedAssemblyObservation[];
} {
  const requirements: ContextualRequirement[] = [];
  const suppressed: KecSuppressedAssemblyObservation[] = [];

  for (const [index, paragraph] of paragraphs.entries()) {
    if (!isNormativeStatement(paragraph.statement)) continue;

    const fragments: KecSourceCaptureFragment[] = [
      {
        role: "normative-pattern-fragment",
        span: paragraph.locator,
        observedText: paragraph.statement,
        detectors: ["normative-sentence-ending"],
      },
    ];
    let child = paragraph;
    let contextIndex = index - 1;
    let unresolvedContextBarrier = false;
    let contextSearchTermination: KecContextSearchTermination = "page-start";

    while (contextIndex >= 0) {
      const context = paragraphs[contextIndex]!;
      if (context.structuralRegion !== child.structuralRegion) {
        contextSearchTermination = "structural-region-boundary";
        break;
      }
      if (isNormativeStatement(context.statement)) {
        contextSearchTermination = "preceding-normative-paragraph";
        break;
      }
      const evaluation = contextCandidateEvaluation(
        context,
        child,
        captureEnabled,
      );
      if (!evaluation.candidate) {
        contextSearchTermination = "preceding-non-context-candidate";
        break;
      }
      const gap = paragraphGap(context, child);
      if (gap <= 0 || gap > 36) {
        unresolvedContextBarrier = true;
        if (captureEnabled) {
          suppressed.push({
            kind: "suppressed-assembly",
            fragments: fragments as [
              KecSourceCaptureFragment,
              ...KecSourceCaptureFragment[],
            ],
            blockingCandidate: {
              role: "unattached-context-candidate",
              span: context.locator,
              observedText: context.statement,
              detectors: evaluation.detectors,
            },
            blockedBy: gap <= 0 ? "gap-not-positive" : "gap-above-window",
          });
        }
        break;
      }

      fragments.unshift({
        role: "attached-context-fragment",
        span: context.locator,
        observedText: context.statement,
        detectors: evaluation.detectors,
      });
      child = context;
      contextIndex -= 1;
    }

    if (unresolvedContextBarrier) continue;

    requirements.push({
      statement: normalizeKecSourceText(
        fragments.map(({ observedText }) => observedText).join(" "),
      ),
      locators: fragments.map(({ span }) => span) as [
        KecRequirementLocator,
        ...KecRequirementLocator[],
      ],
      fragments: fragments as [
        KecSourceCaptureFragment,
        ...KecSourceCaptureFragment[],
      ],
      contextSearchTermination,
    });
  }

  return { requirements, suppressed };
}

function sha256Hex(value: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
}

function sourceBlobHash(bytes: Uint8Array): SourceBlobHash {
  return {
    algorithm: "sha-256",
    digest: sha256Hex(bytes),
  };
}

function requirementId(
  sourceRevision: SourceRevision,
  input: SourceBlobHash,
  locators: readonly [KecRequirementLocator, ...KecRequirementLocator[]],
): KecRequirementId {
  const identityMaterial = JSON.stringify([
    sourceRevision.sourceIdentity,
    sourceRevision.revisionKey,
    input.algorithm,
    input.digest,
    KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
    locators.map((locator) => [
      locator.pageNumber,
      locator.startItemIndex,
      locator.endItemIndexExclusive,
    ]),
  ]);
  const digest = sha256Hex(identityMaterial);

  return `kec-requirement:${digest}` as KecRequirementId;
}

async function extractKecRequirementPipeline(
  input: ExtractKecRequirementsInput,
  captureEnabled: boolean,
  verifier: KecSourceBindingVerifier,
): Promise<KecCapturedRequirementSnapshot> {
  if (input.sourceLocator.scheme !== "file") {
    throw new Error("Task90 supports only file source locators");
  }

  const projectRoot = assertProjectRoot(input.projectRoot);
  const absolutePdfPath = resolveKecPdfPath(
    projectRoot,
    input.sourceLocator.value,
  );
  const bytes = await readKecPdfBytes(absolutePdfPath);
  const blobHash = sourceBlobHash(bytes);
  const verdict = await verifier.verifyObservedBinding({
    sourceRevision: input.sourceRevision,
    blobHash,
  });
  switch (verdict.kind) {
    case "BINDING_ADMITTED":
      break;
    case "BINDING_NOT_ADMITTED":
    case "BINDING_WITHDRAWN":
    case "BINDING_CONTRADICTION":
      throw new KecSourceBindingVerificationError(verdict.kind);
  }
  const pages = await parseKecPdfTextItems(bytes);
  const lineage: ExtractionLineage = {
    input: blobHash,
    contract: KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
  };
  const requirements: KecRequirementExtraction[] = [];
  const observations: KecSourceCaptureObservation[] = [];

  for (const page of pages) {
    const grouped = groupParagraphs(page);
    if (captureEnabled) observations.push(...grouped.excludedObservations);
    const contextual = contextualRequirements(
      grouped.paragraphs,
      captureEnabled,
    );
    if (captureEnabled) observations.push(...contextual.suppressed);
    for (const extracted of contextual.requirements) {
      const id = requirementId(
        input.sourceRevision,
        blobHash,
        extracted.locators,
      );
      requirements.push({
        requirement: {
          id,
          statement: extracted.statement,
        },
        provenance: {
          sourceRevision: input.sourceRevision,
          lineage,
          locatorSpace: KEC_REQUIREMENT_LOCATOR_SPACE,
          locators: extracted.locators,
        },
      });
      if (captureEnabled) {
        observations.push({
          kind: "requirement-assembly",
          requirementId: id,
          fragments: extracted.fragments,
          contextSearchTermination: extracted.contextSearchTermination,
        });
      }
    }
  }

  const binding: KecRequirementExtractionBinding = {
    sourceRevision: input.sourceRevision,
    blobHash,
    extractionContract: KEC_REQUIREMENT_EXTRACTION_CONTRACT_ID,
    locatorSpace: KEC_REQUIREMENT_LOCATOR_SPACE,
  };

  const requirementSnapshot: KecRequirementExtractionSnapshot = {
    binding,
    requirements,
  };
  return {
    requirementSnapshot,
    captureSnapshot: {
      binding,
      captureContract: KEC_SOURCE_CAPTURE_CONTRACT_ID,
      observations: captureEnabled
        ? [...observations].sort(compareKecSourceCaptureObservations)
        : [],
    },
  };
}

export type KecSourceBindingVerdict =
  | Readonly<{ kind: "BINDING_ADMITTED" }>
  | Readonly<{ kind: "BINDING_NOT_ADMITTED" }>
  | Readonly<{ kind: "BINDING_WITHDRAWN" }>
  | Readonly<{ kind: "BINDING_CONTRADICTION" }>;

export interface KecSourceBindingVerifier {
  verifyObservedBinding(binding: {
    readonly sourceRevision: SourceRevision;
    readonly blobHash: SourceBlobHash;
  }): KecSourceBindingVerdict | Promise<KecSourceBindingVerdict>;
}

export class KecSourceBindingVerificationError extends Error {
  readonly verdict: Exclude<
    KecSourceBindingVerdict["kind"],
    "BINDING_ADMITTED"
  >;

  constructor(
    verdict: Exclude<KecSourceBindingVerdict["kind"], "BINDING_ADMITTED">,
  ) {
    super(`Task90 source binding verification failed: ${verdict}`);
    this.name = "KecSourceBindingVerificationError";
    this.verdict = verdict;
  }
}

export async function extractKecRequirementSnapshot(
  input: ExtractKecRequirementsInput,
  verifier: KecSourceBindingVerifier,
): Promise<KecRequirementExtractionSnapshot> {
  const extracted = await extractKecRequirementPipeline(input, false, verifier);
  return extracted.requirementSnapshot;
}

export async function extractKecRequirementSnapshotWithCapture(
  input: ExtractKecRequirementsInput,
  verifier: KecSourceBindingVerifier,
): Promise<KecCapturedRequirementSnapshot> {
  return extractKecRequirementPipeline(input, true, verifier);
}

export async function extractKecRequirements(
  input: ExtractKecRequirementsInput,
  verifier: KecSourceBindingVerifier,
): Promise<readonly KecRequirementExtraction[]> {
  const extracted = await extractKecRequirementPipeline(input, false, verifier);
  return extracted.requirementSnapshot.requirements;
}
