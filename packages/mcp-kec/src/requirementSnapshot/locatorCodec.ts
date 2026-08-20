import type { KecRequirementLocator } from "../knowledge/requirementExtraction.js";

import { KecRequirementSnapshotStoreError } from "./errors.js";

function validCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}

function encodingFailure(): never {
  throw new KecRequirementSnapshotStoreError("locator-encode");
}

function decodingFailure(): never {
  throw new KecRequirementSnapshotStoreError("locator-decode");
}

export function encodeKecRequirementLocators(
  locators: readonly KecRequirementLocator[],
): string {
  if (locators.length === 0) encodingFailure();

  const tuples: [number, number, number][] = [];
  for (const locator of locators) {
    const { pageNumber, startItemIndex, endItemIndexExclusive } = locator;
    if (
      !validCoordinate(pageNumber) ||
      !validCoordinate(startItemIndex) ||
      !validCoordinate(endItemIndexExclusive)
    ) {
      encodingFailure();
    }
    tuples.push([pageNumber, startItemIndex, endItemIndexExclusive]);
  }
  return JSON.stringify(tuples);
}

export function decodeKecRequirementLocators(
  storedText: string,
): readonly [KecRequirementLocator, ...KecRequirementLocator[]] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storedText);
  } catch {
    decodingFailure();
  }

  if (!Array.isArray(parsed) || parsed.length === 0) decodingFailure();

  const locators: KecRequirementLocator[] = [];
  const tuples: [number, number, number][] = [];
  for (const entry of parsed) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      !validCoordinate(entry[0]) ||
      !validCoordinate(entry[1]) ||
      !validCoordinate(entry[2])
    ) {
      decodingFailure();
    }
    const tuple: [number, number, number] = [entry[0], entry[1], entry[2]];
    tuples.push(tuple);
    locators.push({
      pageNumber: tuple[0],
      startItemIndex: tuple[1],
      endItemIndexExclusive: tuple[2],
    });
  }

  if (JSON.stringify(tuples) !== storedText) decodingFailure();
  return locators as [KecRequirementLocator, ...KecRequirementLocator[]];
}
