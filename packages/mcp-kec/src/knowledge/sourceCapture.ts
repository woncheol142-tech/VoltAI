import type {
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
  KecRequirementId,
} from "./requirementExtraction.js";

declare const kecSourceCaptureContractIdBrand: unique symbol;

export type KecSourceCaptureContractId = string & {
  readonly [kecSourceCaptureContractIdBrand]: true;
};

export type KecSourceTextItemSpan = {
  readonly pageNumber: number;
  readonly startItemIndex: number;
  readonly endItemIndexExclusive: number;
};

export type KecSourceCaptureDetector =
  | "normative-sentence-ending"
  | "explicit-context-lead"
  | "short-heading-adjacent";

export type KecSourceCaptureFragmentRole =
  | "normative-pattern-fragment"
  | "attached-context-fragment"
  | "unattached-context-candidate";

export type KecContextSearchTermination =
  | "page-start"
  | "structural-region-boundary"
  | "preceding-normative-paragraph"
  | "preceding-non-context-candidate";

export type KecSuppressedAssemblyBlock =
  "gap-not-positive" | "gap-above-window";

export type KecSourceCaptureFragment = {
  readonly role: KecSourceCaptureFragmentRole;
  readonly span: KecSourceTextItemSpan;
  readonly observedText: string;
  readonly detectors: readonly KecSourceCaptureDetector[];
};

export type KecColumnGapRegionExcludedObservation = {
  readonly kind: "column-gap-region-excluded";
  readonly span: KecSourceTextItemSpan;
  readonly observedText: string;
};

export type KecSuppressedAssemblyObservation = {
  readonly kind: "suppressed-assembly";
  readonly fragments: readonly [
    KecSourceCaptureFragment,
    ...KecSourceCaptureFragment[],
  ];
  readonly blockingCandidate: KecSourceCaptureFragment;
  readonly blockedBy: KecSuppressedAssemblyBlock;
};

export type KecRequirementAssemblyObservation = {
  readonly kind: "requirement-assembly";
  readonly requirementId: KecRequirementId;
  readonly fragments: readonly [
    KecSourceCaptureFragment,
    ...KecSourceCaptureFragment[],
  ];
  readonly contextSearchTermination: KecContextSearchTermination;
};

export type KecSourceCaptureObservation =
  | KecColumnGapRegionExcludedObservation
  | KecSuppressedAssemblyObservation
  | KecRequirementAssemblyObservation;

export type KecSourceCaptureSnapshot = {
  readonly binding: KecRequirementExtractionBinding;
  readonly captureContract: KecSourceCaptureContractId;
  readonly observations: readonly KecSourceCaptureObservation[];
};

export type KecCapturedRequirementSnapshot = {
  readonly requirementSnapshot: KecRequirementExtractionSnapshot;
  readonly captureSnapshot: KecSourceCaptureSnapshot;
};

export const KEC_SOURCE_CAPTURE_CONTRACT_ID =
  "kec:pdfjs-structural-capture-observations:v1" as KecSourceCaptureContractId;

export const KEC_SOURCE_CAPTURE_DETECTOR_ORDER = [
  "normative-sentence-ending",
  "explicit-context-lead",
  "short-heading-adjacent",
] as const satisfies readonly KecSourceCaptureDetector[];

export function normalizeKecSourceText(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(" ");
}

function compareSpans(
  left: KecSourceTextItemSpan,
  right: KecSourceTextItemSpan,
): number {
  return (
    left.pageNumber - right.pageNumber ||
    left.startItemIndex - right.startItemIndex ||
    left.endItemIndexExclusive - right.endItemIndexExclusive
  );
}

function minimumSpan(
  observation: KecSourceCaptureObservation,
): KecSourceTextItemSpan {
  if (observation.kind === "column-gap-region-excluded") {
    return observation.span;
  }
  const spans = [
    ...observation.fragments.map(({ span }) => span),
    ...(observation.kind === "suppressed-assembly"
      ? [observation.blockingCandidate.span]
      : []),
  ];
  const first = [...spans].sort(compareSpans)[0];
  if (first === undefined) {
    throw new Error("Source capture observation requires an anchor");
  }
  return first;
}

export function compareKecSourceCaptureObservations(
  left: KecSourceCaptureObservation,
  right: KecSourceCaptureObservation,
): number {
  const kindOrder: Record<KecSourceCaptureObservation["kind"], number> = {
    "column-gap-region-excluded": 0,
    "suppressed-assembly": 1,
    "requirement-assembly": 2,
  };
  return (
    compareSpans(minimumSpan(left), minimumSpan(right)) ||
    kindOrder[left.kind] - kindOrder[right.kind]
  );
}
