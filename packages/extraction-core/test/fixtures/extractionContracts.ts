import type { SourceBlobHash } from "../../../source-core/src/index.js";

import type {
  AnchorLocatorSpace,
  ExtractionAnchor,
  ExtractionContractId,
  ExtractionLineage,
} from "../../src/index.js";

type Expect<T extends true> = T;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
type ContractHoldsWhenResolved<Value, Result extends boolean> =
  IsAny<Value> extends true ? true : Result;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type PdfPageLocator = {
  readonly page: number;
};

type ExtractionContractIdIsOpaque = Expect<
  ContractHoldsWhenResolved<
    ExtractionContractId,
    string extends ExtractionContractId ? false : true
  >
>;
type AnchorLocatorSpaceIsOpaque = Expect<
  ContractHoldsWhenResolved<
    AnchorLocatorSpace,
    string extends AnchorLocatorSpace ? false : true
  >
>;
type ExtractionLineageKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    ExtractionLineage,
    Equal<keyof ExtractionLineage, "input" | "contract">
  >
>;
type ExtractionLineageInputIsSourceBlobHash = Expect<
  ContractHoldsWhenResolved<
    ExtractionLineage,
    Equal<ExtractionLineage["input"], SourceBlobHash>
  >
>;
type ExtractionLineageContractIsExtractionContractId = Expect<
  ContractHoldsWhenResolved<
    ExtractionLineage,
    Equal<ExtractionLineage["contract"], ExtractionContractId>
  >
>;
type ExtractionAnchorKeysAreExact = Expect<
  ContractHoldsWhenResolved<
    ExtractionAnchor<PdfPageLocator>,
    Equal<
      keyof ExtractionAnchor<PdfPageLocator>,
      "lineage" | "locatorSpace" | "locator"
    >
  >
>;
type ExtractionAnchorLineageIsExtractionLineage = Expect<
  ContractHoldsWhenResolved<
    ExtractionAnchor<PdfPageLocator>,
    Equal<ExtractionAnchor<PdfPageLocator>["lineage"], ExtractionLineage>
  >
>;
type ExtractionAnchorLocatorSpaceIsAnchorLocatorSpace = Expect<
  ContractHoldsWhenResolved<
    ExtractionAnchor<PdfPageLocator>,
    Equal<ExtractionAnchor<PdfPageLocator>["locatorSpace"], AnchorLocatorSpace>
  >
>;
type ExtractionAnchorLocatorPreservesDomainPayload = Expect<
  ContractHoldsWhenResolved<
    ExtractionAnchor<PdfPageLocator>,
    Equal<ExtractionAnchor<PdfPageLocator>["locator"], PdfPageLocator>
  >
>;
type SourceBlobHashRemainsImportedAndStructural = Expect<
  Equal<keyof SourceBlobHash, "algorithm" | "digest">
>;

declare const pdfContract: ExtractionContractId;
declare const alternatePdfContract: ExtractionContractId;
declare const pdfPageSpace: AnchorLocatorSpace;

const sharedInput = {
  algorithm: "sha-256",
  digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} satisfies SourceBlobHash;

const firstPage = {
  lineage: { input: sharedInput, contract: pdfContract },
  locatorSpace: pdfPageSpace,
  locator: { page: 1 },
} satisfies ExtractionAnchor<PdfPageLocator>;

const secondPage = {
  lineage: { input: sharedInput, contract: pdfContract },
  locatorSpace: pdfPageSpace,
  locator: { page: 2 },
} satisfies ExtractionAnchor<PdfPageLocator>;

const alternateContractPage = {
  lineage: { input: sharedInput, contract: alternatePdfContract },
  locatorSpace: pdfPageSpace,
  locator: { page: 1 },
} satisfies ExtractionAnchor<PdfPageLocator>;

export const extractionRepresentabilityExamples = {
  sameInputAndContractWithDifferentLocators: [firstPage, secondPage],
  sameInputWithDifferentContracts: [firstPage, alternateContractPage],
};

export type ExtractionContractChecks =
  | ExtractionContractIdIsOpaque
  | AnchorLocatorSpaceIsOpaque
  | ExtractionLineageKeysAreExact
  | ExtractionLineageInputIsSourceBlobHash
  | ExtractionLineageContractIsExtractionContractId
  | ExtractionAnchorKeysAreExact
  | ExtractionAnchorLineageIsExtractionLineage
  | ExtractionAnchorLocatorSpaceIsAnchorLocatorSpace
  | ExtractionAnchorLocatorPreservesDomainPayload
  | SourceBlobHashRemainsImportedAndStructural;
