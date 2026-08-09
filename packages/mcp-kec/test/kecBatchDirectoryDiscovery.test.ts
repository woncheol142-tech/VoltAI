import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  captureErrorMessage,
  directoryDiscoveryPath,
  directoryErrors,
  loadDirectoryDiscoveryModule,
  withDirectoryFixture,
} from "./helpers/kecBatchDirectoryFixture.js";

describe("Task 59 non-recursive directory validation and discovery", () => {
  it("is RED until the package-local discovery module exists", () => {
    expect(existsSync(directoryDiscoveryPath)).toBe(true);
  });

  it("accepts one valid project-relative real directory", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      expect(
        discoverKecBatchDirectory(fixture.projectRoot, {
          directory: fixture.directoryRelativePath,
        }),
      ).toEqual({ sources: ["manuals/a.pdf"] });
    });
  });

  it.each([
    ["absolute", (root: string) => join(root, "manuals")],
    ["parent traversal", () => "../outside"],
    ["embedded traversal", () => "manuals/../../outside"],
    ["option-like input", () => "--recursive"],
  ])(
    "rejects %s as INVALID_DIRECTORY or INVALID_ARGUMENT",
    async (kind, input) => {
      if (!existsSync(directoryDiscoveryPath)) return;
      await withDirectoryFixture(async (fixture) => {
        const { discoverKecBatchDirectory } =
          await loadDirectoryDiscoveryModule();
        const message = captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, {
            directory: input(fixture.projectRoot),
          }),
        );
        expect(message).toBe(
          kind === "option-like input"
            ? directoryErrors.invalidArgument
            : directoryErrors.invalidDirectory,
        );
      });
    },
  );

  it("rejects a missing path and a regular file supplied as the directory", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const file = "not-a-directory.pdf";
      fixture.writeProjectFile(file);
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      for (const directory of ["missing", file]) {
        expect(
          captureErrorMessage(() =>
            discoverKecBatchDirectory(fixture.projectRoot, { directory }),
          ),
        ).toBe(directoryErrors.invalidDirectory);
      }
    });
  });

  it("rejects a directory symlink even when its target stays inside the project", async (context) => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      const link = fixture.tryCreateDirectorySymlink(
        fixture.directoryAbsolutePath,
        "manual-alias",
      );
      if (!link.supported) {
        context.skip(
          "native directory symlinks are unsupported on this platform",
        );
        return;
      }
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, {
            directory: "manual-alias",
          }),
        ),
      ).toBe(directoryErrors.invalidDirectory);
    });
  });

  it("requires realpath confinement independently of lexical resolution", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const dependencies = Object.freeze({
        lstat: () => Object.freeze({ kind: "directory" as const }),
        realpath: () => fixture.outsideRoot,
        readDirectory: () => Object.freeze([]),
      });
      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(
            fixture.projectRoot,
            { directory: "manuals" },
            dependencies,
          ),
        ),
      ).toBe(directoryErrors.invalidDirectory);
    });
  });

  it("discovers only direct lowercase .pdf regular files in deterministic lexical order", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/z.pdf");
      fixture.writeProjectFile("manuals/a.pdf");
      fixture.writeProjectFile("manuals/m.pdf");
      fixture.writeProjectFile("manuals/UPPER.PDF");
      fixture.writeProjectFile("manuals/notes.txt");
      fixture.writeProjectFile("manuals/nested/hidden.pdf");
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const first = discoverKecBatchDirectory(fixture.projectRoot, {
        directory: "manuals",
      });
      const second = discoverKecBatchDirectory(fixture.projectRoot, {
        directory: "manuals",
      });

      expect(first.sources).toEqual([
        "manuals/a.pdf",
        "manuals/m.pdf",
        "manuals/z.pdf",
      ]);
      expect(second).toEqual(first);
      expect(first.sources).not.toContain("manuals/nested/hidden.pdf");
      expect(first.sources).not.toContain("manuals/UPPER.PDF");
      expect(first.sources).not.toContain("manuals/notes.txt");
    });
  });

  it("rejects an otherwise valid empty directory as NO_SOURCES", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/UPPER.PDF");
      fixture.writeProjectFile("manuals/notes.txt");
      fixture.writeProjectFile("manuals/nested/hidden.pdf");
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, {
            directory: "manuals",
          }),
        ),
      ).toBe(directoryErrors.noSources);
    });
  });

  it("ignores an exact .pdf basename while accepting only non-empty lowercase PDF basenames", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/.pdf");
      fixture.writeProjectFile("manuals/a.pdf");
      fixture.writeProjectFile("manuals/a.PDF");
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();

      expect(
        discoverKecBatchDirectory(fixture.projectRoot, {
          directory: "manuals",
        }),
      ).toEqual({ sources: ["manuals/a.pdf"] });
    });
  });

  it("reports NO_SOURCES when exact .pdf is the only direct entry", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/.pdf");
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();

      expect(
        captureErrorMessage(() =>
          discoverKecBatchDirectory(fixture.projectRoot, {
            directory: "manuals",
          }),
        ),
      ).toBe(directoryErrors.noSources);
    });
  });

  it("adds no arbitrary 100-source cap", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      for (let index = 0; index < 101; index += 1) {
        fixture.writeProjectFile(
          `manuals/source-${String(index).padStart(3, "0")}.pdf`,
          "",
        );
      }
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const result = discoverKecBatchDirectory(fixture.projectRoot, {
        directory: "manuals",
      });
      expect(result.sources).toHaveLength(101);
      expect(result.sources[0]).toBe("manuals/source-000.pdf");
      expect(result.sources[100]).toBe("manuals/source-100.pdf");
    });
  });

  it("returns a new deeply frozen public result without mutating caller input", async () => {
    if (!existsSync(directoryDiscoveryPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      const request = Object.freeze({ directory: "manuals" });
      const before = Object.getOwnPropertyDescriptors(request);
      const { discoverKecBatchDirectory } =
        await loadDirectoryDiscoveryModule();
      const result = discoverKecBatchDirectory(fixture.projectRoot, request);

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.sources)).toBe(true);
      expect(result).not.toBe(request);
      expect(Object.getOwnPropertyDescriptors(request)).toEqual(before);
    });
  });
});
