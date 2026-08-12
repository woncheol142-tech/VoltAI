const ORCHESTRATION_TOKENS = new Set([
  "관련",
  "kec",
  "기준",
  "기준으로",
  "기준에",
  "도면",
  "도면을",
  "도면를",
  "도면이",
  "도면가",
  "도면은",
  "도면는",
  "찾아",
  "찾아서",
  "찾아줘",
  "찾아주세요",
  "검색",
  "검색해줘",
  "검색해주세요",
  "검토",
  "검토해",
  "검토해줘",
  "검토해주세요",
]);

export function drawingRequestQuery(request: string): string {
  return request
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}.㎡/()~-]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !ORCHESTRATION_TOKENS.has(token.toLowerCase()))
    .join(" ");
}
