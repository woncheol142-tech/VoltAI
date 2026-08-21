import type {
  ExtractKecRequirementsInput,
  KecRequirementExtractionBinding,
  KecRequirementExtractionSnapshot,
  KecRequirementId,
} from "../../src/knowledge/requirementExtraction.js";

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

export type ExpectedCaptureProducer = (
  input: ExtractKecRequirementsInput,
) => Promise<KecCapturedRequirementSnapshot>;

export const TASK93_CAPTURE_CONTRACT_ID =
  "kec:pdfjs-structural-capture-observations:v1" as KecSourceCaptureContractId;
export const TASK90_EXTRACTION_CONTRACT_ID =
  "kec:pdfjs-structural-normative-paragraphs:v1";
export const TASK90_LOCATOR_SPACE = "kec:pdf-text-item-span:v1";

export const DETECTOR_ORDER = [
  "normative-sentence-ending",
  "explicit-context-lead",
  "short-heading-adjacent",
] as const satisfies readonly KecSourceCaptureDetector[];

export const CONTEXT_SEARCH_TERMINATIONS = [
  "page-start",
  "structural-region-boundary",
  "preceding-normative-paragraph",
  "preceding-non-context-candidate",
] as const satisfies readonly KecContextSearchTermination[];

export const OBSERVATION_KINDS = [
  "column-gap-region-excluded",
  "suppressed-assembly",
  "requirement-assembly",
] as const satisfies readonly KecSourceCaptureObservation["kind"][];

export const FRAGMENT_ROLES = [
  "normative-pattern-fragment",
  "attached-context-fragment",
  "unattached-context-candidate",
] as const satisfies readonly KecSourceCaptureFragmentRole[];

export const SUPPRESSED_BLOCKS = [
  "gap-not-positive",
  "gap-above-window",
] as const satisfies readonly KecSuppressedAssemblyBlock[];

export function captureSpan(
  pageNumber: number,
  startItemIndex: number,
  endItemIndexExclusive: number,
): KecSourceTextItemSpan {
  return { pageNumber, startItemIndex, endItemIndexExclusive };
}

export function captureFragment(
  role: KecSourceCaptureFragmentRole,
  span: KecSourceTextItemSpan,
  observedText: string,
  detectors: readonly KecSourceCaptureDetector[],
): KecSourceCaptureFragment {
  return { role, span, observedText, detectors };
}

export function normalizeCapturedText(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(" ");
}

export function capturedTask91Snapshot(
  requirementSnapshot: KecRequirementExtractionSnapshot,
): KecCapturedRequirementSnapshot {
  const first = requirementSnapshot.requirements[0];
  const second = requirementSnapshot.requirements[1];
  if (!first || !second) {
    throw new Error(
      "Task93 capture fixture requires the two-member Task91 snapshot",
    );
  }

  const firstLocators = first.provenance.locators;
  const firstContext = firstLocators[0];
  const firstNormative = firstLocators[1];
  const secondNormative = second.provenance.locators[0];
  if (!firstContext || !firstNormative || !secondNormative) {
    throw new Error(
      "Task93 capture fixture requires canonical Task91 locators",
    );
  }

  return {
    requirementSnapshot,
    captureSnapshot: {
      binding: requirementSnapshot.binding,
      captureContract: TASK93_CAPTURE_CONTRACT_ID,
      observations: [
        {
          kind: "requirement-assembly",
          requirementId: first.requirement.id,
          fragments: [
            captureFragment(
              "attached-context-fragment",
              firstContext,
              "첫 번째",
              ["short-heading-adjacent"],
            ),
            captureFragment(
              "normative-pattern-fragment",
              firstNormative,
              "요구사항은 시설하여야 한다",
              ["normative-sentence-ending"],
            ),
          ],
          contextSearchTermination: "page-start",
        },
        {
          kind: "requirement-assembly",
          requirementId: second.requirement.id,
          fragments: [
            captureFragment(
              "normative-pattern-fragment",
              secondNormative,
              second.requirement.statement,
              ["normative-sentence-ending"],
            ),
          ],
          contextSearchTermination: "page-start",
        },
      ],
    },
  };
}

export function capturedEmptySnapshot(
  binding: KecRequirementExtractionBinding,
): KecCapturedRequirementSnapshot {
  return {
    requirementSnapshot: { binding, requirements: [] },
    captureSnapshot: {
      binding,
      captureContract: TASK93_CAPTURE_CONTRACT_ID,
      observations: [],
    },
  };
}

