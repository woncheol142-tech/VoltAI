import type { KecIndexDiagnosticsV1 } from "./types.js";

export function serializeKecIndexDiagnostics(
  diagnostics: KecIndexDiagnosticsV1,
): string {
  return `${JSON.stringify(diagnostics)}\n`;
}
