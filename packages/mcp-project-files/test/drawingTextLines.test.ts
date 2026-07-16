import { describe, expect, it } from "vitest";

import type { DrawingTextItem } from "../src/drawingLayout/types.js";
import { groupTextLines } from "../src/drawingLayout/groupTextLines.js";
import { normalizePageItems } from "../src/drawingLayout/normalizePageItems.js";
import {
  createLayoutPageInput,
  createLayoutTextItem,
} from "./helpers/drawingLayoutFixture.js";

function normalizedItems(
  items: ReturnType<typeof createLayoutTextItem>[],
): DrawingTextItem[] {
  return normalizePageItems(createLayoutPageInput({ items })).items;
}

function lineItem(
  overrides: Partial<DrawingTextItem> & Pick<DrawingTextItem, "id" | "normalizedText">,
): DrawingTextItem {
  const pageBBox = overrides.pageBBox ?? { x: 100, y: 100, width: 40, height: 12 };

  return {
    id: overrides.id,
    text: overrides.text ?? overrides.normalizedText,
    normalizedText: overrides.normalizedText,
    bbox: overrides.bbox ?? {
      x: pageBBox.x / 600,
      y: pageBBox.y / 800,
      width: pageBBox.width / 600,
      height: pageBBox.height / 800,
    },
    pageBBox,
    rotation: overrides.rotation ?? 0,
    fontName: overrides.fontName ?? "FixtureFont",
    fontSize: overrides.fontSize ?? 12,
    direction: overrides.direction ?? "ltr",
    hasEOL: overrides.hasEOL ?? false,
    sourceOrder: overrides.sourceOrder ?? 0,
    provenance: overrides.provenance ?? {
      transform: [12, 0, 0, 12, pageBBox.x, 800 - pageBBox.y],
      width: pageBBox.width,
      height: pageBBox.height,
    },
  };
}

