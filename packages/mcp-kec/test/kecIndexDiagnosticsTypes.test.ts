import { describe, expectTypeOf, it } from "vitest";

import {
  inspectKecIndex,
  serializeKecIndexDiagnostics,
  type KecIndexDiagnosticMetadata,
  type KecIndexDiagnosticSource,
  type KecIndexDiagnosticStatus,
  type KecIndexDiagnosticsV1,
} from "../src/indexDiagnostics/index.js";

type ExpectedStatus =
  | "MISSING_DATABASE"
  | "UNINITIALIZED_DATABASE"
  | "EMPTY_INDEX"
  | "READY"
  | "INCONSISTENT";

type ExpectedMetadata = Readonly<{
  provider: string | null;
  model: string | null;
  dimensions: number | null;
  indexedAt: string | null;
}>;

type ExpectedSource = Readonly<{
  sourceId: string;
  chunkCount: number;
}>;

type ExpectedDiagnostics = Readonly<{
  schemaVersion: 1;
  status: ExpectedStatus;
  databaseExists: boolean;
  databaseSchemaVersion: number | null;
  metadata: ExpectedMetadata;
  chunkCount: number;
  sourceCount: number;
  sources: readonly ExpectedSource[];
  observedDimensions: readonly number[];
  issues: readonly string[];
}>;

describe("KEC index diagnostics type contracts", () => {
  it("fixes the exact status, metadata, source, and document shapes", () => {
    expectTypeOf<KecIndexDiagnosticStatus>().toEqualTypeOf<ExpectedStatus>();
    expectTypeOf<KecIndexDiagnosticMetadata>().toEqualTypeOf<ExpectedMetadata>();
    expectTypeOf<KecIndexDiagnosticSource>().toEqualTypeOf<ExpectedSource>();
    expectTypeOf<KecIndexDiagnosticsV1>().toEqualTypeOf<ExpectedDiagnostics>();
  });

  it("accepts exactly one primitive string path and returns a Promise", () => {
    expectTypeOf(inspectKecIndex).toEqualTypeOf<
      (databasePath: string) => Promise<KecIndexDiagnosticsV1>
    >();
  });

  it("serializes only the diagnostics contract to a string", () => {
    expectTypeOf(serializeKecIndexDiagnostics).toEqualTypeOf<
      (diagnostics: KecIndexDiagnosticsV1) => string
    >();
  });

  it("keeps the schema version, nested objects, and arrays readonly", () => {
    const assertReadonly = (diagnostics: KecIndexDiagnosticsV1): void => {
      // @ts-expect-error schemaVersion is readonly and fixed to literal 1.
      diagnostics.schemaVersion = 2;
      // @ts-expect-error metadata is readonly.
      diagnostics.metadata.provider = "changed";
      // @ts-expect-error source entries are readonly.
      diagnostics.sources[0].chunkCount = 2;
      // @ts-expect-error sources is a readonly array.
      diagnostics.sources.push({ sourceId: "unsafe", chunkCount: 1 });
      // @ts-expect-error observedDimensions is a readonly array.
      diagnostics.observedDimensions.push(4);
      // @ts-expect-error issues is a readonly array.
      diagnostics.issues.push("UNSAFE");
    };

    expectTypeOf(assertReadonly).toBeFunction();
  });
});
