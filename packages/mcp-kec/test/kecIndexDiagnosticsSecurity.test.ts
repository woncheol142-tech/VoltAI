import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inspectKecIndex,
  serializeKecIndexDiagnostics,
} from "../src/indexDiagnostics/index.js";
import {
  createCorruptDatabaseFixture,
  createDirectoryPathFixture,
  createLockedDatabaseFixture,
  createMissingDatabaseFixture,
  createMultipleSourcesIndexFixture,
  createReadyIndexFixture,
  createSymlinkFixture,
  DatabaseSync,
  firstSourcePath,
  readDatabaseBytes,
  secondSourcePath,
  snapshotArtifacts,
  type KecIndexDiagnosticsFixture,
} from "./helpers/kecIndexDiagnosticsFixture.js";

const fixtures: KecIndexDiagnosticsFixture[] = [];

function useFixture<T extends KecIndexDiagnosticsFixture>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

async function captureError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  return undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();

  for (const fixture of fixtures.splice(0).reverse()) {
    fixture.cleanup();
  }
});

describe("KEC index diagnostics input and path security", () => {
  it.each([
    ["empty string", ""],
    ["relative path", "relative/index.sqlite"],
    ["NUL path", "/tmp/unsafe\0index.sqlite"],
    ["boxed string", new String("/tmp/index.sqlite")],
  ])(
    "rejects %s with the deterministic configuration prefix",
    async (_name, value) => {
      const error = await captureError(() => inspectKecIndex(value as string));

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION",
      );
    },
  );

  it("does not coerce a hostile path object", async () => {
    let coercions = 0;
    const sentinel = "hostile-path-coercion-sentinel";
    const hostile = {
      toString: () => {
        coercions += 1;
        throw new Error(sentinel);
      },
      valueOf: () => {
        coercions += 1;
        throw new Error(sentinel);
      },
      [Symbol.toPrimitive]: () => {
        coercions += 1;
        throw new Error(sentinel);
      },
    };

    const error = await captureError(() =>
      inspectKecIndex(hostile as unknown as string),
    );

    expect(coercions).toBe(0);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION",
    );
    expect((error as Error).message).not.toContain(sentinel);
  });

  it.each([
    ["final-component symlink", createSymlinkFixture],
    ["directory", createDirectoryPathFixture],
  ])(
    "rejects an existing %s before SQLite inspection",
    async (_name, factory) => {
      const fixture = useFixture(factory());
      const before = snapshotArtifacts(fixture.databasePath);
      const error = await captureError(() =>
        inspectKecIndex(fixture.databasePath),
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "KEC_INDEX_DIAGNOSTICS: UNSAFE_DATABASE_PATH",
      );
      expect((error as Error).message).not.toContain(fixture.databasePath);
      expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
    },
  );
});