export function capturedSingleFragmentSnapshot(
  requirementSnapshot: KecRequirementExtractionSnapshot,
): KecCapturedRequirementSnapshot {
  return {
    requirementSnapshot,
    captureSnapshot: {
      binding: requirementSnapshot.binding,
      captureContract: TASK93_CAPTURE_CONTRACT_ID,
      observations: requirementSnapshot.requirements.map((member) => {
        const span = member.provenance.locators[0];
        if (member.provenance.locators.length !== 1 || !span) {
          throw new Error(
            "Task93 single-fragment fixture requires one locator per Requirement",
          );
        }
        return {
          kind: "requirement-assembly" as const,
          requirementId: member.requirement.id,
          fragments: [
            captureFragment(
              "normative-pattern-fragment",
              span,
              member.requirement.statement,
              ["normative-sentence-ending"],
            ),
          ] as const,
          contextSearchTermination: "page-start" as const,
        };
      }),
    },
  };
}

export const codecObservations: readonly KecSourceCaptureObservation[] = [
  {
    kind: "column-gap-region-excluded",
    span: captureSpan(1, 0, 6),
    observedText: "항목 요구사항 배선 접지하여야 한다",
  },
  {
    kind: "suppressed-assembly",
    fragments: [
      captureFragment(
        "normative-pattern-fragment",
        captureSpan(1, 9, 10),
        "보호장치를 설치하여야 한다",
        ["normative-sentence-ending"],
      ),
    ],
    blockingCandidate: captureFragment(
      "unattached-context-candidate",
      captureSpan(1, 7, 8),
      "다만",
      ["explicit-context-lead", "short-heading-adjacent"],
    ),
    blockedBy: "gap-above-window",
  },
  {
    kind: "requirement-assembly",
    requirementId: "fixture-requirement" as KecRequirementId,
    fragments: [
      captureFragment(
        "attached-context-fragment",
        captureSpan(2, 3, 4),
        "다만",
        ["explicit-context-lead", "short-heading-adjacent"],
      ),
      captureFragment(
        "normative-pattern-fragment",
        captureSpan(2, 5, 7),
        "전기설비는 시설하여야 한다",
        ["normative-sentence-ending"],
      ),
    ],
    contextSearchTermination: "preceding-non-context-candidate",
  },
];

export const canonicalCodecPayloads = [
  '{"kind":"column-gap-region-excluded","span":{"pageNumber":1,"startItemIndex":0,"endItemIndexExclusive":6},"observedText":"항목 요구사항 배선 접지하여야 한다"}',
  '{"kind":"suppressed-assembly","fragments":[{"role":"normative-pattern-fragment","span":{"pageNumber":1,"startItemIndex":9,"endItemIndexExclusive":10},"observedText":"보호장치를 설치하여야 한다","detectors":["normative-sentence-ending"]}],"blockingCandidate":{"role":"unattached-context-candidate","span":{"pageNumber":1,"startItemIndex":7,"endItemIndexExclusive":8},"observedText":"다만","detectors":["explicit-context-lead","short-heading-adjacent"]},"blockedBy":"gap-above-window"}',
  '{"kind":"requirement-assembly","requirementId":"fixture-requirement","fragments":[{"role":"attached-context-fragment","span":{"pageNumber":2,"startItemIndex":3,"endItemIndexExclusive":4},"observedText":"다만","detectors":["explicit-context-lead","short-heading-adjacent"]},{"role":"normative-pattern-fragment","span":{"pageNumber":2,"startItemIndex":5,"endItemIndexExclusive":7},"observedText":"전기설비는 시설하여야 한다","detectors":["normative-sentence-ending"]}],"contextSearchTermination":"preceding-non-context-candidate"}',
] as const;

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
  return [...spans].sort(compareSpans)[0]!;
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

export function compareCaptureObservations(
  left: KecSourceCaptureObservation,
  right: KecSourceCaptureObservation,
): number {
  const kindOrdinal: Record<KecSourceCaptureObservation["kind"], number> = {
    "column-gap-region-excluded": 0,
    "suppressed-assembly": 1,
    "requirement-assembly": 2,
  };
  return (
    compareSpans(minimumSpan(left), minimumSpan(right)) ||
    kindOrdinal[left.kind] - kindOrdinal[right.kind]
  );
}
