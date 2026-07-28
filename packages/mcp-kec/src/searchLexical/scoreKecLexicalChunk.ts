type KecLexicalScoreInput = Readonly<{
  queryTokens: readonly string[];
  textTokens: readonly string[];
  clauseTokens: readonly string[];
}>;

function containsSequence(
  tokens: readonly string[],
  sequence: readonly string[],
): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false;
  }

  const lastStart = tokens.length - sequence.length;

  for (let start = 0; start <= lastStart; start += 1) {
    let equal = true;

    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[start + offset] !== sequence[offset]) {
        equal = false;
        break;
      }
    }

    if (equal) {
      return true;
    }
  }

  return false;
}

function sequencesEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function roundToSixDecimals(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function scoreKecLexicalChunk({
  queryTokens,
  textTokens,
  clauseTokens,
}: KecLexicalScoreInput): number | null {
  const textTokenSet = new Set(textTokens);
  const clauseTokenSet = new Set(clauseTokens);
  const textTokenFrequencies = new Map<string, number>();
  let coveredTokenCount = 0;
  let cappedTextFrequency = 0;

  for (const textToken of textTokens) {
    textTokenFrequencies.set(
      textToken,
      (textTokenFrequencies.get(textToken) ?? 0) + 1,
    );
  }

  for (const queryToken of queryTokens) {
    if (textTokenSet.has(queryToken) || clauseTokenSet.has(queryToken)) {
      coveredTokenCount += 1;
    }

    cappedTextFrequency += Math.min(
      textTokenFrequencies.get(queryToken) ?? 0,
      3,
    );
  }

  if (coveredTokenCount === 0) {
    return null;
  }

  const coverage = coveredTokenCount / queryTokens.length;
  const frequency = cappedTextFrequency / (3 * queryTokens.length);
  const phrase =
    containsSequence(textTokens, queryTokens) ||
    containsSequence(clauseTokens, queryTokens)
      ? 1
      : 0;
  const clauseExact = sequencesEqual(clauseTokens, queryTokens) ? 1 : 0;
  const rawScore =
    0.55 * coverage + 0.25 * phrase + 0.1 * frequency + 0.1 * clauseExact;

  return roundToSixDecimals(rawScore);
}
