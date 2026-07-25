import type { KecRankCandidate } from "../searchFoundation/index.js";
import type { KecWeightedRankingOptions } from "./types.js";

export type ValidatedWeightedRankingOptions = {
  readonly semanticWeight: number;
  readonly lexicalWeight: number;
};

export type WeightedRankEntry = {
  readonly candidate: KecRankCandidate;
  readonly chunkId: string;
  readonly semanticPresent: boolean;
  readonly semanticScore: number;
  readonly lexicalPresent: boolean;
  readonly lexicalScore: number;
  readonly weightedScore: number;
};

type ValidatedSignal = {
  readonly present: boolean;
  readonly score: number;
};

function isObjectReference(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function ownDataValue(
  container: unknown,
  key: string,
  errorPrefix: string,
): unknown {
  if (!isObjectReference(container)) {
    throw new Error(`${errorPrefix} ${key} must be an own data property`);
  }

  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new Error(`${errorPrefix} ${key} must be an own data property`);
  }

  return descriptor.value;
}

function validateWeight(
  options: KecWeightedRankingOptions,
  key: "semanticWeight" | "lexicalWeight",
): number {
  const value = ownDataValue(options, key, "INVALID_RANKING_OPTIONS:");

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `INVALID_RANKING_OPTIONS: ${key} must be a finite non-negative number`,
    );
  }

  return value;
}

export function validateWeightedRankingOptions(
  options: KecWeightedRankingOptions,
): ValidatedWeightedRankingOptions {
  const semanticWeight = validateWeight(options, "semanticWeight");
  const lexicalWeight = validateWeight(options, "lexicalWeight");

  if (semanticWeight === 0 && lexicalWeight === 0) {
    throw new Error(
      "INVALID_RANKING_OPTIONS: at least one weight must be positive",
    );
  }

  return { semanticWeight, lexicalWeight };
}

export function validateRankLimit(limit: number): void {
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0) {
    throw new Error(
      "INVALID_RANK_LIMIT: limit must be a non-negative safe integer",
    );
  }
}

function validateSignal(
  signals: object,
  key: "semanticScore" | "lexicalScore",
  chunkId: string,
): ValidatedSignal {
  const descriptor = Object.getOwnPropertyDescriptor(signals, key);

  if (!descriptor) {
    if (key in signals) {
      throw new Error(
        `INVALID_RANK_SCORE: ${chunkId} ${key} must be an own data property`,
      );
    }

    return { present: false, score: 0 };
  }

  if (!("value" in descriptor)) {
    throw new Error(
      `INVALID_RANK_SCORE: ${chunkId} ${key} must be an own data property`,
    );
  }

  const value = descriptor.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `INVALID_RANK_SCORE: ${chunkId} ${key} must be a finite number`,
    );
  }

  return { present: true, score: value };
}

function validateFiniteContribution(
  value: number,
  chunkId: string,
  label: string,
): void {
  if (!Number.isFinite(value)) {
    throw new Error(`INVALID_RANK_SCORE: ${chunkId} ${label} overflow`);
  }
}

export function validateWeightedRankCandidate(
  candidate: KecRankCandidate,
  options: ValidatedWeightedRankingOptions,
): WeightedRankEntry {
  const chunkIdValue = ownDataValue(
    candidate,
    "chunkId",
    "INVALID_RANK_CANDIDATE:",
  );
  if (typeof chunkIdValue !== "string") {
    throw new Error("INVALID_RANK_CANDIDATE: chunkId must be a string");
  }
  const chunkId = chunkIdValue;

  const signalsValue = ownDataValue(
    candidate,
    "signals",
    "INVALID_RANK_CANDIDATE:",
  );
  if (!isObjectReference(signalsValue)) {
    throw new Error("INVALID_RANK_CANDIDATE: signals must be an object");
  }

  const semantic = validateSignal(signalsValue, "semanticScore", chunkId);
  const lexical = validateSignal(signalsValue, "lexicalScore", chunkId);

  if (!semantic.present && !lexical.present) {
    throw new Error(`MISSING_RANK_SIGNALS: ${chunkId}`);
  }

  const semanticContribution = options.semanticWeight * semantic.score;
  validateFiniteContribution(
    semanticContribution,
    chunkId,
    "semantic contribution",
  );

  const lexicalContribution = options.lexicalWeight * lexical.score;
  validateFiniteContribution(
    lexicalContribution,
    chunkId,
    "lexical contribution",
  );

  const weightedScore = semanticContribution + lexicalContribution;
  validateFiniteContribution(weightedScore, chunkId, "weighted score");

  return {
    candidate,
    chunkId,
    semanticPresent: semantic.present,
    semanticScore: semantic.score,
    lexicalPresent: lexical.present,
    lexicalScore: lexical.score,
    weightedScore,
  };
}
