import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  approvedDirectoryErrors,
  assertNoTask59Artifacts,
  captureErrorMessage,
  createHostileValue,
  createKecBatchDirectoryFixture,
  directoryBarrelPath,
  directoryDiscoveryPath,
  directoryErrors,
  directoryTypesPath,
  loadDirectoryDiscoveryModule,
  withDirectoryFixture,
} from "./helpers/kecBatchDirectoryFixture.js";

function pathState(
  kind: "directory" | "file" | "symlink" | "other",
  device = 1n,
  inode = 1n,
) {
  return Object.freeze({
    kind,
    identity: Object.freeze({ device, inode }),
  });
}

describe("Task 59 source and directory security boundaries", () => {
  it("is RED until the discovery security boundary exists", () => {
    expect(existsSync(directoryDiscoveryPath)).toBe(true);
  });

  it("accepts a direct regular .pdf and rejects both in-root and escaping .pdf symlinks", async (context) => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const regular = fixture.writeProjectFile("manuals/regular.pdf");
      const outside = fixture.writeOutsideFile("outside.pdf");
      const alias = fixture.tryCreateFileSymlink(regular, "manuals/alias.pdf");
      const escape = fixture.tryCreateFileSymlink(
        outside,
        "manuals/escape.pdf",
      );
      if (!alias.supported || !escape.supported) {
        context.skip("native file symlinks are unsupported on this platform");
        return;
      }
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const message = captureErrorMessage(() =>
        discoverKecBatchDirectory(fixture.projectRoot, {
          directory: "manuals",
        }),
      );
      expect(message).toBe(directoryErrors.invalidSource);
      for (const secret of [regular, outside, "alias.pdf", "escape.pdf"]) {
        expect(message).not.toContain(secret);
      }
    });
  });

  it("rejects a safely constructible non-regular lowercase .pdf candidate", async (context) => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const fifoPath = join(fixture.directoryAbsolutePath, "pipe.pdf");
      const created = spawnSync("mkfifo", [fifoPath], {
        encoding: "utf8",
        timeout: 5_000,
      });
      if (created.error !== undefined || created.status !== 0) {
        context.skip("native FIFO creation is unsupported on this platform");
        return;
      }
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, {
            directory: "manuals",
          }),
        ),
      ).toBe(directoryErrors.invalidSource);
    });
  });

  it("keeps injected missing, non-directory, and directory-symlink states as validation failures", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const secret = join(fixture.projectRoot, "manuals-private");
      const makeError = (code: string) =>
        Object.assign(new Error(`${code}: cannot inspect ${secret}`), { code });
      const validationCases = [
        () => {
          throw makeError("ENOENT");
        },
        () => Object.freeze({ kind: "file" as const }),
        () => Object.freeze({ kind: "symlink" as const }),
      ];

      for (const lstat of validationCases) {
        const message = captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals-private" },
            Object.freeze({
              lstat,
              realpath: (path: string) => path,
              readDirectory: () => Object.freeze([]),
            }),
          ),
        );
        expect(message).toBe(directoryErrors.invalidDirectory);
        expect(message).not.toContain(secret);
      }
    });
  });

  it.each(["EACCES", "EIO"])(
    "maps an injected directory %s lstat failure to redacted DISCOVERY_FAILED",
    async (code) => {
      if (!existsSync(directoryDiscoveryPath)) return;
      await withDirectoryFixture(async (fixture) => {
        const { discoverKecBatchDirectory } =
          await loadDirectoryDiscoveryModule();
        const secret = join(fixture.projectRoot, "manuals-private");
        const error = Object.assign(
          new Error(`${code}: cannot inspect ${secret}`),
          { code },
        );
        const message = captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals-private" },
            Object.freeze({
              lstat: () => {
                throw error;
              },
              realpath: (path: string) => path,
              readDirectory: () => Object.freeze([]),
            }),
          ),
        );

        expect(message).not.toContain(secret);
        expect(message).not.toContain(code);
        expect(approvedDirectoryErrors).toContain(message);
        expect(message).toBe(directoryErrors.discoveryFailed);
      });
    },
  );

  it("always rejects injected directory, PDF-symlink, and non-regular PDF path kinds", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const directoryPath = join(fixture.projectRoot, "manuals");
      const sourcePath = join(directoryPath, "candidate.pdf");

      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals" },
            Object.freeze({
              lstat: () => Object.freeze({ kind: "symlink" as const }),
              realpath: (path: string) => path,
              readDirectory: () => Object.freeze([]),
            }),
          ),
        ),
      ).toBe(directoryErrors.invalidDirectory);

      for (const candidateKind of ["symlink", "other"] as const) {
        const message = captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals" },
            Object.freeze({
              lstat: (path: string) => {
                if (path === directoryPath) {
                  return Object.freeze({ kind: "directory" as const });
                }
                if (path === sourcePath) {
                  return Object.freeze({ kind: candidateKind });
                }
                throw new Error("unexpected path");
              },
              realpath: (path: string) => path,
              readDirectory: () => Object.freeze(["candidate.pdf"]),
            }),
          ),
        );
        expect(message).toBe(directoryErrors.invalidSource);
      }
    });
  });

  it("enumerates and inspects sources through the verified canonical directory", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const lexicalDirectory = join(fixture.projectRoot, "manuals");
      const canonicalDirectory = join(fixture.projectRoot, "canonical-manuals");
      const canonicalSource = join(canonicalDirectory, "a.pdf");
      const readDirectory = vi.fn((path: string) => {
        if (path !== canonicalDirectory) {
          throw new Error(`enumerated unverified lexical path: ${path}`);
        }
        return Object.freeze(["a.pdf"]);
      });
      const dependencies = Object.freeze({
        lstat: vi.fn((path: string) => {
          if (path === lexicalDirectory || path === canonicalDirectory) {
            return Object.freeze({ kind: "directory" as const });
          }
          if (path === canonicalSource) {
            return Object.freeze({ kind: "file" as const });
          }
          throw new Error("unexpected path");
        }),
        realpath: vi.fn((path: string) =>
          path === lexicalDirectory ? canonicalDirectory : path,
        ),
        readDirectory,
      });

      let result: Readonly<{ sources: readonly string[] }> | undefined;
      let message: string | undefined;
      try {
        result = discoverKecBatchDirectory(
          fixture.projectRoot,
          { directory: "manuals" },
          dependencies,
        );
      } catch (error) {
        message = error instanceof Error ? error.message : "unknown";
      }

      expect(readDirectory).toHaveBeenCalledTimes(1);
      expect(readDirectory).toHaveBeenCalledWith(canonicalDirectory);
      expect(dependencies.lstat).toHaveBeenCalledWith(canonicalSource);
      expect(message).toBeUndefined();
      expect(result).toEqual({ sources: ["canonical-manuals/a.pdf"] });
    });
  });

  it.each([
    ["different device/inode", pathState("directory", 2n, 20n)],
    ["symlink replacement", pathState("symlink", 1n, 10n)],
  ])(
    "fails closed when the verified directory becomes a %s",
    async (_case, replacement) => {
      if (!existsSync(directoryDiscoveryPath)) return;
      await withDirectoryFixture(async (fixture) => {
        const { discoverKecBatchDirectory } =
          await loadDirectoryDiscoveryModule();
        const directoryPath = join(fixture.projectRoot, "manuals");
        const sourcePath = join(directoryPath, "a.pdf");
        let directoryChecks = 0;
        const readDirectory = vi.fn(() => Object.freeze(["a.pdf"]));
        const lstat = vi.fn((path: string) => {
          if (path === directoryPath) {
            directoryChecks += 1;
            return directoryChecks === 1
              ? pathState("directory", 1n, 10n)
              : replacement;
          }
          if (path === sourcePath) return pathState("file", 1n, 11n);
          throw new Error("unexpected path");
        });

        const message = captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals" },
            Object.freeze({
              lstat,
              realpath: (path: string) => path,
              readDirectory,
            }),
          ),
        );

        expect(message).toBe(directoryErrors.discoveryFailed);
        expect(readDirectory).toHaveBeenCalledTimes(1);
        expect(lstat).toHaveBeenCalledWith(sourcePath);
        expect(directoryChecks).toBe(2);
      });
    },
  );

  it("does not execute request accessors or hostile coercion hooks", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      let getterCalls = 0;
      const accessor = {};
      Object.defineProperty(accessor, "directory", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return "manuals";
        },
      });
      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, accessor),
        ),
      ).toBe(directoryErrors.invalidArgument);

      const counter = { count: 0 };
      const hostile = createHostileValue(counter);
      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, {
            directory: hostile,
          }),
        ),
      ).toBe(directoryErrors.invalidArgument);
      expect(getterCalls).toBe(0);
      expect(counter.count).toBe(0);
    });
  });

  it("never inspects non-PDF or nested children and never performs a recursive walk", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const calls: string[] = [];
      const directoryPath = join(fixture.projectRoot, "manuals");
      const pdfPath = join(directoryPath, "direct.pdf");
      const dependencies = Object.freeze({
        lstat: vi.fn((path: string) => {
          calls.push(`lstat:${path}`);
          if (path === directoryPath) {
            return Object.freeze({ kind: "directory" as const });
          }
          if (path === pdfPath) {
            return Object.freeze({ kind: "file" as const });
          }
          throw new Error("unexpected recursive or ignored-entry stat");
        }),
        realpath: vi.fn((path: string) => {
          calls.push(`realpath:${path}`);
          return path;
        }),
        readDirectory: vi.fn((path: string) => {
          calls.push(`readDirectory:${path}`);
          return Object.freeze([
            "nested",
            "ignore.txt",
            "UPPER.PDF",
            "direct.pdf",
          ]);
        }),
      });
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      expect(
        discoverKecBatchDirectory(
          fixture.projectRoot,
          { directory: "manuals" },
          dependencies,
        ),
      ).toEqual({ sources: ["manuals/direct.pdf"] });
      expect(dependencies.readDirectory).toHaveBeenCalledTimes(1);
      expect(calls.filter((call) => call.startsWith("lstat:"))).toHaveLength(2);
      expect(calls.join("\n")).not.toContain("ignore.txt");
      expect(calls.join("\n")).not.toContain("UPPER.PDF");
      expect(calls.join("\n")).not.toContain("nested/");
    });
  });

  it("normalizes bounded enumeration and stat failures without path leakage", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const secret = join(fixture.projectRoot, "manuals", "secret.pdf");
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const base = {
        lstat: () => Object.freeze({ kind: "directory" as const }),
        realpath: (path: string) => path,
        readDirectory: () => Object.freeze(["secret.pdf"]),
      };
      const cases = [
        Object.freeze({
          ...base,
          readDirectory: () => {
            throw new Error(`EACCES ${secret}`);
          },
        }),
        Object.freeze({
          ...base,
          lstat: vi
            .fn()
            .mockReturnValueOnce(Object.freeze({ kind: "directory" as const }))
            .mockImplementationOnce(() => {
              throw new Error(`EIO ${secret}`);
            }),
        }),
      ];
      for (const dependencies of cases) {
        const message = captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals" },
            dependencies,
          ),
        );
        expect(message).toBe(directoryErrors.discoveryFailed);
        expect(message).not.toContain(secret);
        expect(approvedDirectoryErrors).toContain(message);
      }
    });
  });

  it("keeps discovery free of deletion, database, provider, parser, indexing, process, and network authority", () => {
    for (const path of [
      directoryTypesPath,
      directoryDiscoveryPath,
      directoryBarrelPath,
    ]) {
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(
        /\brm(?:Sync)?\b|\bunlink(?:Sync)?\b|\brmdir(?:Sync)?\b|\bremove\b|node:sqlite|Sqlite|VectorStore|EmbeddingProvider|createEmbeddingProvider|indexKec|readPdf|pdfjs|fetch\s*\(|XMLHttpRequest|WebSocket|child_process|process\.(?:exit|stdout|stderr)/iu,
      );
      expect(source).not.toMatch(
        /recursive\s*:\s*true|readdir[^\n]*recursive/iu,
      );
    }
  });

  it("cleans only the fixture-owned OS-temp root", () => {
    const fixture = createKecBatchDirectoryFixture();
    const sibling = join(
      dirname(fixture.fixtureRoot),
      `${basename(fixture.fixtureRoot)}-outside-sentinel`,
    );
    writeFileSync(sibling, "preserve", "utf8");
    try {
      fixture.writeProjectFile("manuals/a.pdf");
      fixture.cleanup();
      expect(existsSync(fixture.fixtureRoot)).toBe(false);
      expect(readFileSync(sibling, "utf8")).toBe("preserve");
    } finally {
      rmSync(sibling, { force: true });
      fixture.cleanup();
    }
  });

  it("leaves no SQLite, WAL, SHM, parser, or test-build residue in fixtures", async () => {
    await withDirectoryFixture((fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      assertNoTask59Artifacts(fixture.fixtureRoot);
    });
  });
});
