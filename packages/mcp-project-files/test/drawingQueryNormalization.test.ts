import { describe, expect, it } from "vitest";

type QueryUnit = {
  canonical: string;
  alternatives: string[];
  kind: "drawingNo" | "complex" | "building" | "floor" | "category" | "text";
};

type NormalizedDrawingQuery = {
  normalizedQuery: string;
  units: QueryUnit[];
};

type NormalizeDrawingQuery = (query: string) => NormalizedDrawingQuery;

const normalizationModulePath = "../src/drawingSearch/normalizeDrawingQuery.js";

async function loadNormalizer(): Promise<NormalizeDrawingQuery> {
  const module = (await import(normalizationModulePath)) as {
    normalizeDrawingQuery: NormalizeDrawingQuery;
  };
  return module.normalizeDrawingQuery;
}

describe("drawing query normalization", () => {
  it.each(["E-401", "E401", "e 401", "e-401", "Ｅ－４０１"])(
    "canonicalizes drawing number %j",
    async (query) => {
      const normalize = await loadNormalizer();
      const result = normalize(query);

      expect(result.normalizedQuery).toBe("E-401");
      expect(result.units).toEqual([
        expect.objectContaining({
          canonical: "E-401",
          alternatives: ["E-401"],
          kind: "drawingNo",
        }),
      ]);
    },
  );

  it.each([
    ["1 단지", "1단지", "complex"],
    ["101 동", "101동", "building"],
    ["지하 2층", "지하2층", "floor"],
  ] as const)("normalizes structured query %j", async (query, canonical, kind) => {
    const normalize = await loadNormalizer();
    const result = normalize(query);

    expect(result.normalizedQuery).toBe(canonical);
    expect(result.units).toEqual([
      expect.objectContaining({ canonical, alternatives: [canonical], kind }),
    ]);
  });

  it.each(["129m2", "129m²", "129㎡", "１２９ｍ２"])(
    "canonicalizes area expression %j",
    async (query) => {
      const normalize = await loadNormalizer();
      const result = normalize(query);

      expect(result.normalizedQuery).toBe("129㎡");
      expect(result.units[0]).toMatchObject({ canonical: "129㎡" });
    },
  );

  it("canonicalizes voltage spacing and case", async () => {
    const normalize = await loadNormalizer();

    expect(normalize("22.9 kv").normalizedQuery).toBe("22.9kv");
  });

  it("removes NUL, trims, and collapses whitespace", async () => {
    const normalize = await loadNormalizer();

    expect(normalize("  1단지\u0000   101동  ").normalizedQuery).toBe("1단지 101동");
  });

  it.each(["찾아줘", "보여줘", "검색해줘", "알려줘", "관련"])(
    "removes command expression %j when substantive units remain",
    async (command) => {
      const normalize = await loadNormalizer();

      expect(normalize(`1단지 전력간선 도면 ${command}`).normalizedQuery).toBe(
        "1단지 전력간선",
      );
    },
  );

  it("splits 피뢰접지 into two required semantic units", async () => {
    const normalize = await loadNormalizer();
    const result = normalize("피뢰접지");

    expect(result.normalizedQuery).toBe("피뢰 접지");
    expect(result.units.map((unit) => unit.canonical)).toEqual(["피뢰", "접지"]);
  });

  it.each([
    ["간선", "전력간선"],
    ["분전함", "분전반"],
    ["수전", "수변전"],
    ["결선", "결선도"],
    ["결선도", "결선"],
  ])("keeps %j as a query-side synonym alternative for %j", async (query, alternative) => {
    const normalize = await loadNormalizer();
    const result = normalize(query);

    expect(result.units).toHaveLength(1);
    expect(result.units[0].alternatives).toEqual(expect.arrayContaining([query, alternative]));
  });

  it("models 옥탑 as a floor-family alternative", async () => {
    const normalize = await loadNormalizer();
    const result = normalize("옥탑");

    expect(result.units[0]).toMatchObject({ kind: "floor" });
    expect(result.units[0].alternatives).toEqual(
      expect.arrayContaining(["옥탑층", "옥탑지붕층"]),
    );
  });

  it.each(["", "   ", "...?!", "도면", "도면 찾아줘", "전"])(
    "rejects non-substantive query %j",
    async (query) => {
      const normalize = await loadNormalizer();

      expect(() => normalize(query)).toThrow(/query|substantive|search term/i);
    },
  );
});
