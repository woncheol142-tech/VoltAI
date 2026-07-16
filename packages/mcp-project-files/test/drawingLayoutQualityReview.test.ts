import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { groupTextLines } from "../src/drawingLayout/groupTextLines.js";
import { normalizePageItems } from "../src/drawingLayout/normalizePageItems.js";
import {
  createLayoutPageInput,
  createLayoutTextItem,
} from "./helpers/drawingLayoutFixture.js";

describe("Task 43A drawing layout quality review", () => {
  it("groups PDF-coordinate arbitrary-angle fragments along their visual baseline", () => {
    const angle = 33.5;
    const radians = (angle * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const firstX = 100;
    const firstY = 500;
    const fragmentWidth = 40;
    const items = normalizePageItems(
      createLayoutPageInput({
        items: [
          createLayoutTextItem({
            str: "A",
            transform: [
              12 * cosine,
              12 * sine,
              -12 * sine,
              12 * cosine,
              firstX,
              firstY,
            ],
            width: fragmentWidth,
          }),
          createLayoutTextItem({
            str: "B",
            transform: [
              12 * cosine,
              12 * sine,
              -12 * sine,
              12 * cosine,
              firstX + cosine * fragmentWidth,
              firstY + sine * fragmentWidth,
            ],
            width: fragmentWidth,
          }),
        ],
      }),
    ).items;

    expect(items.map(({ rotation }) => rotation)).toEqual([angle, angle]);
    expect(groupTextLines(items).map(({ text }) => text)).toEqual(["AB"]);
  });

  it("keeps stable item IDs for distinguishable raw duplicates after stream shuffling", () => {
    const ascii = createLayoutTextItem({
      str: "A",
      dir: "ltr",
      hasEOL: false,
    });
    const fullWidth = createLayoutTextItem({
      str: "Ａ",
      dir: "rtl",
      hasEOL: true,
    });
    const first = normalizePageItems(
      createLayoutPageInput({ items: [ascii, fullWidth] }),
    ).items;
    const second = normalizePageItems(
      createLayoutPageInput({ items: [fullWidth, ascii] }),
    ).items;
    const identity = (items: typeof first) =>
      items.map(({ id, text, direction, hasEOL }) => ({
        id,
        text,
        direction,
        hasEOL,
      }));

    expect(identity(second)).toEqual(identity(first));
  });

  it("documents the vector-text scope and zero-text behavior without semantic inference", () => {
    const readme = readFileSync(
      fileURLToPath(new URL("../README.md", import.meta.url)),
      "utf8",
    );
    const section = readme.split("## `extract_drawing_layout`")[1] ?? "";

    expect(section).toContain("PDF.js textContent");
    expect(section).toContain("raw PDF.js text item");
    expect(section).toContain("arbitrary text rotation");
    expect(section).toContain("zero-text");
    expect(section).toContain("does not infer electrical");
  });
});
