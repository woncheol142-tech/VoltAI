declare const sourceIdentityBrand: unique symbol;
declare const sourceRevisionKeyBrand: unique symbol;

export type SourceIdentity = string & {
  readonly [sourceIdentityBrand]: true;
};

export type SourceRevisionKey = string & {
  readonly [sourceRevisionKeyBrand]: true;
};

export interface SourceRevision {
  readonly sourceIdentity: SourceIdentity;
  readonly revisionKey: SourceRevisionKey;
}

export interface SourceBlobHash {
  readonly algorithm: "sha-256";
  readonly digest: string;
}

export interface ExternalSourceLocator {
  readonly scheme: string;
  readonly value: string;
}
