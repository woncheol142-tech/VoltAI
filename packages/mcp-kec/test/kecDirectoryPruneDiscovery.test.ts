import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { discoverKecBatchDirectory } from "../src/directoryBatchIndexing/index.js";

import {
  captureErrorMessage,
  loadDirectoryPruningModule,
  pruneBarrelPath,
  pruneErrors,
  task60ModulesExist,
  withPruneFixture,
} from "./helpers/kecDirectoryPruneFixture.js";

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

describe("Task 60 secure reusable directory discovery", () => {
  it("is RED until the package-local Task 60 discovery contract exists", () => {
    expect(
      existsSync(pruneBarrelPath),
      "missing Task 60 directoryPruning/index.ts",
    ).toBe(true);
  });

  it("returns canonical directory scope and only direct lowercase PDF sources", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      fixture.writeProjectFile("manuals/.hidden.pdf");
      fixture.writeProjectFile("manuals/.pdf");
      fixture.writeProjectFile("manuals/UPPER.PDF");
      fixture.writeProjectFile("manuals/Mixed.Pdf");
      fixture.writeProjectFile("manuals/notes.txt");
      fixture.writeProjectFile("manuals/nested/ignored.pdf");
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();

      expect(
        discoverKecDirectoryPruneScope(fixture.projectRoot, {
          directory: "manuals",
        }),
      ).toEqual({
        directoryPath: "manuals",
        sources: ["manuals/.hidden.pdf", "manuals/a.pdf"],
      });
    });
  });

  it("preserves Task 59 public discovery output while adding only internal scope information", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      const task59 = discoverKecBatchDirectory(fixture.projectRoot, {
        directory: "manuals",
      });
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      const task60 = discoverKecDirectoryPruneScope(fixture.projectRoot, {
        directory: "manuals",
      });

      expect(task59).toEqual({ sources: ["manuals/a.pdf"] });
      expect(Object.keys(task59)).toEqual(["sources"]);
      expect(task60).toEqual({
        directoryPath: "manuals",
        sources: task59.sources,
      });
    });
  });

  it.each([
    "",
    "/absolute",
    "../escape",
    "a/../b",
    "a//b",
    "./a",
    "a/./b",
    "a\\b",
    "a\0b",
  ])(
    "rejects unsafe directory spelling %j without coercion",
    async (directory) => {
      if (!task60ModulesExist()) return;
      await withPruneFixture(async (fixture) => {
        const { discoverKecDirectoryPruneScope } =
          await loadDirectoryPruningModule();
        const message = captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(fixture.projectRoot, { directory }),
        );
        expect([
          pruneErrors.invalidArgument,
          pruneErrors.invalidDirectory,
        ]).toContain(message);
      });
    },
  );

  it("allows directory dot and gives it direct-root ownership scope", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      fixture.writeProjectFile("root.pdf");
      fixture.writeProjectFile("nested/ignored.pdf");
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      expect(
        discoverKecDirectoryPruneScope(fixture.projectRoot, { directory: "." }),
      ).toEqual({ directoryPath: ".", sources: ["root.pdf"] });
    });
  });

  it("keeps Task 59 NO_SOURCES safety and reaches no runtime authority", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/UPPER.PDF");
      fixture.writeProjectFile("manuals/.pdf");
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      expect(
        captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(fixture.projectRoot, {
            directory: "manuals",
          }),
        ),
      ).toBe(pruneErrors.noSources);
      expect(existsSync(fixture.databasePath)).toBe(false);
    });
  });

  it("rejects native directory and PDF symlinks", async (context) => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      const regular = fixture.writeProjectFile("manuals/regular.pdf");
      const directoryAlias = fixture.tryCreateDirectorySymlink(
        fixture.directoryAbsolutePath,
        "manual-alias",
      );
      const sourceAlias = fixture.tryCreateFileSymlink(
        regular,
        "manuals/alias.pdf",
      );
      if (!directoryAlias.supported || !sourceAlias.supported) {
        context.skip("native symlink creation is unsupported on this platform");
        return;
      }
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      expect(
        captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(fixture.projectRoot, {
            directory: "manual-alias",
          }),
        ),
      ).toBe(pruneErrors.invalidDirectory);
      expect(
        captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(fixture.projectRoot, {
            directory: "manuals",
          }),
        ),
      ).toBe(pruneErrors.invalidSource);
    });
  });

  it("has platform-independent injected symlink and non-regular rejection", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      const directoryPath = join(fixture.projectRoot, "manuals");
      const sourcePath = join(directoryPath, "candidate.pdf");

      for (const candidateKind of ["symlink", "other"] as const) {
        const message = captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(
            fixture.projectRoot,
            { directory: "manuals" },
            Object.freeze({
              lstat: (path: string) =>
                path === directoryPath
                  ? pathState("directory")
                  : path === sourcePath
                    ? pathState(candidateKind)
                    : (() => {
                        throw new Error("unexpected path");
                      })(),
              realpath: (path: string) => path,
              readDirectory: () => Object.freeze(["candidate.pdf"]),
            }),
          ),
        );
        expect(message).toBe(pruneErrors.invalidSource);
      }
    });
  });

  it("rejects a native PDF-named FIFO", async (context) => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      const fifoPath = join(fixture.directoryAbsolutePath, "pipe.pdf");
      const created = spawnSync("mkfifo", [fifoPath], {
        encoding: "utf8",
        timeout: 5_000,
      });
      if (created.error !== undefined || created.status !== 0) {
        context.skip("native FIFO creation is unsupported on this platform");
        return;
      }
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      expect(
        captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(fixture.projectRoot, {
            directory: "manuals",
          }),
        ),
      ).toBe(pruneErrors.invalidSource);
    });
  });

  it("fails closed on realpath root escape", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      const lexicalDirectory = join(fixture.projectRoot, "manuals");
      const outside = join(fixture.outsideRoot, "escaped");
      const message = captureErrorMessage(() =>
        discoverKecDirectoryPruneScope(
          fixture.projectRoot,
          { directory: "manuals" },
          Object.freeze({
            lstat: () => pathState("directory"),
            realpath: (path: string) =>
              path === lexicalDirectory ? outside : path,
            readDirectory: () => Object.freeze([]),
          }),
        ),
      );
      expect(isAbsolute(outside)).toBe(true);
      expect(message).toBe(pruneErrors.invalidDirectory);
    });
  });

  it("fails closed when directory device/inode changes after enumeration", async () => {
    if (!task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      const directoryPath = join(fixture.projectRoot, "manuals");
      const sourcePath = join(directoryPath, "a.pdf");
      let directoryChecks = 0;
      const lstat = vi.fn((path: string) => {
        if (path === directoryPath) {
          directoryChecks += 1;
          return pathState("directory", 1n, directoryChecks === 1 ? 10n : 20n);
        }
        if (path === sourcePath) return pathState("file", 1n, 11n);
        throw new Error("unexpected path");
      });
      const { discoverKecDirectoryPruneScope } =
        await loadDirectoryPruningModule();
      expect(
        captureErrorMessage(() =>
          discoverKecDirectoryPruneScope(
            fixture.projectRoot,
            { directory: "manuals" },
            Object.freeze({
              lstat,
              realpath: (path: string) => path,
              readDirectory: () => Object.freeze(["a.pdf"]),
            }),
          ),
        ),
      ).toBe(pruneErrors.discoveryFailed);
      expect(directoryChecks).toBe(2);
    });
  });
});
