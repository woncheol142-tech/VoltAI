import { describe, expect, it } from "vitest";

import { extractDesignItems } from "../src/designItems.js";

describe("extractDesignItems", () => {
  it("extracts cable and grounding items from PDF text", () => {
    const items = extractDesignItems({
      pdfs: [
        {
          relativePath: "docs/design.pdf",
          pageCount: 3,
          text: "케이블 포설 계획과 접지 저항 기준을 확인한다.",
        },
      ],
      excels: [],
    });

    expect(items.map((item) => item.name)).toEqual(["케이블", "접지"]);
    expect(items[0].evidence[0]).toEqual({
      sourceType: "pdf",
      sourcePath: "docs/design.pdf",
      excerpt: "docs/design.pdf: 케이블 포설 계획과 접지 저항 기준을 확인한다.",
    });
    expect(items[1].evidence[0]).toEqual({
      sourceType: "pdf",
      sourcePath: "docs/design.pdf",
      excerpt: "docs/design.pdf: 케이블 포설 계획과 접지 저항 기준을 확인한다.",
    });
    expect(items[0].evidence[0]).not.toHaveProperty("page");
  });

  it("extracts PDF evidence with page provenance when page text is available", () => {
    const items = extractDesignItems({
      pdfs: [
        {
          relativePath: "docs/design.pdf",
          pageCount: 2,
          text: "케이블 포설 계획을 확인한다.\n접지 저항 기준을 확인한다.",
          pages: [
            { page: 1, text: "케이블 포설 계획을 확인한다." },
            { page: 2, text: "접지 저항 기준을 확인한다." },
          ],
        },
      ],
      excels: [],
    });

    expect(items.map((item) => item.name)).toEqual(["케이블", "접지"]);
    expect(items[0].evidence[0]).toEqual({
      sourceType: "pdf",
      sourcePath: "docs/design.pdf",
      page: 1,
      excerpt: "케이블 포설 계획을 확인한다.",
    });
    expect(items[1].evidence[0]).toEqual({
      sourceType: "pdf",
      sourcePath: "docs/design.pdf",
      page: 2,
      excerpt: "접지 저항 기준을 확인한다.",
    });
  });

  it("extracts breaker and panel items from Excel rows", () => {
    const items = extractDesignItems({
      pdfs: [],
      excels: [
        {
          relativePath: "estimate/summary.xlsx",
          sheets: ["Summary"],
          sheetName: "Summary",
          rows: [
            ["Item", "Description"],
            ["MCCB", "Main breaker"],
            ["Panel", "Distribution panel"],
          ],
        },
      ],
    });

    expect(items.map((item) => item.name)).toEqual(["차단기", "분전반"]);
    expect(items[0].evidence[0]).toEqual({
      sourceType: "excel",
      sourcePath: "estimate/summary.xlsx",
      sheetName: "Summary",
      rowIndex: 2,
      excerpt: "MCCB Main breaker",
    });
    expect(items[1].evidence[0]).toEqual({
      sourceType: "excel",
      sourcePath: "estimate/summary.xlsx",
      sheetName: "Summary",
      rowIndex: 3,
      excerpt: "Panel Distribution panel",
    });
  });

  it("supports synonyms and abbreviations", () => {
    const items = extractDesignItems({
      pdfs: [
        {
          relativePath: "docs/mixed.pdf",
          pageCount: 1,
          text: "cable and 전선 sizing, ELB breaker coordination, panel schedule",
        },
      ],
      excels: [],
    });

    expect(items.map((item) => item.name)).toEqual(["케이블", "차단기", "분전반"]);
  });

  it("deduplicates structured evidence by source metadata and excerpt", () => {
    const items = extractDesignItems({
      pdfs: [
        {
          relativePath: "docs/design.pdf",
          pageCount: 1,
          text: "케이블 포설 계획을 확인한다.\n케이블 포설 계획을 확인한다.",
        },
      ],
      excels: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0].evidence).toHaveLength(1);
  });

  it("keeps at most three evidence entries per item", () => {
    const items = extractDesignItems({
      pdfs: [
        {
          relativePath: "docs/design.pdf",
          pageCount: 1,
          text: [
            "케이블 A 포설 계획을 확인한다.",
            "케이블 B 포설 계획을 확인한다.",
            "케이블 C 포설 계획을 확인한다.",
            "케이블 D 포설 계획을 확인한다.",
          ].join("\n"),
        },
      ],
      excels: [],
    });

    expect(items[0].evidence).toHaveLength(3);
    expect(items[0].evidence.map((evidence) => evidence.excerpt)).not.toContain(
      "docs/design.pdf: 케이블 D 포설 계획을 확인한다.",
    );
  });

  it("supports Excel evidence without sheetName", () => {
    const items = extractDesignItems({
      pdfs: [],
      excels: [
        {
          relativePath: "estimate/summary.xlsx",
          sheets: ["Summary"],
          rows: [["MCCB", "Main breaker"]],
        },
      ],
    });

    expect(items[0].evidence[0]).toEqual({
      sourceType: "excel",
      sourcePath: "estimate/summary.xlsx",
      rowIndex: 1,
      excerpt: "MCCB Main breaker",
    });
  });

  it("returns no items when no design candidates are found", () => {
    expect(extractDesignItems({ pdfs: [], excels: [] })).toEqual([]);
  });
});
