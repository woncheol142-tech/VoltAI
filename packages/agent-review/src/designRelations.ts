import type { DesignItemCandidate, DesignItemName } from "./designItems.js";
import type { StructuredEvidence } from "./ports.js";

export type DesignRelationSeverity = "low" | "medium" | "high";
export type DesignRelationConfidence = "medium" | "high";
export type DesignRelationProximity = "same-excerpt" | "same-row" | "project-level";

export type DesignItemRelationFinding = {
  items: [DesignItemName, DesignItemName];
  message: string;
  severity: DesignRelationSeverity;
  confidence: DesignRelationConfidence;
  proximity: DesignRelationProximity;
};

type DesignItemRelationRule = {
  items: [DesignItemName, DesignItemName];
  message: string;
  severity: DesignRelationSeverity;
};

const relationRules: DesignItemRelationRule[] = [
  {
    items: ["케이블", "전압강하"],
    message: "케이블과 전압강하가 함께 발견되어 전압강하 계산 근거 확인 필요",
    severity: "high",
  },
  {
    items: ["차단기", "부하"],
    message: "차단기와 부하가 함께 발견되어 차단기 정격 선정 근거 확인 필요",
    severity: "high",
  },
  {
    items: ["분전반", "차단기"],
    message: "분전반과 차단기가 함께 발견되어 보호기기 배치 및 정격 협조 확인 필요",
    severity: "medium",
  },
  {
    items: ["접지", "분전반"],
    message: "접지와 분전반이 함께 발견되어 분전반 접지 방식 및 접지 저항 기준 확인 필요",
    severity: "medium",
  },
  {
    items: ["조명", "부하"],
    message: "조명과 부하가 함께 발견되어 조명 부하 산정 근거 확인 필요",
    severity: "medium",
  },
  {
    items: ["콘센트", "차단기"],
    message: "콘센트와 차단기가 함께 발견되어 콘센트 회로 보호 정격 확인 필요",
    severity: "medium",
  },
];

const itemKeywords: Record<DesignItemName, string[]> = {
  케이블: ["케이블", "전선", "cable"],
  차단기: ["차단기", "mccb", "elb", "breaker"],
  분전반: ["분전반", "panel", "distribution panel"],
  조명: ["조명", "lighting", "light"],
  콘센트: ["콘센트", "outlet", "receptacle"],
  접지: ["접지", "ground", "grounding"],
  전압강하: ["전압강하", "voltage drop"],
  부하: ["부하", "load"],
};

function includesItemKeyword(evidence: StructuredEvidence, item: DesignItemName): boolean {
  const normalizedEvidence = evidence.excerpt.toLowerCase();

  return itemKeywords[item].some((keyword) => normalizedEvidence.includes(keyword.toLowerCase()));
}

function hasSameExcelRow(left: StructuredEvidence, right: StructuredEvidence): boolean {
  return (
    left.sourceType === "excel" &&
    right.sourceType === "excel" &&
    left.sourcePath === right.sourcePath &&
    left.sheetName === right.sheetName &&
    left.rowIndex !== undefined &&
    left.rowIndex === right.rowIndex
  );
}

function hasSamePdfExcerpt(evidence: StructuredEvidence): boolean {
  return evidence.sourceType === "pdf";
}

function findProximity(
  left: DesignItemCandidate,
  right: DesignItemCandidate,
): Pick<DesignItemRelationFinding, "confidence" | "proximity"> {
  const evidences = [...left.evidence, ...right.evidence];

  for (const evidence of evidences) {
    if (includesItemKeyword(evidence, left.name) && includesItemKeyword(evidence, right.name)) {
      if (hasSamePdfExcerpt(evidence)) {
        return { confidence: "high", proximity: "same-excerpt" };
      }

      if (evidence.sourceType === "excel") {
        return { confidence: "high", proximity: "same-row" };
      }
    }
  }

  for (const leftEvidence of left.evidence) {
    for (const rightEvidence of right.evidence) {
      if (hasSameExcelRow(leftEvidence, rightEvidence)) {
        return { confidence: "high", proximity: "same-row" };
      }
    }
  }

  return { confidence: "medium", proximity: "project-level" };
}

export function analyzeDesignItemRelations(
  items: DesignItemCandidate[],
): DesignItemRelationFinding[] {
  const itemsByName = new Map(items.map((item) => [item.name, item]));

  return relationRules.flatMap((rule) => {
    const left = itemsByName.get(rule.items[0]);
    const right = itemsByName.get(rule.items[1]);

    if (!left || !right) {
      return [];
    }

    return [
      {
        ...rule,
        ...findProximity(left, right),
      },
    ];
  });
}
