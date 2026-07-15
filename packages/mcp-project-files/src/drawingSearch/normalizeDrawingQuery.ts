import type {
  DrawingQueryUnit,
  DrawingQueryUnitKind,
  NormalizedDrawingQuery,
} from "./types.js";

const COMMAND_EXPRESSIONS = ["검색해줘", "찾아줘", "보여줘", "알려줘", "관련"];
const CATEGORY_TERMS = new Set([
  "도면목록",
  "수변전",
  "전력간선",
  "분전반",
  "분전함",
  "mcc",
  "전등",
  "전열",
  "동력",
  "접지",
  "피뢰",
  "태양광",
  "보안등",
  "조경등",
  "소방",
  "기계",
  "간선",
  "수전",
]);

const QUERY_ALTERNATIVES: Readonly<Record<string, readonly string[]>> = {
  간선: ["간선", "전력간선"],
  분전함: ["분전함", "분전반"],
  수전: ["수전", "수변전"],
  결선: ["결선", "결선도"],
  결선도: ["결선도", "결선"],
  옥탑: ["옥탑", "옥탑층", "옥탑지붕층"],
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll("\u0000", "")
    .toLowerCase()
    .replace(/(\d+)\s*단지/gu, "$1단지")
    .replace(/(\d{3})\s*동/gu, "$1동")
    .replace(/지하\s*(\d+)\s*층/gu, "지하$1층")
    .replace(/(\d+)\s*층/gu, "$1층")
    .replace(/기준\s*\(\s*(\d+)\s*[~～-]\s*(\d+)\s*\)\s*층/gu, "기준($1~$2)층")
    .replace(/(\d+(?:\.\d+)?)\s*(?:m2|m²|㎡)/giu, "$1㎡")
    .replace(/(\d+(?:\.\d+)?)\s*kv/giu, "$1kv")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalDrawingNumber(value: string): string | null {
  const compact = value.replace(/[\s-]+/gu, "").toUpperCase();
  const match = /^([A-Z]{1,4})(\d{2,4}[A-Z]?)$/u.exec(compact);
  return match ? `${match[1]}-${match[2]}` : null;
}

function unitKind(canonical: string): DrawingQueryUnitKind {
  if (/^\d+단지$/u.test(canonical)) return "complex";
  if (/^\d{3}동$/u.test(canonical)) return "building";
  if (/^(?:지하(?:\d+)?층|\d+층|기준(?:\(\d+~\d+\))?층|옥탑|옥탑층|옥탑지붕층|지붕층|pit층)$/iu.test(canonical)) {
    return "floor";
  }
  if (CATEGORY_TERMS.has(canonical)) return "category";
  return "text";
}

function createUnit(canonical: string, kind = unitKind(canonical)): DrawingQueryUnit {
  const alternatives = QUERY_ALTERNATIVES[canonical] ?? [canonical];
  return { canonical, alternatives: [...alternatives], kind };
}

function tokenizeQuery(query: string): string[] {
  return query
    .replace(/[^\p{Letter}\p{Number}.㎡/()~-]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => /[\p{Letter}\p{Number}]/u.test(token));
}

export function normalizeDrawingQuery(query: string): NormalizedDrawingQuery {
  if (typeof query !== "string") {
    throw new Error("query must be a string with a substantive search term");
  }

  let normalized = normalizeText(query);
  for (const expression of COMMAND_EXPRESSIONS) {
    normalized = normalized.replaceAll(expression, " ");
  }
  normalized = normalized.replace(/피뢰\s*접지/gu, "피뢰 접지");
  normalized = normalized.replace(/\s+/gu, " ").trim();

  const wholeDrawingNumber = canonicalDrawingNumber(normalized);
  if (wholeDrawingNumber) {
    return {
      normalizedQuery: wholeDrawingNumber,
      units: [createUnit(wholeDrawingNumber, "drawingNo")],
    };
  }

  const tokens = tokenizeQuery(normalized);
  const units: DrawingQueryUnit[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const combinedDrawingNumber = next ? canonicalDrawingNumber(`${token}${next}`) : null;
    const drawingNumber = canonicalDrawingNumber(token);

    if (combinedDrawingNumber && /^[a-z]{1,4}-?$/iu.test(token)) {
      units.push(createUnit(combinedDrawingNumber, "drawingNo"));
      index += 1;
      continue;
    }
    if (drawingNumber) {
      units.push(createUnit(drawingNumber, "drawingNo"));
      continue;
    }
    if (token === "도면") continue;
    units.push(createUnit(token));
  }

  const seenUnits = new Set<string>();
  const substantiveUnits = units.filter((unit) => {
    if (unit.canonical.length <= 1 && unit.kind !== "drawingNo") return false;
    const key = `${unit.kind}\u0000${unit.canonical}`;
    if (seenUnits.has(key)) return false;
    seenUnits.add(key);
    return true;
  });
  if (substantiveUnits.length === 0) {
    throw new Error("query must contain a substantive search term");
  }

  return {
    normalizedQuery: substantiveUnits.map((unit) => unit.canonical).join(" "),
    units: substantiveUnits,
  };
}

export { canonicalDrawingNumber, normalizeText as normalizeDrawingSearchText };
