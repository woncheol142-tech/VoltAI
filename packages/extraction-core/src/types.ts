import type { SourceBlobHash } from "@voltai/source-core";

declare const extractionContractIdBrand: unique symbol;
declare const anchorLocatorSpaceBrand: unique symbol;

export type ExtractionContractId = string & {
  readonly [extractionContractIdBrand]: true;
};

export type AnchorLocatorSpace = string & {
  readonly [anchorLocatorSpaceBrand]: true;
};

export type ExtractionLineage = {
  readonly input: SourceBlobHash;
  readonly contract: ExtractionContractId;
};

export type ExtractionAnchor<TLocator = unknown> = {
  readonly lineage: ExtractionLineage;
  readonly locatorSpace: AnchorLocatorSpace;
  readonly locator: TLocator;
};
