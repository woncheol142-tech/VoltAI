import type {
  ExternalSourceLocator,
  SourceBlobHash,
  SourceIdentity,
  SourceRevision,
  SourceRevisionKey,
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

type IdentityIsOpaque = Expect<
  ContractHoldsWhenResolved<
    SourceIdentity,
    string extends SourceIdentity ? false : true
  >
>;
type RevisionKeyIsOpaque = Expect<
  ContractHoldsWhenResolved<
    SourceRevisionKey,
    string extends SourceRevisionKey ? false : true
  >
>;
type RevisionKeysAreMinimal = Expect<
  ContractHoldsWhenResolved<
    SourceRevision,
    Equal<keyof SourceRevision, "sourceIdentity" | "revisionKey">
  >
>;
type RevisionIdentityIsScopedIdentity = Expect<
  ContractHoldsWhenResolved<
    SourceRevision,
    Equal<SourceRevision["sourceIdentity"], SourceIdentity>
  >
>;
type RevisionKeyIsScopedKey = Expect<
  ContractHoldsWhenResolved<
    SourceRevision,
    Equal<SourceRevision["revisionKey"], SourceRevisionKey>
  >
>;
type BlobHashKeysAreStructural = Expect<
  ContractHoldsWhenResolved<
    SourceBlobHash,
    Equal<keyof SourceBlobHash, "algorithm" | "digest">
  >
>;
type BlobHashAcceptsTheFrozenShape = Expect<
  ContractHoldsWhenResolved<
    SourceBlobHash,
    {
      algorithm: "sha-256";
      digest: string;
    } extends SourceBlobHash
      ? true
      : false
  >
>;
type BlobHashProvidesTheFrozenShape = Expect<
  ContractHoldsWhenResolved<
    SourceBlobHash,
    SourceBlobHash extends {
      algorithm: "sha-256";
      digest: string;
    }
      ? true
      : false
  >
>;
type LocatorKeysAreMinimal = Expect<
  ContractHoldsWhenResolved<
    ExternalSourceLocator,
    Equal<keyof ExternalSourceLocator, "scheme" | "value">
  >
>;

declare const firstIdentity: SourceIdentity;
declare const secondIdentity: SourceIdentity;
declare const firstRevisionKey: SourceRevisionKey;
declare const secondRevisionKey: SourceRevisionKey;
declare const secondIdentityRevisionKey: SourceRevisionKey;

const firstRevision = {
  sourceIdentity: firstIdentity,
  revisionKey: firstRevisionKey,
} satisfies SourceRevision;

const secondRevisionForFirstIdentity = {
  sourceIdentity: firstIdentity,
  revisionKey: secondRevisionKey,
} satisfies SourceRevision;

const revisionForSecondIdentity = {
  sourceIdentity: secondIdentity,
  revisionKey: secondIdentityRevisionKey,
} satisfies SourceRevision;

const acquiredBlobHash = {
  algorithm: "sha-256",
  digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} satisfies SourceBlobHash;

const anotherAcquiredBlobHash = {
  algorithm: "sha-256",
  digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
} satisfies SourceBlobHash;

const originalLocator = {
  scheme: "file",
  value: "manuals/original-name.pdf",
} satisfies ExternalSourceLocator;

const movedLocator = {
  scheme: "file",
  value: "archive/renamed-manual.pdf",
} satisfies ExternalSourceLocator;

export const hashNonImplicationExamples = {
  sameHashWithDifferentIdentities: [
    { sourceIdentity: firstIdentity, blobHash: acquiredBlobHash },
    { sourceIdentity: secondIdentity, blobHash: acquiredBlobHash },
  ],
  sameHashWithDifferentRevisions: [
    { revision: firstRevision, blobHash: acquiredBlobHash },
    { revision: secondRevisionForFirstIdentity, blobHash: acquiredBlobHash },
  ],
  differentHashesWithTheSameRevision: [
    { revision: revisionForSecondIdentity, blobHash: acquiredBlobHash },
    { revision: revisionForSecondIdentity, blobHash: anotherAcquiredBlobHash },
  ],
};

export const locatorChangeWithoutRequiredIdentityChange = [
  { sourceIdentity: firstIdentity, locator: originalLocator },
  { sourceIdentity: firstIdentity, locator: movedLocator },
];

export type SourceContractChecks =
  | IdentityIsOpaque
  | RevisionKeyIsOpaque
  | RevisionKeysAreMinimal
  | RevisionIdentityIsScopedIdentity
  | RevisionKeyIsScopedKey
  | BlobHashKeysAreStructural
  | BlobHashAcceptsTheFrozenShape
  | BlobHashProvidesTheFrozenShape
  | LocatorKeysAreMinimal;
