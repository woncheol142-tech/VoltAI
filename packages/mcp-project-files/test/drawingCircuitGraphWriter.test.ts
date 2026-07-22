import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { serializeCircuitGraphDocument } from "../src/drawingCircuitGraph/serializeCircuitGraphDocument.js";
import { writeCircuitGraphDocument } from "../src/drawingCircuitGraph/writeCircuitGraphDocument.js";
import {
  deepFreezeCircuitFixture,
  makeCircuitGraphDocument,
} from "./helpers/drawingCircuitGraphFixture.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-circuit-graph-test-"));
  roots.push(root);
  return root;
}

describe("circuit graph atomic writer", () => {
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("writes deterministic serializer bytes to a deterministic schema path", () => {
    const root = tempRoot();
    const document = makeCircuitGraphDocument();
    const firstPath = writeCircuitGraphDocument(root, document, "회로 그래프");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeCircuitGraphDocument(
      root,
      structuredClone(document),
      "회로 그래프",
    );
    const secondBytes = readFileSync(join(root, secondPath));
    const nameHash = createHash("sha256")
      .update("회로 그래프", "utf8")
      .digest("hex")
      .slice(0, 8);
    expect(firstPath).toBe(
      `.volt-ai/circuit-graphs/회로_그래프-${nameHash}-${document.sourceSha256.slice(0, 12)}-page-015-${document.graphId.slice(4, 16)}.json`,
    );
    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.toString("utf8")).toBe(
      serializeCircuitGraphDocument(document),
    );
  });

  it.each([
    "",
    "   ",
    ".hidden",
    "../escape",
    "nested/name",
    "nested\\name",
    "/absolute",
  ])("rejects unsafe outputName %j", (outputName) => {
    expect(() =>
      writeCircuitGraphDocument(
        tempRoot(),
        makeCircuitGraphDocument(),
        outputName,
      ),
    ).toThrow(/outputName|hidden|separator|path/i);
  });

  it("rejects an unsafe outputName before creating persistence directories", () => {
    const root = tempRoot();
    expect(() =>
      writeCircuitGraphDocument(root, makeCircuitGraphDocument(), "../escape"),
    ).toThrow(/outputName|separator|path/i);
    expect(readdirSync(root)).toEqual([]);
  });

  it("prevents sanitized-name collisions", () => {
    const root = tempRoot();
    const document = makeCircuitGraphDocument();
    const first = writeCircuitGraphDocument(root, document, "A:B");
    const second = writeCircuitGraphDocument(root, document, "A?B");
    expect(first).not.toBe(second);
  });

  it("rejects parent and target symlinks", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const document = makeCircuitGraphDocument();
    symlinkSync(outside, join(root, ".volt-ai"));
    expect(() => writeCircuitGraphDocument(root, document, "graph")).toThrow(
      /symbolic/i,
    );

    rmSync(join(root, ".volt-ai"));
    const target = writeCircuitGraphDocument(root, document, "graph");
    const absolute = join(root, target);
    const outsideFile = join(outside, "outside.json");
    writeFileSync(outsideFile, "{}\n");
    rmSync(absolute);
    symlinkSync(outsideFile, absolute);
    expect(() => writeCircuitGraphDocument(root, document, "graph")).toThrow(
      /symbolic/i,
    );
  });

  it("atomically replaces regular files and cleans temporary files", () => {
    const root = tempRoot();
    const document = makeCircuitGraphDocument();
    const target = writeCircuitGraphDocument(root, document, "graph");
    const absolute = join(root, target);
    writeFileSync(absolute, "stale\n");
    expect(writeCircuitGraphDocument(root, document, "graph")).toBe(target);
    expect(readFileSync(absolute, "utf8")).not.toBe("stale\n");
    expect(
      readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("cleans temporary files after a target failure", () => {
    const root = tempRoot();
    const document = makeCircuitGraphDocument();
    const target = writeCircuitGraphDocument(root, document, "graph");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);
    expect(() => writeCircuitGraphDocument(root, document, "graph")).toThrow(
      /regular|file/i,
    );
    expect(
      readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("validates before creating output and does not mutate frozen input", () => {
    const invalidRoot = tempRoot();
    const invalid = makeCircuitGraphDocument();
    invalid.nodeCount += 1;
    expect(() =>
      writeCircuitGraphDocument(invalidRoot, invalid, "graph"),
    ).toThrow(/count|node/i);
    expect(readdirSync(invalidRoot)).toEqual([]);

    const root = tempRoot();
    const document = makeCircuitGraphDocument();
    const before = structuredClone(document);
    deepFreezeCircuitFixture(document);
    const target = writeCircuitGraphDocument(root, document, "graph");
    expect(existsSync(join(root, target))).toBe(true);
    expect(document).toEqual(before);
  });
});