describe("rotation-aware drawing text line grouping", () => {
  it("joins same-baseline items using visual geometry instead of source order", () => {
    const items = normalizedItems([
      createLayoutTextItem({ str: "154A", transform: [12, 0, 0, 12, 116, 700], width: 32 }),
      createLayoutTextItem({ str: "E-", transform: [12, 0, 0, 12, 100, 700], width: 16 }),
    ]);
    const lines = groupTextLines(items);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: "line-000001",
      text: "E-154A",
      normalizedText: "E-154A",
    });
    expect(lines[0].itemIds).toEqual(
      items
        .slice()
        .sort((left, right) => left.pageBBox.x - right.pageBBox.x)
        .map(({ id }) => id),
    );
  });

  it("inserts one word space for a modest inter-word gap", () => {
    const items = normalizedItems([
      createLayoutTextItem({ str: "MCCB", transform: [12, 0, 0, 12, 100, 700], width: 40 }),
      createLayoutTextItem({ str: "225AF", transform: [12, 0, 0, 12, 148, 700], width: 40 }),
    ]);

    expect(groupTextLines(items)[0]?.text).toBe("MCCB 225AF");
  });

  it("joins Korean and numeric fragments without an artificial space at zero gap", () => {
    const items = normalizedItems([
      createLayoutTextItem({ str: "1", transform: [12, 0, 0, 12, 100, 700], width: 7 }),
      createLayoutTextItem({ str: "단지", transform: [12, 0, 0, 12, 107, 700], width: 20 }),
    ]);

    expect(groupTextLines(items)[0]?.text).toBe("1단지");
  });

  it.each([
    ["(", "MCCB", "(MCCB"],
    ["MCCB", ")", "MCCB)"],
    ["E-", "401", "E-401"],
    ["F-CV", "/", "F-CV/"],
  ])("uses conservative punctuation joining for %j + %j", (left, right, expected) => {
    const items = normalizedItems([
      createLayoutTextItem({ str: left, transform: [12, 0, 0, 12, 100, 700], width: 20 }),
      createLayoutTextItem({ str: right, transform: [12, 0, 0, 12, 120, 700], width: 30 }),
    ]);

    expect(groupTextLines(items)[0]?.text).toBe(expected);
  });

  it("keeps large-gap table cells as separate lines", () => {
    const items = normalizedItems([
      createLayoutTextItem({ str: "LOAD", transform: [12, 0, 0, 12, 100, 700], width: 35 }),
      createLayoutTextItem({ str: "100A", transform: [12, 0, 0, 12, 300, 700], width: 35 }),
    ]);

    expect(groupTextLines(items).map(({ text }) => text)).toEqual(["LOAD", "100A"]);
  });

  it("keeps excessive perpendicular differences separate", () => {
    const items = normalizedItems([
      createLayoutTextItem({ str: "UPPER", transform: [12, 0, 0, 12, 100, 700] }),
      createLayoutTextItem({ str: "LOWER", transform: [12, 0, 0, 12, 145, 675] }),
    ]);

    expect(groupTextLines(items)).toHaveLength(2);
  });

  it("allows a small font-relative perpendicular difference", () => {
    const items = normalizedItems([
      createLayoutTextItem({ str: "MCCB", transform: [12, 0, 0, 12, 100, 700], width: 40 }),
      createLayoutTextItem({ str: "225AF", transform: [12, 0, 0, 12, 145, 699], width: 40 }),
    ]);

    expect(groupTextLines(items)).toHaveLength(1);
  });

  it("treats hasEOL as a hard merge boundary", () => {
    const items = normalizedItems([
      createLayoutTextItem({
        str: "FIRST",
        transform: [12, 0, 0, 12, 100, 700],
        width: 40,
        hasEOL: true,
      }),
      createLayoutTextItem({ str: "SECOND", transform: [12, 0, 0, 12, 140, 700], width: 50 }),
    ]);

    expect(groupTextLines(items).map(({ text }) => text)).toEqual(["FIRST", "SECOND"]);
  });

  it.each([
    {
      rotation: 90,
      first: { x: 100, y: 100, width: 12, height: 40 },
      second: { x: 100, y: 140, width: 12, height: 40 },
    },
    {
      rotation: 180,
      first: { x: 160, y: 100, width: 40, height: 12 },
      second: { x: 120, y: 100, width: 40, height: 12 },
    },
    {
      rotation: 270,
      first: { x: 100, y: 180, width: 12, height: 40 },
      second: { x: 100, y: 140, width: 12, height: 40 },
    },
  ])("groups visual reading order at rotation $rotation", ({ rotation, first, second }) => {
    const items = [
      lineItem({ id: "text-item-000002", normalizedText: "B", rotation, pageBBox: second, sourceOrder: 0 }),
      lineItem({ id: "text-item-000001", normalizedText: "A", rotation, pageBBox: first, sourceOrder: 1 }),
    ];
    const lines = groupTextLines(items);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("AB");
    expect(lines[0]?.itemIds).toEqual(["text-item-000001", "text-item-000002"]);
  });

  it("groups arbitrary-angle items by projected baseline", () => {
    const radians = (33.5 * Math.PI) / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const first = { x: 100, y: 100, width: 40, height: 12 };
    const second = {
      x: first.x + direction.x * 40,
      y: first.y + direction.y * 40,
      width: 40,
      height: 12,
    };
    const lines = groupTextLines([
      lineItem({ id: "text-item-000001", normalizedText: "ANGLE", rotation: 33.5, pageBBox: first }),
      lineItem({ id: "text-item-000002", normalizedText: "TEXT", rotation: 33.5, pageBBox: second }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.rotation).toBe(33.5);
  });

  it("uses circular angle distance so 359 and 1 degrees may group", () => {
    const lines = groupTextLines([
      lineItem({
        id: "text-item-000001",
        normalizedText: "A",
        rotation: 359,
        pageBBox: { x: 100, y: 100, width: 20, height: 12 },
      }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "B",
        rotation: 1,
        pageBBox: { x: 120, y: 100, width: 20, height: 12 },
      }),
    ]);

    expect(lines).toHaveLength(1);
  });

  it("separates a three-degree rotation difference", () => {
    const lines = groupTextLines([
      lineItem({
        id: "text-item-000001",
        normalizedText: "A",
        rotation: 0,
        pageBBox: { x: 100, y: 100, width: 20, height: 12 },
      }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "B",
        rotation: 3,
        pageBBox: { x: 120, y: 100, width: 20, height: 12 },
      }),
    ]);

    expect(lines).toHaveLength(2);
  });

  it("groups a 1.5-degree difference within the approved tolerance", () => {
    const lines = groupTextLines([
      lineItem({
        id: "text-item-000001",
        normalizedText: "A",
        rotation: 0,
        pageBBox: { x: 100, y: 100, width: 20, height: 12 },
      }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "B",
        rotation: 1.5,
        pageBBox: { x: 120, y: 100, width: 20, height: 12 },
      }),
    ]);

    expect(lines).toHaveLength(1);
  });

  it("keeps overlapping raw duplicate items rather than silently deduplicating", () => {
    const items = [
      lineItem({ id: "text-item-000001", normalizedText: "MCCB", sourceOrder: 0 }),
      lineItem({ id: "text-item-000002", normalizedText: "MCCB", sourceOrder: 1 }),
    ];
    const lines = groupTextLines(items);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.itemIds).toEqual(["text-item-000001", "text-item-000002"]);
    expect(lines[0]?.text).toBe("MCCBMCCB");
  });

  it("supports mixed font sizes when baseline geometry is compatible", () => {
    const lines = groupTextLines([
      lineItem({
        id: "text-item-000001",
        normalizedText: "MAIN",
        fontSize: 16,
        pageBBox: { x: 100, y: 96, width: 45, height: 16 },
      }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "MCCB",
        fontSize: 10,
        pageBBox: { x: 150, y: 102, width: 35, height: 10 },
      }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("MAIN MCCB");
  });

  it("creates the exact union bbox and consistent item/source arrays", () => {
    const items = [
      lineItem({
        id: "text-item-000001",
        normalizedText: "A",
        pageBBox: { x: 100, y: 100, width: 20, height: 10 },
        sourceOrder: 7,
      }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "B",
        pageBBox: { x: 120, y: 98, width: 30, height: 14 },
        sourceOrder: 2,
      }),
    ];
    const line = groupTextLines(items)[0]!;

    expect(line.pageBBox).toEqual({ x: 100, y: 98, width: 50, height: 14 });
    expect(line.bbox).toEqual({
      x: 0.166667,
      y: 0.1225,
      width: 0.083333,
      height: 0.0175,
    });
    expect(line.itemIds).toEqual(["text-item-000001", "text-item-000002"]);
    expect(line.sourceOrders).toEqual([7, 2]);
    expect(line.itemIds).toHaveLength(line.sourceOrders.length);
  });

  it("assigns deterministic line IDs and ordering for shuffled input", () => {
    const upper = lineItem({
      id: "text-item-000001",
      normalizedText: "UPPER",
      pageBBox: { x: 100, y: 100, width: 40, height: 12 },
    });
    const lower = lineItem({
      id: "text-item-000002",
      normalizedText: "LOWER",
      pageBBox: { x: 100, y: 200, width: 40, height: 12 },
    });

    const first = groupTextLines([lower, upper]);
    const second = groupTextLines([upper, lower]);

    expect(first.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "line-000001", text: "UPPER" },
      { id: "line-000002", text: "LOWER" },
    ]);
    expect(second).toEqual(first);
  });

  it("assigns every valid item to exactly one line without duplicate membership", () => {
    const items = [
      lineItem({ id: "text-item-000001", normalizedText: "A" }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "B",
        pageBBox: { x: 120, y: 100, width: 20, height: 12 },
      }),
      lineItem({
        id: "text-item-000003",
        normalizedText: "C",
        pageBBox: { x: 100, y: 200, width: 20, height: 12 },
      }),
    ];
    const lines = groupTextLines(items);
    const memberships = lines.flatMap(({ itemIds }) => itemIds);

    expect(memberships).toHaveLength(items.length);
    expect(new Set(memberships)).toHaveProperty("size", items.length);
    expect(memberships.slice().sort()).toEqual(items.map(({ id }) => id).sort());
  });

  it("does not mutate normalized items", () => {
    const items = [
      lineItem({ id: "text-item-000001", normalizedText: "A" }),
      lineItem({
        id: "text-item-000002",
        normalizedText: "B",
        pageBBox: { x: 120, y: 100, width: 20, height: 12 },
      }),
    ];
    const before = structuredClone(items);

    groupTextLines(items);

    expect(items).toEqual(before);
  });
});
