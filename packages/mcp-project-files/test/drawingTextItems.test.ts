import { describe, expect, it } from "vitest";

import { normalizePageItems } from "../src/drawingLayout/normalizePageItems.js";
import {
  createLayoutPageInput,
  createLayoutTextItem,
} from "./helpers/drawingLayoutFixture.js";

describe("DrawingTextItem normalization", () => {
  it.each([
    ["한글", "한글"],
    ["MCCB", "MCCB"],
    ["380/220V", "380/220V"],
    ["F-CV 4㎟ (3C)", "F-CV 4mm2 (3C)"],
    ["Ｅ－１５４Ａ", "E-154A"],
    ["A\u0000B", "A B"],
    ["  MCCB \t 225AF \n", "MCCB 225AF"],
    ["㎡ ㎟ kV / - ( ) , .", "m2 mm2 kV / - ( ) , ."],
  ])("preserves semantic text while normalizing %j", (text, normalizedText) => {
    const result = normalizePageItems(
      createLayoutPageInput({ items: [createLayoutTextItem({ str: text })] }),
    );

    expect(result.items[0]).toMatchObject({ text, normalizedText });
  });

  it("preserves hasEOL, source order, font, direction, and raw provenance", () => {
    const item = createLayoutTextItem({
      hasEOL: true,
      fontName: "VoltFont",
      dir: "ttb",
      transform: [0, 12, -12, 0, 100, 700],
      width: 40,
      height: 12,
    });
    const result = normalizePageItems(createLayoutPageInput({ items: [item] }));

    expect(result.items[0]).toMatchObject({
      hasEOL: true,
      sourceOrder: 0,
      fontName: "VoltFont",
      direction: "ttb",
      provenance: {
        transform: item.transform,
        width: 40,
        height: 12,
      },
    });
  });

  it("keeps valid items when fontName or direction is missing", () => {
    const item = createLayoutTextItem();
    delete item.fontName;
    delete item.dir;

    const result = normalizePageItems(createLayoutPageInput({ items: [item] }));

    expect(result.items[0]).toMatchObject({ fontName: null, direction: null });
  });

  it.each([
    ["", "EMPTY_TEXT"],
    [" \t\n", "EMPTY_TEXT"],
  ])("excludes %j normalized-empty text with a provenance warning", (str, code) => {
    const result = normalizePageItems(
      createLayoutPageInput({ items: [createLayoutTextItem({ str })] }),
    );

    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([
      `${code} sourceOrder=0: normalized text is empty`,
    ]);
  });

  it.each([
    [createLayoutTextItem({ width: 0 }), "zero width"],
    [createLayoutTextItem({ height: 0 }), "zero height"],
    [createLayoutTextItem({ width: -1 }), "negative width"],
    [createLayoutTextItem({ height: -1 }), "negative height"],
    [
      createLayoutTextItem({
        transform: [Number.NaN, 0, 0, 12, 100, 700],
      }),
      "non-finite transform",
    ],
  ])("excludes invalid geometry without failing the page", (item, reason) => {
    const result = normalizePageItems(
      createLayoutPageInput({
        items: [item, createLayoutTextItem({ str: "VALID", transform: [12, 0, 0, 12, 200, 700] })],
      }),
    );

    expect(result.items.map(({ normalizedText }) => normalizedText)).toEqual(["VALID"]);
    expect(result.warnings.join("\n")).toContain("INVALID_GEOMETRY sourceOrder=0");
    expect(result.warnings.join("\n")).toContain(reason);
  });

  it("rejects a malformed transform length injected at the unit boundary", () => {
    const malformed = {
      ...createLayoutTextItem(),
      transform: [12, 0, 0, 12, 100],
    } as unknown as ReturnType<typeof createLayoutTextItem>;
    const result = normalizePageItems(createLayoutPageInput({ items: [malformed] }));

    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toContain("INVALID_GEOMETRY sourceOrder=0");
    expect(result.warnings[0]).toContain("transform");
  });

  it("clamps a partially outside item and excludes a fully outside item", () => {
    const result = normalizePageItems(
      createLayoutPageInput({
        items: [
          createLayoutTextItem({
            str: "PARTIAL",
            transform: [12, 0, 0, 12, -10, 700],
            width: 30,
          }),
          createLayoutTextItem({
            str: "OUTSIDE",
            transform: [12, 0, 0, 12, -200, 700],
            width: 20,
          }),
        ],
      }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      normalizedText: "PARTIAL",
      pageBBox: { x: 0, width: 20 },
    });
    expect(result.warnings).toEqual([
      "OUTSIDE_PAGE sourceOrder=1: item excluded",
    ]);
  });

  it("returns a normal zero-item result when every raw item is invalid", () => {
    const result = normalizePageItems(
      createLayoutPageInput({
        items: [createLayoutTextItem({ width: 0 })],
      }),
    );

    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([
      "INVALID_GEOMETRY sourceOrder=0: zero width",
      "NO_TEXT_ITEMS: page contains no valid text items",
    ]);
  });

  it("sorts warnings by code, sourceOrder, then codepoint message order", () => {
    const result = normalizePageItems(
      createLayoutPageInput({
        items: [
          createLayoutTextItem({ str: "OUT", transform: [12, 0, 0, 12, -200, 700] }),
          createLayoutTextItem({ width: 0 }),
          createLayoutTextItem({ str: " " }),
          createLayoutTextItem({ height: 0 }),
        ],
      }),
    );

    expect(result.warnings).toEqual([
      "EMPTY_TEXT sourceOrder=2: normalized text is empty",
      "INVALID_GEOMETRY sourceOrder=1: zero width",
      "INVALID_GEOMETRY sourceOrder=3: zero height",
      "NO_TEXT_ITEMS: page contains no valid text items",
      "OUTSIDE_PAGE sourceOrder=0: item excluded",
    ]);
  });

  it("assigns canonical IDs and geometry order independently of stream order", () => {
    const upper = createLayoutTextItem({
      str: "UPPER",
      transform: [12, 0, 0, 12, 100, 700],
    });
    const lower = createLayoutTextItem({
      str: "LOWER",
      transform: [12, 0, 0, 12, 100, 600],
    });
    const first = normalizePageItems(
      createLayoutPageInput({ items: [lower, upper] }),
    );
    const second = normalizePageItems(
      createLayoutPageInput({ items: [upper, lower] }),
    );

    expect(first.items.map(({ id, normalizedText }) => ({ id, normalizedText }))).toEqual([
      { id: "text-item-000001", normalizedText: "UPPER" },
      { id: "text-item-000002", normalizedText: "LOWER" },
    ]);
    expect(second.items.map(({ id, normalizedText }) => ({ id, normalizedText }))).toEqual(
      first.items.map(({ id, normalizedText }) => ({ id, normalizedText })),
    );
    expect(first.items.map(({ sourceOrder }) => sourceOrder)).toEqual([1, 0]);
    expect(second.items.map(({ sourceOrder }) => sourceOrder)).toEqual([0, 1]);
  });

  it("preserves complete duplicate items and gives them unique deterministic IDs", () => {
    const duplicate = createLayoutTextItem({ str: "DUPLICATE" });
    const result = normalizePageItems(
      createLayoutPageInput({ items: [structuredClone(duplicate), structuredClone(duplicate)] }),
    );

    expect(result.items).toHaveLength(2);
    expect(result.items.map(({ id }) => id)).toEqual([
      "text-item-000001",
      "text-item-000002",
    ]);
    expect(new Set(result.items.map(({ id }) => id))).toHaveProperty("size", 2);
  });

  it("keeps complete duplicate output semantically stable across input permutation", () => {
    const duplicate = createLayoutTextItem({ str: "DUPLICATE" });
    const first = normalizePageItems(
      createLayoutPageInput({
        items: [structuredClone(duplicate), structuredClone(duplicate)],
      }),
    );
    const second = normalizePageItems(
      createLayoutPageInput({
        items: [structuredClone(duplicate), structuredClone(duplicate)].reverse(),
      }),
    );

    expect(second).toEqual(first);
  });

  it("does not mutate raw page input or item objects", () => {
    const input = createLayoutPageInput({
      items: [createLayoutTextItem({ str: "Ａ\u0000Ｂ" })],
    });
    const before = structuredClone(input);

    normalizePageItems(input);

    expect(input).toEqual(before);
  });

  it("reports itemCount as the exact normalized item array length", () => {
    const result = normalizePageItems(
      createLayoutPageInput({
        items: [
          createLayoutTextItem({ str: "A" }),
          createLayoutTextItem({ str: "B", transform: [12, 0, 0, 12, 200, 700] }),
          createLayoutTextItem({ str: " " }),
        ],
      }),
    );

    expect(result.itemCount).toBe(result.items.length);
    expect(result.itemCount).toBe(2);
  });
});
