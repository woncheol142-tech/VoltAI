import type { KecRequirementId } from "../knowledge/requirementExtraction.js";
import type {
  KecContextSearchTermination,
  KecSourceCaptureDetector,
  KecSourceCaptureFragment,
  KecSourceCaptureFragmentRole,
  KecSourceCaptureObservation,
  KecSourceTextItemSpan,
  KecSuppressedAssemblyBlock,
} from "../knowledge/sourceCapture.js";
import {
  KEC_SOURCE_CAPTURE_DETECTOR_ORDER,
  normalizeKecSourceText,
} from "../knowledge/sourceCapture.js";

import type { KecRequirementSnapshotErrorCategory } from "./errors.js";
import { KecRequirementSnapshotStoreError } from "./errors.js";

type CaptureCodecFailure = Extract<
  KecRequirementSnapshotErrorCategory,
  "capture-invalid" | "capture-corruption"
>;

function fail(category: CaptureCodecFailure): never {
  throw new KecRequirementSnapshotStoreError(category);
}

function recordValue(
  value: unknown,
  category: CaptureCodecFailure,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(category);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  category: CaptureCodecFailure,
): void {
  const observed = Object.keys(value);
  if (
    observed.length !== keys.length ||
    observed.some((key) => !keys.includes(key))
  ) {
    fail(category);
  }
}

function coordinate(value: unknown, category: CaptureCodecFailure): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    fail(category);
  }
  return value;
}

function spanValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecSourceTextItemSpan {
  const record = recordValue(value, category);
  exactKeys(
    record,
    ["pageNumber", "startItemIndex", "endItemIndexExclusive"],
    category,
  );
  const pageNumber = coordinate(record.pageNumber, category);
  const startItemIndex = coordinate(record.startItemIndex, category);
  const endItemIndexExclusive = coordinate(
    record.endItemIndexExclusive,
    category,
  );
  if (endItemIndexExclusive <= startItemIndex) fail(category);
  return { pageNumber, startItemIndex, endItemIndexExclusive };
}

function normalizedText(value: unknown, category: CaptureCodecFailure): string {
  if (typeof value !== "string" || normalizeKecSourceText(value) !== value) {
    fail(category);
  }
  return value;
}

function detectorValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecSourceCaptureDetector {
  switch (value) {
    case "normative-sentence-ending":
    case "explicit-context-lead":
    case "short-heading-adjacent":
      return value;
    default:
      fail(category);
  }
}

function detectorValues(
  value: unknown,
  category: CaptureCodecFailure,
): readonly KecSourceCaptureDetector[] {
  if (!Array.isArray(value)) fail(category);
  const detectors = value.map((entry) => detectorValue(entry, category));
  let previous = -1;
  for (const detector of detectors) {
    const position = KEC_SOURCE_CAPTURE_DETECTOR_ORDER.indexOf(detector);
    if (position <= previous) fail(category);
    previous = position;
  }
  return detectors;
}

function roleValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecSourceCaptureFragmentRole {
  switch (value) {
    case "normative-pattern-fragment":
    case "attached-context-fragment":
    case "unattached-context-candidate":
      return value;
    default:
      fail(category);
  }
}

function fragmentValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecSourceCaptureFragment {
  const record = recordValue(value, category);
  exactKeys(record, ["role", "span", "observedText", "detectors"], category);
  return {
    role: roleValue(record.role, category),
    span: spanValue(record.span, category),
    observedText: normalizedText(record.observedText, category),
    detectors: detectorValues(record.detectors, category),
  };
}

function fragmentValues(
  value: unknown,
  category: CaptureCodecFailure,
): readonly [KecSourceCaptureFragment, ...KecSourceCaptureFragment[]] {
  if (!Array.isArray(value) || value.length === 0) fail(category);
  const fragments = value.map((entry) => fragmentValue(entry, category));
  return fragments as [KecSourceCaptureFragment, ...KecSourceCaptureFragment[]];
}

function terminationValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecContextSearchTermination {
  switch (value) {
    case "page-start":
    case "structural-region-boundary":
    case "preceding-normative-paragraph":
    case "preceding-non-context-candidate":
      return value;
    default:
      fail(category);
  }
}

function blockValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecSuppressedAssemblyBlock {
  switch (value) {
    case "gap-not-positive":
    case "gap-above-window":
      return value;
    default:
      fail(category);
  }
}

function observationValue(
  value: unknown,
  category: CaptureCodecFailure,
): KecSourceCaptureObservation {
  const record = recordValue(value, category);
  if (typeof record.kind !== "string") fail(category);

  switch (record.kind) {
    case "column-gap-region-excluded":
      exactKeys(record, ["kind", "span", "observedText"], category);
      return {
        kind: record.kind,
        span: spanValue(record.span, category),
        observedText: normalizedText(record.observedText, category),
      };
    case "suppressed-assembly":
      exactKeys(
        record,
        ["kind", "fragments", "blockingCandidate", "blockedBy"],
        category,
      );
      return {
        kind: record.kind,
        fragments: fragmentValues(record.fragments, category),
        blockingCandidate: fragmentValue(record.blockingCandidate, category),
        blockedBy: blockValue(record.blockedBy, category),
      };
    case "requirement-assembly":
      exactKeys(
        record,
        ["kind", "requirementId", "fragments", "contextSearchTermination"],
        category,
      );
      if (typeof record.requirementId !== "string") fail(category);
      return {
        kind: record.kind,
        requirementId: record.requirementId as KecRequirementId,
        fragments: fragmentValues(record.fragments, category),
        contextSearchTermination: terminationValue(
          record.contextSearchTermination,
          category,
        ),
      };
    default:
      fail(category);
  }
}

function canonicalValue(observation: KecSourceCaptureObservation): object {
  switch (observation.kind) {
    case "column-gap-region-excluded":
      return {
        kind: observation.kind,
        span: {
          pageNumber: observation.span.pageNumber,
          startItemIndex: observation.span.startItemIndex,
          endItemIndexExclusive: observation.span.endItemIndexExclusive,
        },
        observedText: observation.observedText,
      };
    case "suppressed-assembly":
      return {
        kind: observation.kind,
        fragments: observation.fragments.map(canonicalFragment),
        blockingCandidate: canonicalFragment(observation.blockingCandidate),
        blockedBy: observation.blockedBy,
      };
    case "requirement-assembly":
      return {
        kind: observation.kind,
        requirementId: observation.requirementId,
        fragments: observation.fragments.map(canonicalFragment),
        contextSearchTermination: observation.contextSearchTermination,
      };
  }
}

function canonicalFragment(fragment: KecSourceCaptureFragment): object {
  return {
    role: fragment.role,
    span: {
      pageNumber: fragment.span.pageNumber,
      startItemIndex: fragment.span.startItemIndex,
      endItemIndexExclusive: fragment.span.endItemIndexExclusive,
    },
    observedText: fragment.observedText,
    detectors: [...fragment.detectors],
  };
}

export function encodeKecSourceCaptureObservation(
  observation: KecSourceCaptureObservation,
): string {
  const validated = observationValue(observation, "capture-invalid");
  return JSON.stringify(canonicalValue(validated));
}

export function decodeKecSourceCaptureObservation(
  storedText: string,
): KecSourceCaptureObservation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storedText);
  } catch {
    fail("capture-corruption");
  }
  const observation = observationValue(parsed, "capture-corruption");
  if (JSON.stringify(canonicalValue(observation)) !== storedText) {
    fail("capture-corruption");
  }
  return observation;
}