describe("KEC index diagnostics read-only and redaction security", () => {
  it("does not create a missing parent, database, or SQLite sibling artifact", async () => {
    const fixture = useFixture(createMissingDatabaseFixture(false));
    const before = snapshotArtifacts(fixture.databasePath);

    await expect(inspectKecIndex(fixture.databasePath)).resolves.toMatchObject({
      status: "MISSING_DATABASE",
      databaseExists: false,
    });

    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
  });

  it("does not change an existing database or create WAL, SHM, or journal files", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const before = snapshotArtifacts(fixture.databasePath);
    const bytesBefore = readDatabaseBytes(fixture.databasePath);

    await inspectKecIndex(fixture.databasePath);

    expect(readDatabaseBytes(fixture.databasePath)).toEqual(bytesBefore);
    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
  });

  it("does not expose paths, endpoints, environment values, keys, text, clauses, or vectors", async () => {
    const fixture = useFixture(createMultipleSourcesIndexFixture());
    const secrets = [
      fixture.databasePath,
      fixture.databasePath.split("/").at(-1) ?? "index.sqlite",
      firstSourcePath,
      secondSourcePath,
      "http://private-ollama.example:11434",
      "environment-value-sentinel",
      "api-key-sentinel",
      "KEC deterministic diagnostic fixture text.",
      "KEC 232.5",
      "0.1,0.2,0.3",
    ];
    vi.stubEnv("KEC_DB_PATH", secrets[5]);
    vi.stubEnv("PROJECT_ROOT", secrets[5]);
    vi.stubEnv("OLLAMA_BASE_URL", secrets[4]);
    vi.stubEnv("OPENAI_API_KEY", secrets[6]);

    const serialized = serializeKecIndexDiagnostics(
      await inspectKecIndex(fixture.databasePath),
    );

    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("does not contact network, log, or start transport while inspecting", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const fetchMock = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await inspectKecIndex(fixture.databasePath);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("returns independent frozen results for concurrent calls without a cache", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const results = await Promise.all(
      Array.from({ length: 20 }, () => inspectKecIndex(fixture.databasePath)),
    );

    expect(results).toHaveLength(20);
    expect(new Set(results).size).toBe(20);
    expect(results.every(Object.isFrozen)).toBe(true);
    expect(results.slice(1).every((result) => result !== results[0])).toBe(
      true,
    );
    expect(
      results.every(
        (result) => JSON.stringify(result) === JSON.stringify(results[0]),
      ),
    ).toBe(true);
  });
});

describe("KEC index diagnostics database errors and lifecycle", () => {
  it("redacts corrupt SQLite failures and leaves corrupt bytes unchanged", async () => {
    const fixture = useFixture(createCorruptDatabaseFixture());
    const before = snapshotArtifacts(fixture.databasePath);
    const bytesBefore = readDatabaseBytes(fixture.databasePath);

    const error = await captureError(() =>
      inspectKecIndex(fixture.databasePath),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "KEC_INDEX_DIAGNOSTICS: DATABASE_INVALID",
    );
    expect((error as Error).message).not.toContain(fixture.databasePath);
    expect((error as Error).message).not.toContain("not-a-sqlite-database");
    expect(readDatabaseBytes(fixture.databasePath)).toEqual(bytesBefore);
    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
  });

  it("classifies a deterministic SQLite lock as DATABASE_UNAVAILABLE without mutation", async () => {
    const fixture = useFixture(createLockedDatabaseFixture());
    const before = snapshotArtifacts(fixture.databasePath);

    const error = await captureError(() =>
      inspectKecIndex(fixture.databasePath),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "KEC_INDEX_DIAGNOSTICS: DATABASE_UNAVAILABLE",
    );
    expect((error as Error).message).not.toContain("database is locked");
    expect((error as Error).message).not.toContain(fixture.databasePath);
    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
  });

  it("closes the owned read-only connection exactly once after success", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const close = vi.spyOn(DatabaseSync.prototype, "close");

    await inspectKecIndex(fixture.databasePath);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes exactly once after an inspection failure that occurs after open", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const prepare = vi
      .spyOn(DatabaseSync.prototype, "prepare")
      .mockImplementation(() => {
        throw new Error("primary-inspection-sentinel");
      });
    const close = vi.spyOn(DatabaseSync.prototype, "close");

    const error = await captureError(() =>
      inspectKecIndex(fixture.databasePath),
    );

    expect(prepare).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "KEC_INDEX_DIAGNOSTICS: DATABASE_INVALID",
    );
  });

  it("preserves the primary inspection classification when close also fails", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const originalClose = DatabaseSync.prototype.close;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(() => {
      throw new Error("primary-inspection-sentinel");
    });
    const close = vi
      .spyOn(DatabaseSync.prototype, "close")
      .mockImplementation(function () {
        originalClose.call(this);
        throw new Error("close-failure-sentinel");
      });

    const error = await captureError(() =>
      inspectKecIndex(fixture.databasePath),
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "KEC_INDEX_DIAGNOSTICS: DATABASE_INVALID",
    );
    expect((error as Error).message).not.toContain("close-failure-sentinel");
  });

  it("reports a lone close failure as DATABASE_UNAVAILABLE", async () => {
    const fixture = useFixture(createReadyIndexFixture());
    const originalClose = DatabaseSync.prototype.close;
    const close = vi
      .spyOn(DatabaseSync.prototype, "close")
      .mockImplementation(function () {
        originalClose.call(this);
        throw new Error("close-failure-sentinel");
      });

    const error = await captureError(() =>
      inspectKecIndex(fixture.databasePath),
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "KEC_INDEX_DIAGNOSTICS: DATABASE_UNAVAILABLE",
    );
    expect((error as Error).message).not.toContain("close-failure-sentinel");
  });
});
