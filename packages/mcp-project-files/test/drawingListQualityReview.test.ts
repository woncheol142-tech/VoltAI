import { describe, expect, it, vi } from "vitest";

import { parseDrawingListPages } from "../src/drawingIndex/parseDrawingList.js";
import {
  createDrawingListTextPage,
  createTwoPageDrawingListTextFixture,
} from "./helpers/drawingListFixture.js";

describe("drawing-list parser quality invariants", () => {
  it("uses locale-independent ordering for coordinate and warning tie-breakers", () => {
    const page = createTwoPageDrawingListTextFixture()[0];
    const title = page.items.find((item) => item.str === "도면목록표-1");

    expect(title).toBeDefined();
    const input = {
      ...page,
      items: [
        ...page.items,
        {
          ...title!,
          str: "추가 제목 조각",
        },
      ],
    };
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("locale-dependent comparison was used");
      });

    let result: ReturnType<typeof parseDrawingListPages>;
    try {
      result = parseDrawingListPages([input]);
    } finally {
      localeCompare.mockRestore();
    }

    expect(result.drawings.some((drawing) => drawing.drawingNo === "E-001")).toBe(true);
  });

  it("includes one-based block provenance and orphan text in diagnostics", () => {
    const page = createDrawingListTextPage(
      4,
      [
        {
          drawingNo: "E-401",
          title: "1단지 101동 지하2층 전력간선설비 평면도",
          scaleA1: "1/100",
          scaleA3: "1/200",
          row: 1,
          block: "upper",
        },
      ],
      { includeLowerHeader: false },
    );
    const withoutDrawingNumber = {
      ...page,
      items: page.items.filter((item) => !["E-", "401"].includes(item.str)),
    };

    const result = parseDrawingListPages([withoutDrawingNumber]);

    expect(result.drawings).toHaveLength(0);
    expect(result.warnings).toContain(
      "[page 4 block 1 row 1] drawing number is missing for orphan title: " +
        "1단지 101동 지하2층 전력간선설비 평면도",
    );
  });
});
