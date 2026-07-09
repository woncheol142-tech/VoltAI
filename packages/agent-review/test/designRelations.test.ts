import { describe, expect, it } from "vitest";

import { analyzeDesignItemRelations } from "../src/designRelations.js";
import type { DesignItemCandidate } from "../src/designItems.js";

function items(names: DesignItemCandidate["name"][]): DesignItemCandidate[] {
  return names.map((name) => ({
    name,
    evidence: [
      {
        sourceType: "unknown",
        sourcePath: "unknown",
        excerpt: `${name} evidence`,
      },
    ],
  }));
}

describe("analyzeDesignItemRelations", () => {
  it("creates a finding for cable and voltage drop", () => {
    const findings = analyzeDesignItemRelations(items(["케이블", "전압강하"]));

    expect(findings).toEqual([
      {
        items: ["케이블", "전압강하"],
        message: "케이블과 전압강하가 함께 발견되어 전압강하 계산 근거 확인 필요",
        severity: "high",
        confidence: "medium",
        proximity: "project-level",
      },
    ]);
  });

  it("uses same-excerpt high confidence for PDF evidence containing both relation items", () => {
    const findings = analyzeDesignItemRelations([
      {
        name: "케이블",
        evidence: [
          {
            sourceType: "pdf",
            sourcePath: "docs/design.pdf",
            excerpt: "케이블 포설과 전압강하 계산을 함께 검토한다.",
          },
        ],
      },
      {
        name: "전압강하",
        evidence: [
          {
            sourceType: "pdf",
            sourcePath: "docs/design.pdf",
            excerpt: "케이블 포설과 전압강하 계산을 함께 검토한다.",
          },
        ],
      },
    ]);

    expect(findings[0]).toMatchObject({
      proximity: "same-excerpt",
      confidence: "high",
    });
  });

  it("uses same-row high confidence for Excel evidence containing both relation items", () => {
    const findings = analyzeDesignItemRelations([
      {
        name: "차단기",
        evidence: [
          {
            sourceType: "excel",
            sourcePath: "estimate/load.xlsx",
            sheetName: "Load",
            rowIndex: 4,
            excerpt: "MCCB Load calculation",
          },
        ],
      },
      {
        name: "부하",
        evidence: [
          {
            sourceType: "excel",
            sourcePath: "estimate/load.xlsx",
            sheetName: "Load",
            rowIndex: 4,
            excerpt: "MCCB Load calculation",
          },
        ],
      },
    ]);

    expect(findings[0]).toMatchObject({
      proximity: "same-row",
      confidence: "high",
    });
  });

  it("uses same-row high confidence for Excel evidence sharing row metadata", () => {
    const findings = analyzeDesignItemRelations([
      {
        name: "차단기",
        evidence: [
          {
            sourceType: "excel",
            sourcePath: "estimate/load.xlsx",
            sheetName: "Load",
            rowIndex: 7,
            excerpt: "MCCB rating",
          },
        ],
      },
      {
        name: "부하",
        evidence: [
          {
            sourceType: "excel",
            sourcePath: "estimate/load.xlsx",
            sheetName: "Load",
            rowIndex: 7,
            excerpt: "Load calculation",
          },
        ],
      },
    ]);

    expect(findings[0]).toMatchObject({
      proximity: "same-row",
      confidence: "high",
    });
  });

  it("does not treat Excel evidence from different sheets as the same row", () => {
    const findings = analyzeDesignItemRelations([
      {
        name: "차단기",
        evidence: [
          {
            sourceType: "excel",
            sourcePath: "estimate/load.xlsx",
            sheetName: "Panel A",
            rowIndex: 7,
            excerpt: "MCCB rating",
          },
        ],
      },
      {
        name: "부하",
        evidence: [
          {
            sourceType: "excel",
            sourcePath: "estimate/load.xlsx",
            sheetName: "Panel B",
            rowIndex: 7,
            excerpt: "Load calculation",
          },
        ],
      },
    ]);

    expect(findings[0]).toMatchObject({
      proximity: "project-level",
      confidence: "medium",
    });
  });

  it("creates a finding for breaker and load", () => {
    const findings = analyzeDesignItemRelations(items(["차단기", "부하"]));

    expect(findings[0].message).toBe(
      "차단기와 부하가 함께 발견되어 차단기 정격 선정 근거 확인 필요",
    );
    expect(findings[0].severity).toBe("high");
  });

  it("creates a finding for panel and breaker", () => {
    const findings = analyzeDesignItemRelations(items(["분전반", "차단기"]));

    expect(findings[0].message).toBe(
      "분전반과 차단기가 함께 발견되어 보호기기 배치 및 정격 협조 확인 필요",
    );
  });

  it("creates a finding for grounding and panel", () => {
    const findings = analyzeDesignItemRelations(items(["접지", "분전반"]));

    expect(findings[0].message).toBe(
      "접지와 분전반이 함께 발견되어 분전반 접지 방식 및 접지 저항 기준 확인 필요",
    );
  });

  it("does not create relation findings for a single unrelated item", () => {
    expect(analyzeDesignItemRelations(items(["케이블"]))).toEqual([]);
  });
});
