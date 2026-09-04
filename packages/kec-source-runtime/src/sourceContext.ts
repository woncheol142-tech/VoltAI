import type { SourceRevision } from "@voltai/source-core";

export const DIAGNOSTIC_CONTEXT_REFUSAL =
  "DIAGNOSTIC_CONTEXT_NOT_AUTHORITATIVE" as const;

export function isDiagnosticSourceContext(
  sourceRevision: SourceRevision,
): boolean {
  return (
    sourceRevision.sourceIdentity.startsWith("diag:") ||
    sourceRevision.revisionKey.startsWith("diag:")
  );
}
