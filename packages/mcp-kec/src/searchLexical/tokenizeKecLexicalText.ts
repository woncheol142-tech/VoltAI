function isInertOperatorWord(token: string): boolean {
  return (
    token === "and" || token === "near" || token === "not" || token === "or"
  );
}

export function tokenizeKecLexicalText(value: string): readonly string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = Array.from(
    normalized.matchAll(
      /\p{Decimal_Number}+(?:\.\p{Decimal_Number}+)?|\p{Letter}+/gu,
    ),
    (entry) => entry[0],
  );

  return tokens.filter((token) => !isInertOperatorWord(token));
}
