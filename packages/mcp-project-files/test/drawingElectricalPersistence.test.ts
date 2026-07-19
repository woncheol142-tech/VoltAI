import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  importElectricalModule,
  makeElectricalObjectDocument,
} from "./helpers/drawingElectricalObjectsFixture.js";

type PersistenceModule = {
  writeElectricalObjects(
    projectRoot: string,
    document: unknown,
    outputName: string,
  ): string;
};

const roots: string[] = [];

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

async function load() {
  return importElectricalModule<PersistenceModule>("writeElectricalObjects");
}

describe("drawing electrical object persistence", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes deterministic compact UTF-8 bytes to the schema path", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const document = makeElectricalObjectDocument();
    document.source = "docs/전기 객체.pdf";
    document.warnings = ["한글 경고"];
    document.statistics.warningCount = 1;
    const sourceHash = createHash("sha256")
      .update(document.source, "utf8")
      .digest("hex")
      .slice(0, 12);
    const firstPath = writeElectricalObjects(root, document, "전기 객체");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeElectricalObjects(root, structuredClone(document), "전기 객체");
    const secondBytes = readFileSync(join(root, secondPath));
    expect(firstPath).toBe(
      `.volt-ai/electrical-objects/전기_객체-${sourceHash}-page-015.json`,
    );
    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(firstBytes.toString("utf8")).toContain("한글 경고");
  });

  it("uses source identity to avoid normalized output-name collisions", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const first = makeElectricalObjectDocument();
    const second = makeElectricalObjectDocument();
    second.source = "other/electrical.pdf";
    expect(writeElectricalObjects(root, first, "objects"))
      .not.toBe(writeElectricalObjects(root, second, "objects"));
  });

  it("canonicalizes source separators while preserving Unicode source identity", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const slash = makeElectricalObjectDocument();
    slash.source = "docs/nested/electrical.pdf";
    const backslash = structuredClone(slash);
    backslash.source = "docs\\nested\\electrical.pdf";
    expect(writeElectricalObjects(root, slash, "objects"))
      .toBe(writeElectricalObjects(root, backslash, "objects"));

    const unicode = structuredClone(slash);
    unicode.source = "docs/전기.pdf";
    expect(writeElectricalObjects(root, slash, "objects"))
      .not.toBe(writeElectricalObjects(root, unicode, "objects"));
  });

  it.each([
    ["", /outputName/i],
    ["   ", /outputName/i],
    [".hidden", /hidden|outputName/i],
    ["../escape", /separator|outputName|path/i],
    ["nested/name", /separator|outputName/i],
    ["nested\\name", /separator|outputName/i],
    ["/absolute", /absolute|separator|outputName/i],
  ])("rejects unsafe outputName %j", async (outputName, message) => {
    const { writeElectricalObjects } = await load();
    expect(() => writeElectricalObjects(
      tempRoot(),
      makeElectricalObjectDocument(),
      outputName,
    )).toThrow(message);
  });

  it("rejects parent and target symlinks without escaping projectRoot", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const outside = tempRoot();
    const document = makeElectricalObjectDocument();
    symlinkSync(outside, join(root, ".volt-ai"));
    expect(() => writeElectricalObjects(root, document, "objects")).toThrow(/symbolic/i);

    rmSync(join(root, ".volt-ai"));
    const target = writeElectricalObjects(root, document, "objects");
    const absolute = join(root, target);
    const outsideFile = join(root, "outside.json");
    writeFileSync(outsideFile, "{}\n");
    rmSync(absolute);
    symlinkSync(outsideFile, absolute);
    expect(() => writeElectricalObjects(root, document, "objects")).toThrow(/symbolic/i);
  });

  it("rejects a directory target and leaves no temporary files", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const document = makeElectricalObjectDocument();
    const target = writeElectricalObjects(root, document, "objects");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);
    expect(() => writeElectricalObjects(root, document, "objects"))
      .toThrow(/regular|file/i);
    expect(readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")))
      .toEqual([]);
  });

  it("atomically overwrites an existing regular file", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const document = makeElectricalObjectDocument();
    const target = writeElectricalObjects(root, document, "objects");
    const absolute = join(root, target);
    writeFileSync(absolute, "stale\n");
    expect(writeElectricalObjects(root, document, "objects")).toBe(target);
    expect(readFileSync(absolute, "utf8")).not.toBe("stale\n");
    expect(readdirSync(dirname(absolute)).filter((name) => name.endsWith(".tmp")))
      .toEqual([]);
  });

  it("does not add a persistence path field to the stored document", async () => {
    const { writeElectricalObjects } = await load();
    const root = tempRoot();
    const document = makeElectricalObjectDocument();
    const target = writeElectricalObjects(root, document, "objects");
    expect(existsSync(join(root, target))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, target), "utf8")))
      .not.toHaveProperty("relativeElectricalObjectPath");
  });
});
