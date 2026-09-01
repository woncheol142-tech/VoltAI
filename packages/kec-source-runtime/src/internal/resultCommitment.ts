import { createHash } from "node:crypto";

import {
  KEC_VERIFIED_RESULT_COMMITMENT_ALGORITHM,
  KEC_VERIFIED_RESULT_COMMITMENT_CODEC,
  type KecDurableVerifiedResult,
  type KecVerifiedExtractionResultCommitment,
} from "../types.js";

export interface ResultCommitmentOptions {
  readonly algorithm?: string;
  readonly codec?: string;
  readonly runtimeDefaultCodec?: string;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
  return value;
}

function lengthPrefix(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function canonicalPayload(result: KecDurableVerifiedResult): string {
  if (typeof result !== "object" || result === null) {
    throw new TypeError("result must be an object");
  }
  if (!Array.isArray(result.requirements)) {
    throw new TypeError("requirements must be an array");
  }
  if (
    typeof result.capture !== "object" ||
    result.capture === null ||
    result.capture.state !== "present" ||
    !Array.isArray(result.capture.observations)
  ) {
    throw new TypeError("capture must be present");
  }

  const fields: string[] = [
    KEC_VERIFIED_RESULT_COMMITMENT_CODEC,
    stringField(result.extractionContract, "extractionContract"),
    stringField(result.locatorSpace, "locatorSpace"),
    "requirements",
    String(result.requirements.length),
  ];
  for (const [position, member] of result.requirements.entries()) {
    fields.push(
      stringField(
        member.requirementId,
        `requirements[${position}].requirementId`,
      ),
      stringField(member.statement, `requirements[${position}].statement`),
      stringField(
        member.locatorsJson,
        `requirements[${position}].locatorsJson`,
      ),
    );
  }
  fields.push(
    "capture",
    result.capture.state,
    stringField(result.capture.captureContract, "capture.captureContract"),
    String(result.capture.observations.length),
  );
  for (const [position, observation] of result.capture.observations.entries()) {
    if (
      !Number.isSafeInteger(observation.kindOrdinal) ||
      observation.kindOrdinal < 0
    ) {
      throw new TypeError(
        `capture.observations[${position}].kindOrdinal must be a non-negative integer`,
      );
    }
    fields.push(
      String(observation.kindOrdinal),
      stringField(observation.kind, `capture.observations[${position}].kind`),
      stringField(
        observation.payloadJson,
        `capture.observations[${position}].payloadJson`,
      ),
    );
  }
  return fields.map(lengthPrefix).join("|");
}

export function computeKecVerifiedExtractionResultCommitment(
  result: KecDurableVerifiedResult,
  options: ResultCommitmentOptions = {},
): KecVerifiedExtractionResultCommitment {
  const algorithm =
    options.algorithm ?? KEC_VERIFIED_RESULT_COMMITMENT_ALGORITHM;
  const codec = options.codec ?? KEC_VERIFIED_RESULT_COMMITMENT_CODEC;
  if (algorithm !== KEC_VERIFIED_RESULT_COMMITMENT_ALGORITHM) {
    throw new RangeError(`unsupported commitment algorithm: ${algorithm}`);
  }
  if (codec !== KEC_VERIFIED_RESULT_COMMITMENT_CODEC) {
    throw new RangeError(`unsupported commitment codec: ${codec}`);
  }
  const digest = createHash("sha256")
    .update(canonicalPayload(result), "utf8")
    .digest("hex");
  return Object.freeze({ algorithm, codec, digest });
}
