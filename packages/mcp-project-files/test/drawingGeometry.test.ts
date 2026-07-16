import { describe, expect, it } from "vitest";

import {
  createTextItemGeometry,
  normalizeAngle,
} from "../src/drawingLayout/geometry.js";
import {
  createLayoutPageInput,
  createLayoutTextItem,
} from "./helpers/drawingLayoutFixture.js";

function expectReconstructable(geometry: ReturnType<typeof createTextItemGeometry>): void {
  expect(geometry).not.toBeNull();
  const value = geometry!;
  const page = createLayoutPageInput();

  expect(value.bbox.x * page.pageWidth).toBeCloseTo(value.pageBBox.x, 3);
  expect(value.bbox.y * page.pageHeight).toBeCloseTo(value.pageBBox.y, 3);
  expect(value.bbox.width * page.pageWidth).toBeCloseTo(value.pageBBox.width, 3);
  expect(value.bbox.height * page.pageHeight).toBeCloseTo(value.pageBBox.height, 3);
}

describe("drawing layout coordinate normalization", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [360, 0],
    [-1, 359],
    [721.25, 1.25],
  ])("canonicalizes angle %s to %s", (input, expected) => {
    expect(normalizeAngle(input)).toBe(expected);
  });

  it("creates reconstructable top-left page and normalized bboxes", () => {
    const geometry = createTextItemGeometry(
      createLayoutPageInput(),
      createLayoutTextItem(),
    );

    expect(geometry).toMatchObject({
      pageBBox: { x: 100, y: 88, width: 40, height: 12 },
      bbox: { x: 0.166667, y: 0.11, width: 0.066667, height: 0.015 },
      rotation: 0,
      fontSize: 12,
    });
    expectReconstructable(geometry);
  });

  it.each([
    {
      name: "90",
      page: createLayoutPageInput({
        pageWidth: 800,
        pageHeight: 600,
        rotation: 90,
        viewportTransform: [0, 1, 1, 0, 0, 0],
      }),
    },
    {
      name: "180",
      page: createLayoutPageInput({
        rotation: 180,
        viewportTransform: [-1, 0, 0, 1, 600, 0],
      }),
    },
    {
      name: "270",
      page: createLayoutPageInput({
        pageWidth: 800,
        pageHeight: 600,
        rotation: 270,
        viewportTransform: [0, -1, -1, 0, 800, 600],
      }),
    },
  ])("normalizes page rotation $name into visual top-left coordinates", ({ page }) => {
    const geometry = createTextItemGeometry(page, createLayoutTextItem());

    expect(geometry).not.toBeNull();
    expect(Object.values(geometry!.bbox).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(geometry!.bbox.x + geometry!.bbox.width).toBeLessThanOrEqual(1);
    expect(geometry!.bbox.y + geometry!.bbox.height).toBeLessThanOrEqual(1);
  });

  it.each([15, 33.5, 270, 359.9996])(
    "preserves arbitrary visual item rotation %s with three-decimal rounding",
    (angle) => {
      const radians = (angle * Math.PI) / 180;
      const geometry = createTextItemGeometry(
        createLayoutPageInput(),
        createLayoutTextItem({
          transform: [
            12 * Math.cos(radians),
            12 * Math.sin(radians),
            -12 * Math.sin(radians),
            12 * Math.cos(radians),
            200,
            400,
          ],
        }),
      );

      expect(geometry?.rotation).toBe(angle === 359.9996 ? 0 : angle);
    },
  );

  it("applies a non-zero CropBox through the viewport transform", () => {
    const page = createLayoutPageInput({
      pageWidth: 400,
      pageHeight: 600,
      cropBox: { x: 50, y: 100, width: 400, height: 600 },
      viewportTransform: [1, 0, 0, -1, -50, 700],
    });
    const geometry = createTextItemGeometry(
      page,
      createLayoutTextItem({ transform: [12, 0, 0, 12, 70, 650] }),
    );

    expect(geometry?.pageBBox.x).toBe(20);
    expect(geometry?.pageBBox.y).toBe(38);
  });

  it("supports different visual page sizes", () => {
    const geometry = createTextItemGeometry(
      createLayoutPageInput({ pageWidth: 1000, pageHeight: 500 }),
      createLayoutTextItem({ transform: [10, 0, 0, 10, 500, 250], width: 100, height: 10 }),
    );

    expect(geometry?.bbox).toMatchObject({ x: 0.5, width: 0.1 });
  });

  it("clamps an item that partially crosses the page boundary", () => {
    const item = createLayoutTextItem({
      transform: [12, 0, 0, 12, -10, 700],
      width: 30,
    });
    const geometry = createTextItemGeometry(createLayoutPageInput(), item);

    expect(geometry?.pageBBox).toMatchObject({ x: 0, width: 20 });
    expect(geometry?.bbox.x).toBe(0);
    expect(geometry?.bbox.width).toBeCloseTo(20 / 600, 6);
    expect(geometry?.provenance.transform).toEqual(item.transform);
    expect(geometry?.provenance.width).toBe(30);
  });

  it("returns null for geometry completely outside the visual page", () => {
    expect(
      createTextItemGeometry(
        createLayoutPageInput(),
        createLayoutTextItem({ transform: [12, 0, 0, 12, -200, 700], width: 20 }),
      ),
    ).toBeNull();
  });

  it.each([
    createLayoutTextItem({ transform: [Number.NaN, 0, 0, 12, 100, 700] }),
    createLayoutTextItem({ transform: [12, 0, 0, 12, Number.POSITIVE_INFINITY, 700] }),
    createLayoutTextItem({ width: 0 }),
    createLayoutTextItem({ height: 0 }),
    createLayoutTextItem({ width: -1 }),
    createLayoutTextItem({ height: -1 }),
  ])("rejects malformed, non-finite, or non-positive geometry", (item) => {
    expect(createTextItemGeometry(createLayoutPageInput(), item)).toBeNull();
  });

  it("canonicalizes negative zero and never emits non-finite numbers", () => {
    const geometry = createTextItemGeometry(
      createLayoutPageInput(),
      createLayoutTextItem({ transform: [12, -0, 0, 12, -0, 700] }),
    );
    const numbers = [
      ...Object.values(geometry!.pageBBox),
      ...Object.values(geometry!.bbox),
      geometry!.rotation,
      geometry!.fontSize,
    ];

    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(Object.is(geometry!.pageBBox.x, -0)).toBe(false);
    expect(Object.is(geometry!.bbox.x, -0)).toBe(false);
  });

  it("keeps the input page and text item immutable", () => {
    const page = createLayoutPageInput();
    const item = createLayoutTextItem();
    const pageBefore = structuredClone(page);
    const itemBefore = structuredClone(item);

    createTextItemGeometry(page, item);

    expect(page).toEqual(pageBefore);
    expect(item).toEqual(itemBefore);
  });

  it("maps pageBBox points directly to render pixels at the render scale", () => {
    const geometry = createTextItemGeometry(
      createLayoutPageInput(),
      createLayoutTextItem(),
    )!;
    const renderScale = 2;

    expect({
      x: geometry.pageBBox.x * renderScale,
      y: geometry.pageBBox.y * renderScale,
      width: geometry.pageBBox.width * renderScale,
      height: geometry.pageBBox.height * renderScale,
    }).toEqual({ x: 200, y: 176, width: 80, height: 24 });
  });
});
