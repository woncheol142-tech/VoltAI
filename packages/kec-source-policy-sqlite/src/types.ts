import type { AssertionSchemeVersion } from "@voltai/kec-source-policy";
import type { SourceRevision } from "@voltai/source-core";

export type RevisionScheme = Readonly<Record<string, unknown>> &
  Readonly<{ schemeId: string; schemeVersion: string }>;

export interface PolicyConfigurationSnapshot {
  readonly epoch: string;
  readonly registeredSchemes: readonly AssertionSchemeVersion[];
  readonly activeAutomaticOriginSchemeVersions: readonly Readonly<{
    schemeId: string;
    version: string;
  }>[];
  readonly registeredRevisionSchemes: readonly RevisionScheme[];
  readonly sealed: boolean;
}

export interface EstablishedSourceRevisionRecord {
  readonly sourceRevision: SourceRevision;
  readonly identityBasis: unknown;
  readonly revisionBasis: unknown;
  readonly resolutionRecordRef: string;
}

export interface Task97Instrumentation {
  readonly issueIdentity?: (...args: readonly unknown[]) => unknown;
  readonly issueRevision?: (...args: readonly unknown[]) => unknown;
  readonly associateIdentity?: (...args: readonly unknown[]) => unknown;
  readonly associateRevision?: (...args: readonly unknown[]) => unknown;
}
